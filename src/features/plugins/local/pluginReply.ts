/**
 * Read an AI's reply to the Create mode message (`creationMessage.ts`): find
 * the one manifest in it, then run the same read and gate as a pasted
 * `plugin.json` (`readLocalPluginFiles`, `validateLocalManifest`). Nothing here
 * installs anything; the popup previews the result and imports the exact
 * object it previewed through `importLocalPlugin`.
 */
import type { ManifestIssue } from '../manifest/validate';
import type { PluginManifest } from '../types';
import {
  type PluginReplyProblem,
  extractPluginReplyJson,
  readLocalPluginFiles,
} from './localPluginFiles';
import {
  type LocalPluginRecordMap,
  loadLocalPluginRecords,
  localPluginRecordSnapshot,
} from './localPluginStore';
import { validateLocalManifest } from './validateLocalManifest';

export {
  type PluginReplyProblem,
  type PluginReplyText,
  extractPluginReplyJson,
} from './localPluginFiles';

export type CheckedPluginReply =
  | {
      readonly ok: true;
      /** The manifest exactly as read: what `importLocalPlugin` receives on import. */
      readonly raw: unknown;
      readonly manifest: PluginManifest;
      /** Version installed under the same id, which an import would replace. */
      readonly previousVersion?: string;
      /** `localPluginRecordSnapshot` of that install: the import lands only over it. */
      readonly installed: string | null;
    }
  | { readonly ok: false; readonly problem: PluginReplyProblem }
  | { readonly ok: false; readonly issues: readonly ManifestIssue[] };

/** Extract, read and gate a reply without installing it. */
export async function checkPluginReply(
  reply: string,
  loadRecords: () => Promise<LocalPluginRecordMap> = loadLocalPluginRecords,
): Promise<CheckedPluginReply> {
  const extracted = extractPluginReplyJson(reply);
  if (!extracted.ok) return extracted;
  const read = await readLocalPluginFiles([{ name: 'plugin.json', text: extracted.json }]);
  if (!read.success) return { ok: false, issues: read.error };
  const result = validateLocalManifest(read.data);
  if (!result.success) return { ok: false, issues: result.error };
  const { manifest } = result.data;
  const record = (await loadRecords())[manifest.id];
  const installedVersion = record?.manifest.version;
  return {
    ok: true,
    raw: read.data,
    manifest,
    installed: localPluginRecordSnapshot(record),
    ...(typeof installedVersion === 'string' ? { previousVersion: installedVersion } : {}),
  };
}
