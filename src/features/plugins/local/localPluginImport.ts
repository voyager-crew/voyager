/**
 * Import, re-import, export and removal of user-authored plugins. The popup
 * calls these; nothing here touches the DOM.
 *
 * Import is validate-then-swap: the manifest passes `validateLocalManifest`
 * before anything is written, so a failed re-import leaves the installed
 * version untouched and returns every issue (path + message) for the user.
 * A successful import is written in one storage write together with its
 * disabled state (`saveLocalPluginRecord`), so it always lands DISABLED: the
 * popup may close at any moment, and a stale `enabled: true` entry (for
 * example restored from Drive, or the previous version's) must never switch on
 * code the user has not inspected yet. A failed write reports the failure.
 * A scripted plugin is admitted too and lands off the same way: it runs only
 * after `enableScriptedIfUnchanged` binds a review to its content.
 */
import type { ManifestIssue } from '../manifest/validate';
import type { PluginManifest } from '../types';
import { type LocalPluginFile, readLocalPluginFiles } from './localPluginFiles';
import { toLocalPluginId } from './localPluginId';
import {
  LocalPluginChangedError,
  type LocalPluginRecord,
  type LocalPluginRecordMap,
  loadLocalPluginRecords,
  removeLocalPluginRecord,
  saveLocalPluginRecord,
} from './localPluginStore';
import { validateLocalManifest } from './validateLocalManifest';

// The file read moved to `localPluginFiles.ts` (no storage, so the CLI can use it).
export {
  type LocalPluginFile,
  MAX_LOCAL_PLUGIN_IMPORT_CHARS,
  MAX_LOCAL_PLUGIN_STYLES,
  readLocalPluginFiles,
} from './localPluginFiles';

function issue(path: string, message: string): ManifestIssue {
  return { path, message };
}

export type LocalPluginImportResult =
  | { readonly ok: true; readonly manifest: PluginManifest; readonly previousVersion?: string }
  | {
      readonly ok: false;
      readonly issues: readonly ManifestIssue[];
      /** Version still installed under the same id; a failed import never replaces it. */
      readonly previousVersion?: string;
      /** The install changed after the user reviewed it; review again before importing. */
      readonly changedSinceReview?: true;
    };

export interface LocalPluginImportDeps {
  readonly loadRecords: () => Promise<LocalPluginRecordMap>;
  /**
   * Store the manifest and switch the plugin off in one write; reject on any
   * failure, and with `LocalPluginChangedError` when `expectedInstalled` is
   * given and the install under the id is no longer that one.
   */
  readonly installDisabled: (
    manifest: Readonly<Record<string, unknown>>,
    expectedInstalled?: string | null,
  ) => Promise<void>;
}

const DEFAULT_DEPS: LocalPluginImportDeps = {
  loadRecords: loadLocalPluginRecords,
  installDisabled: (manifest, expectedInstalled) =>
    saveLocalPluginRecord(
      manifest,
      Date.now(),
      expectedInstalled === undefined ? {} : { expectedInstalled },
    ),
};

export interface LocalPluginImportOptions {
  /**
   * `localPluginRecordSnapshot` of what was installed under the id when the
   * user reviewed this manifest (the AI-reply preview). The import then lands
   * only over that exact install; anything else returns `changedSinceReview`.
   */
  readonly expectedInstalled?: string | null;
}

function recordVersion(record: LocalPluginRecord | undefined): string | undefined {
  return typeof record?.manifest.version === 'string' ? record.manifest.version : undefined;
}

/** Validate a raw manifest and, only when it passes, install it disabled. */
export async function importLocalPlugin(
  raw: unknown,
  deps: LocalPluginImportDeps = DEFAULT_DEPS,
  options: LocalPluginImportOptions = {},
): Promise<LocalPluginImportResult> {
  const rawId =
    typeof raw === 'object' && raw !== null && 'id' in raw && typeof raw.id === 'string'
      ? toLocalPluginId(raw.id)
      : null;
  const records = await deps.loadRecords();
  const previousVersion = rawId ? recordVersion(records[rawId]) : undefined;
  const previous = previousVersion ? { previousVersion } : {};

  const result = validateLocalManifest(raw, undefined, { allowScripted: true });
  if (!result.success) return { ok: false, issues: result.error, ...previous };

  const { manifest } = result.data;
  try {
    await deps.installDisabled(result.data.raw, options.expectedInstalled);
  } catch (error) {
    if (error instanceof LocalPluginChangedError) {
      const current = recordVersion((await deps.loadRecords())[manifest.id]);
      return {
        ok: false,
        issues: [issue('', error.message)],
        changedSinceReview: true,
        ...(current ? { previousVersion: current } : {}),
      };
    }
    return {
      ok: false,
      issues: [issue('', error instanceof Error ? error.message : String(error))],
      ...previous,
    };
  }
  return { ok: true, manifest, ...previous };
}

/** Read picked files (or pasted text as one `plugin.json`) and import the result. */
export async function importLocalPluginFiles(
  files: readonly LocalPluginFile[],
  deps: LocalPluginImportDeps = DEFAULT_DEPS,
): Promise<LocalPluginImportResult> {
  const read = await readLocalPluginFiles(files);
  if (!read.success) return { ok: false, issues: read.error };
  return importLocalPlugin(read.data, deps);
}

/** Remove a local plugin together with its enable state and settings. */
export async function removeLocalPlugin(id: string): Promise<void> {
  await removeLocalPluginRecord(id);
}

/** The stored manifest as a re-importable `plugin.json` (CSS inlined). */
export function exportLocalPluginJson(record: LocalPluginRecord): string {
  return `${JSON.stringify(record.manifest, null, 2)}\n`;
}
