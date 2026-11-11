/**
 * LocalPluginSource — plugins the user imported from the popup (`kind: 'local'`).
 *
 * Reads `localPluginStore` and passes every record through the same
 * `validateLocalManifest` gate the importer used, so stored data is never
 * trusted: a record a newer build would reject is skipped and logged. The one
 * check deferred is the packaged host policy: a record that only this build's
 * site policy refuses stays listed, and `PluginHost` reports it as
 * `blocked: host-policy` instead of the user's plugin silently vanishing. Merged
 * last by `mergePluginRecords`, under the `local.*` ids no other source may use,
 * and exempt from the remote kill switch.
 */
import { logger } from '@/core/services/LoggerService';

import type { PluginManifest, PluginSource } from '../types';
import { LOCAL_PLUGIN_SOURCE_ID } from './localPluginId';
import { type LocalPluginRecordMap, loadLocalPluginRecords } from './localPluginStore';
import { validateLocalManifest } from './validateLocalManifest';

export interface LocalPluginSourceOptions {
  /** Injectable for tests; defaults to the storage-backed store. */
  readonly loadRecords?: () => Promise<LocalPluginRecordMap>;
}

export class LocalPluginSource implements PluginSource {
  readonly id = LOCAL_PLUGIN_SOURCE_ID;
  readonly kind = 'local' as const;
  private readonly loadRecords: () => Promise<LocalPluginRecordMap>;

  constructor(options: LocalPluginSourceOptions = {}) {
    this.loadRecords = options.loadRecords ?? loadLocalPluginRecords;
  }

  async list(): Promise<readonly PluginManifest[]> {
    const manifests: PluginManifest[] = [];
    for (const [id, record] of Object.entries(await this.loadRecords())) {
      // The background runs scripted plugins (`scripted/README.md`); this source never lists them.
      if (record.manifest.tier === 'scripted') continue;
      const result = validateLocalManifest(record.manifest, undefined, { hostPolicy: 'defer' });
      if (result.success && result.data.manifest.id === id) {
        manifests.push(result.data.manifest);
      } else {
        logger.warn('Skipping invalid local plugin', {
          id,
          issues: result.success
            ? [{ path: 'id', message: 'does not match its key' }]
            : result.error,
        });
      }
    }
    return manifests;
  }
}
