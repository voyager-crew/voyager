import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Toaster } from '@/core/ui/toast/types';
import { resetPageUrl, setPageUrl, watchFullPageLoads } from '@/tests/pageUrl';

import { LibrarySelection } from '../aistudioLibrarySelection';

vi.mock('@/core/ui/confirm', () => ({ askConfirm: vi.fn(async () => 'confirm') }));
vi.mock('../aistudioLibraryBatchDelete', () => ({
  LibraryBatchDeleter: class {
    run = vi.fn(async (ids: readonly string[]) => ({ successCount: ids.length, failedCount: 0 }));
    hideProgress = vi.fn();
  },
}));

const PAGE_REFRESH_DELAY_MS = 1500;

describe('AI Studio library batch delete refresh', () => {
  let fullPageLoad: ReturnType<typeof watchFullPageLoads>;
  let selection: LibrarySelection;

  beforeEach(() => {
    vi.useFakeTimers();
    setPageUrl('https://aistudio.google.com/library');
    fullPageLoad = watchFullPageLoads();
    document.body.innerHTML =
      '<table><tr class="mat-mdc-row"><td><a href="/prompts/p1">Prompt</a></td></tr></table>';
    selection = new LibrarySelection((key) => key, vi.fn(), {} as Toaster);
  });

  afterEach(() => {
    selection.destroy();
    resetPageUrl();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  /** Long-presses the row to select it, then confirms a batch delete. */
  async function deleteSelectedRow(): Promise<void> {
    const row = document.querySelector<HTMLElement>('tr')!;
    selection.bindRow(row);
    row.querySelector('td')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);
    document.querySelector<HTMLButtonElement>('.gv-multi-select-delete-btn')!.click();
    await vi.advanceTimersByTimeAsync(0);
  }

  it('refreshes the library after deleting prompts', async () => {
    await deleteSelectedRow();
    await vi.advanceTimersByTimeAsync(PAGE_REFRESH_DELAY_MS);

    expect(fullPageLoad).toHaveBeenCalledTimes(1);
  });

  it('does not reload the page once the library features are torn down', async () => {
    await deleteSelectedRow();
    selection.destroy();
    await vi.advanceTimersByTimeAsync(PAGE_REFRESH_DELAY_MS);

    expect(fullPageLoad).not.toHaveBeenCalled();
  });

  it('refreshes again after the folder feature is turned off and back on', async () => {
    selection.destroy();
    await deleteSelectedRow();
    await vi.advanceTimersByTimeAsync(PAGE_REFRESH_DELAY_MS);

    expect(fullPageLoad).toHaveBeenCalledTimes(1);
  });

  it('does not reload a prompt the user opened before the refresh was due', async () => {
    await deleteSelectedRow();
    setPageUrl('/prompts/p2');
    await vi.advanceTimersByTimeAsync(PAGE_REFRESH_DELAY_MS);

    expect(fullPageLoad).not.toHaveBeenCalled();
  });
});
