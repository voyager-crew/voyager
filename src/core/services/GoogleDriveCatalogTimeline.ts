/**
 * One additive Drive file per catalog site for its timeline outlines; see
 * `features/timeline/catalogHierarchySync.ts` for the payload. Uploads merge into the file
 * already in the cloud, so a device never drops outlines another device (or account) uploaded.
 *
 * Uploads on this device run one at a time, each reading the file after the previous one wrote.
 * Two devices uploading at the same moment can still replace each other's write: Drive offers no
 * conditional update here, and every other Voyager file (folders, Gemini outlines, stars) has
 * that same last-writer-wins window. The next upload from either device merges the outline back.
 */
import { EXTENSION_VERSION } from '@/core/utils/version';
import {
  CATALOG_TIMELINE_HIERARCHY_FORMAT,
  type CatalogTimelineBuckets,
  type CatalogTimelineHierarchyExportPayload,
  catalogTimelineFileName,
  decodeCatalogTimelinePayload,
  mergeCatalogTimelineBuckets,
} from '@/features/timeline/catalogHierarchySync';

import type { GoogleDriveFiles } from './GoogleDriveFiles';

type Files = Pick<GoogleDriveFiles, 'ensure' | 'find' | 'upload' | 'download' | 'prepareDownload'>;

export class GoogleDriveCatalogTimeline {
  private uploads: Promise<unknown> = Promise.resolve();

  constructor(private readonly files: Files) {}

  /** The site's cloud buckets, or null when it has no file yet. */
  async read(token: string, site: string): Promise<CatalogTimelineBuckets | null> {
    const id = await this.files.find(token, catalogTimelineFileName(site));
    if (!id) return null;
    const payload = await this.files.download<unknown>(token, id);
    return payload === null ? null : decodeCatalogTimelinePayload(payload, site);
  }

  /** Every listed site's cloud buckets, in one map keyed by storage key. */
  async download(token: string, sites: readonly string[]): Promise<CatalogTimelineBuckets> {
    await this.files.prepareDownload(token);
    const buckets: CatalogTimelineBuckets = {};
    for (const site of sites) Object.assign(buckets, await this.read(token, site));
    return buckets;
  }

  /** Merges each site's local buckets into its cloud file; `assertActive` guards every write. */
  upload(
    token: string,
    bySite: Record<string, CatalogTimelineBuckets>,
    assertActive: () => void,
  ): Promise<void> {
    // Two uploads that read the file before either wrote would each drop the other's outlines.
    const run = this.uploads.then(
      () => this.uploadNow(token, bySite, assertActive),
      () => this.uploadNow(token, bySite, assertActive),
    );
    this.uploads = run.catch(() => undefined);
    return run;
  }

  private async uploadNow(
    token: string,
    bySite: Record<string, CatalogTimelineBuckets>,
    assertActive: () => void,
  ): Promise<void> {
    await this.files.prepareDownload(token);
    for (const [site, local] of Object.entries(bySite)) {
      const remote = await this.read(token, site);
      const payload: CatalogTimelineHierarchyExportPayload = {
        format: CATALOG_TIMELINE_HIERARCHY_FORMAT,
        exportedAt: new Date().toISOString(),
        version: EXTENSION_VERSION,
        site,
        data: mergeCatalogTimelineBuckets(local, remote ?? {}),
      };
      assertActive();
      const id = await this.files.ensure(token, catalogTimelineFileName(site));
      assertActive();
      await this.files.upload(token, id, payload);
    }
  }
}
