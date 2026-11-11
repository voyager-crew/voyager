import { useCallback, useEffect, useState } from 'react';

import {
  type LocalPluginFile,
  type LocalPluginImportResult,
  MAX_LOCAL_PLUGIN_IMPORT_CHARS,
  exportLocalPluginJson,
  importLocalPlugin,
  importLocalPluginFiles,
  removeLocalPlugin,
} from '@/features/plugins/local/localPluginImport';
import {
  type LocalPluginRecord,
  loadLocalPluginRecords,
  subscribeLocalPlugins,
} from '@/features/plugins/local/localPluginStore';
import { validateLocalManifest } from '@/features/plugins/local/validateLocalManifest';
import type { ManifestIssue } from '@/features/plugins/manifest/validate';
import type { PluginManifest } from '@/features/plugins/types';

/** One stored local plugin, re-validated the way `LocalPluginSource` reads it. */
export interface LocalPluginEntry {
  readonly id: string;
  readonly record: LocalPluginRecord;
  /** Null when the stored manifest no longer passes this build's checks. */
  readonly manifest: PluginManifest | null;
  readonly issues: readonly ManifestIssue[];
}

export function toLocalPluginEntries(
  records: Readonly<Record<string, LocalPluginRecord>>,
): LocalPluginEntry[] {
  return Object.entries(records)
    .map(([id, record]): LocalPluginEntry => {
      const result = validateLocalManifest(record.manifest, undefined, {
        hostPolicy: 'defer',
        allowScripted: true,
      });
      return result.success
        ? { id, record, manifest: result.data.manifest, issues: [] }
        : { id, record, manifest: null, issues: result.error };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Pick → read: browser files become path + text, bounded before reading. */
async function readPickedFiles(
  files: readonly File[],
): Promise<LocalPluginFile[] | LocalPluginImportResult> {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_LOCAL_PLUGIN_IMPORT_CHARS * 4) {
    return {
      ok: false,
      issues: [{ path: 'file', message: `exceeds ${MAX_LOCAL_PLUGIN_IMPORT_CHARS} characters` }],
    };
  }
  return Promise.all(
    files.map(async (file) => ({
      name: file.webkitRelativePath || file.name,
      text: await file.text(),
    })),
  );
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

/** The stored local plugins, kept fresh as they are imported, updated or removed. */
export function useLocalPluginEntries(): readonly LocalPluginEntry[] {
  const [entries, setEntries] = useState<readonly LocalPluginEntry[]>([]);
  useEffect(() => {
    let active = true;
    const load = (): void => {
      void loadLocalPluginRecords().then((records) => {
        if (active) setEntries(toLocalPluginEntries(records));
      });
    };
    load();
    const unsubscribe = subscribeLocalPlugins(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return entries;
}

/** Local plugin list plus import / export / remove for the popup plugin page. */
export function useLocalPlugins() {
  const entries = useLocalPluginEntries();
  const [result, setResult] = useState<LocalPluginImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const runImport = useCallback(
    async (job: () => Promise<LocalPluginImportResult>): Promise<LocalPluginImportResult> => {
      setBusy(true);
      setResult(null);
      let outcome: LocalPluginImportResult;
      try {
        outcome = await job();
      } catch (error) {
        outcome = {
          ok: false,
          issues: [
            { path: 'file', message: error instanceof Error ? error.message : String(error) },
          ],
        };
      }
      setResult(outcome);
      setBusy(false);
      return outcome;
    },
    [],
  );

  const importFiles = useCallback(
    (files: readonly File[]) =>
      runImport(async () => {
        const read = await readPickedFiles(files);
        return Array.isArray(read) ? importLocalPluginFiles(read) : read;
      }),
    [runImport],
  );

  /** Pasted text is read as a single `plugin.json` with its CSS inlined. */
  const importText = useCallback(
    (text: string) => runImport(() => importLocalPluginFiles([{ name: 'plugin.json', text }])),
    [runImport],
  );

  /**
   * A manifest already read and previewed (the AI-reply flow), imported as is,
   * and only over the install the preview was made against (`expectedInstalled`).
   */
  const importManifest = useCallback(
    (raw: unknown, expectedInstalled: string | null) =>
      runImport(() => importLocalPlugin(raw, undefined, { expectedInstalled })),
    [runImport],
  );

  const remove = useCallback(async (id: string) => {
    setResult(null);
    try {
      await removeLocalPlugin(id);
    } catch (error) {
      // Storage refused the read or write: nothing was removed; say so.
      setResult({
        ok: false,
        issues: [{ path: id, message: error instanceof Error ? error.message : String(error) }],
      });
    }
  }, []);

  const exportPlugin = useCallback((entry: LocalPluginEntry) => {
    downloadText(`${entry.id}.json`, exportLocalPluginJson(entry.record));
  }, []);

  return {
    entries,
    result,
    busy,
    importFiles,
    importText,
    importManifest,
    remove,
    exportPlugin,
    clearResult: () => setResult(null),
  };
}

export type LocalPluginsController = ReturnType<typeof useLocalPlugins>;
