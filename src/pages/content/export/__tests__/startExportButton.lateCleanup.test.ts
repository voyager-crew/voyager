// @vitest-environment-options { "url": "https://chatgpt.com/c/test" }
/** ChatGPT export mounts that the plugin switch outruns. */
import { describe, expect, it, vi } from 'vitest';

const runner = vi.hoisted(() => ({
  run: vi.fn(async () => {}),
  resumePending: vi.fn(async () => {}),
  cancel: vi.fn(),
}));

vi.mock('../exportRun', () => ({ createExportRunner: () => runner }));

const { createExportEntrypoint } = await import('../index');
const { resolveExportSite } = await import('../sites/resolveExportSite');
const startExportButton = createExportEntrypoint(resolveExportSite());

describe('a ChatGPT export mount switched off before it finished', () => {
  it("does not cancel the newer mount's export when its late cleanup runs", async () => {
    // Off before the dictionaries load, as the ChatGPT runtime does on a fast off/on.
    const older = new AbortController();
    const mounting = startExportButton({ signal: older.signal });
    older.abort();
    const lateCleanup = await mounting;

    // The newer mount's run is the runner's active operation by now.
    lateCleanup();

    expect(runner.cancel).not.toHaveBeenCalled();
    expect(document.querySelector('[data-gv-component="persistent-export-toolbar"]')).toBeNull();
  });
});
