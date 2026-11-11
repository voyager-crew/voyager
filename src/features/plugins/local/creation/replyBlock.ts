/**
 * Classify one code block of an AI reply without installing anything, and
 * synchronously, so a page can label every block as it renders. A block this
 * calls installable is one `checkPluginReply` and `importLocalPlugin` accept:
 * it runs the same size cap, style-entry cap and `validateLocalManifest`. A
 * reply has no CSS files beside it, so a `styles[].file` entry fails the gate
 * here as it fails the file read there.
 */
import type { ManifestIssue } from '../../manifest/validate';
import { MAX_LOCAL_PLUGIN_IMPORT_CHARS, MAX_LOCAL_PLUGIN_STYLES } from '../localPluginFiles';
import { toLocalPluginId } from '../localPluginId';
import type { LocalPluginRecord, LocalPluginRecordMap } from '../localPluginStore';
import { validateLocalManifest } from '../validateLocalManifest';
import type { CreationInstall, CreationVerdict } from './types';

const NONE: CreationVerdict = { kind: 'none' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TOO_MANY_STYLES: readonly ManifestIssue[] = [
  { path: 'contributes.styles', message: `at most ${MAX_LOCAL_PLUGIN_STYLES} style entries` },
];

function hasTooManyStyles(manifest: Record<string, unknown>): boolean {
  const styles = isRecord(manifest.contributes) ? manifest.contributes.styles : undefined;
  return Array.isArray(styles) && styles.length > MAX_LOCAL_PLUGIN_STYLES;
}

function installState(
  stored: Readonly<Record<string, unknown>>,
  record: LocalPluginRecord | undefined,
): CreationInstall {
  if (!record) return { kind: 'new' };
  if (JSON.stringify(record.manifest) === JSON.stringify(stored)) return { kind: 'installed' };
  const version = record.manifest.version;
  return { kind: 'update', previousVersion: typeof version === 'string' ? version : null };
}

export function classifyReplyBlock(text: string, installed: LocalPluginRecordMap): CreationVerdict {
  if (text.length > MAX_LOCAL_PLUGIN_IMPORT_CHARS) return NONE;
  const bare = text.trim();
  if (!bare.startsWith('{') || !bare.endsWith('}')) return NONE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bare) as unknown;
  } catch {
    return NONE;
  }
  if (!isRecord(parsed) || !('contributes' in parsed) || !('matches' in parsed)) return NONE;

  const manifestId = typeof parsed.id === 'string' ? toLocalPluginId(parsed.id) : null;
  if (hasTooManyStyles(parsed)) return { kind: 'rejected', manifestId, issues: TOO_MANY_STYLES };
  const result = validateLocalManifest(parsed, undefined, { allowScripted: true });
  if (!result.success) return { kind: 'rejected', manifestId, issues: result.error };
  const id = result.data.manifest.id;
  return {
    kind: 'installable',
    manifestId: id,
    install: installState(result.data.raw, installed[id]),
  };
}
