import { UnrecognizedDriveFileError } from '@/core/utils/driveReadResult';
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
import { GoogleDriveUploadFiles } from './GoogleDriveUploadFiles';

type Files = Pick<GoogleDriveFiles, 'ensure' | 'find' | 'upload' | 'download' | 'prepareDownload'>;

export class GoogleDriveCatalogTimeline {
  constructor(
    private readonly files: Files,
    private readonly uploads = new GoogleDriveUploadFiles(files),
  ) {}

  /** The site's cloud buckets, or null when it has no file yet. */
  async read(token: string, site: string): Promise<CatalogTimelineBuckets | null> {
    const id = await this.files.find(token, catalogTimelineFileName(site));
    if (!id) return null;
    const payload = await this.files.download<unknown>(token, id);
    if (payload === null) return null;
    try {
      return decodeCatalogTimelinePayload(payload, site);
    } catch {
      throw new UnrecognizedDriveFileError();
    }
  }

  /** Every listed site's cloud buckets, in one map keyed by storage key. */
  async download(token: string, sites: readonly string[]): Promise<CatalogTimelineBuckets> {
    await this.files.prepareDownload(token);
    const buckets: CatalogTimelineBuckets = {};
    for (const site of sites) Object.assign(buckets, await this.read(token, site));
    return buckets;
  }

  /** Read and materialize every site before the first ensure/upload can mutate Drive. */
  async planUpload(
    token: string,
    bySite: Record<string, CatalogTimelineBuckets>,
  ): Promise<Array<{ name: string; payload: CatalogTimelineHierarchyExportPayload }>> {
    await this.files.prepareDownload(token);
    const plan: Array<{ name: string; payload: CatalogTimelineHierarchyExportPayload }> = [];
    for (const [site, local] of Object.entries(bySite)) {
      const remote = await this.read(token, site);
      const payload: CatalogTimelineHierarchyExportPayload = {
        format: CATALOG_TIMELINE_HIERARCHY_FORMAT,
        exportedAt: new Date().toISOString(),
        version: EXTENSION_VERSION,
        site,
        data: mergeCatalogTimelineBuckets(local, remote ?? {}),
      };
      JSON.stringify(payload);
      const name = catalogTimelineFileName(site);
      this.uploads.register(name);
      plan.push({ name, payload });
    }
    return plan;
  }

  async uploadPlan(
    token: string,
    plan: Awaited<ReturnType<GoogleDriveCatalogTimeline['planUpload']>>,
    assertActive: () => void,
  ): Promise<void> {
    this.uploads.register(...plan.map(({ name }) => name));
    await this.uploads.prepare(token);
    for (const { name, payload } of plan) {
      assertActive();
      await this.uploads.write(token, name, payload);
    }
  }
}
