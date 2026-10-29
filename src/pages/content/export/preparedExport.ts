import type { ExportSelectionOptions } from './adapter/type';
import { throwIfExportCancelled } from './exportCancellation';

export interface PreparedExportSteps<Session> {
  /** The fallback when the source does not read the conversation itself. */
  readonly scrollToTop: () => Promise<void>;
  /** Selection mode through to its end: exported, cancelled or torn down. */
  readonly exportSelection: (session: Session | null) => Promise<void>;
}

/**
 * Prepare the conversation after any history preload, then run the selection
 * session. What the preparation read
 * (ChatGPT's crawl and its thread watch) is released once the session ends,
 * however it ends.
 */
export async function runPreparedExport<Session extends { release(): void }>(
  source: { readonly prepare?: (options: ExportSelectionOptions) => Promise<Session | null> },
  options: ExportSelectionOptions,
  steps: PreparedExportSteps<Session>,
): Promise<void> {
  let session: Session | null = null;
  try {
    session = (await source.prepare?.(options)) ?? null;
    if (!session) await steps.scrollToTop();
    throwIfExportCancelled(options.signal);
    await steps.exportSelection(session);
  } finally {
    session?.release();
  }
}
