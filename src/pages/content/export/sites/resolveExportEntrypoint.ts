import type { ExportSite } from '../exportSite';
import { createExportEntrypoint } from '../index';

type ExportEntrypoint = ReturnType<typeof createExportEntrypoint>;

const historyEntrypoints = new WeakMap<Document, Map<string, ExportEntrypoint>>();

/** History reloads may resume once per page and site, never again after a plugin toggle. */
export function exportEntrypointFor(site: ExportSite, doc: Document): ExportEntrypoint {
  if (!site.history) return createExportEntrypoint(site);

  let entries = historyEntrypoints.get(doc);
  if (!entries) {
    entries = new Map();
    historyEntrypoints.set(doc, entries);
  }
  let entry = entries.get(site.id);
  if (!entry) {
    entry = createExportEntrypoint(site);
    entries.set(site.id, entry);
  }
  return entry;
}
