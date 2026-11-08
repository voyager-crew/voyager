import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { createMemoryStorage } from '@/tests/memoryStorage';

import { mountPersistentExportToolbar } from '../persistentExportToolbar';
import {
  cleanUpToolbars,
  headerButton,
  hitTestByRects,
  mockToolbarGeometry,
} from './persistentExportToolbarHarness';

const RIGHT = '--gv-persistent-export-right';
const PLACING = 'gv-persistent-export-toolbar--placing';

describe('persistent export toolbar while the host header fills in', () => {
  let header: HTMLElement;
  let controls: HTMLElement[];
  let restoreStorage: typeof chrome.storage;
  let memory: ReturnType<typeof createMemoryStorage>;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'Date',
      ],
    });
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1440);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900);
    restoreStorage = globalThis.chrome.storage;
    memory = createMemoryStorage();
    globalThis.chrome.storage = memory.api;
    header = document.createElement('header');
    document.body.appendChild(header);
    // ChatGPT's header at first paint: only the conversation options button.
    controls = [headerButton(header, { left: 1396, right: 1432, top: 8, bottom: 44 }, 'Options')];
    hitTestByRects(() => controls, header);
  });

  afterEach(() => {
    globalThis.chrome.storage = restoreStorage;
    header.remove();
    cleanUpToolbars();
    vi.useRealTimers();
  });

  function mount(): HTMLDivElement {
    const { root } = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick: vi.fn(),
      siteId: 'chatgpt',
    });
    mockToolbarGeometry(root, { width: 80, height: 36, dockTop: 8 });
    return root;
  }

  /** Every right offset the toolbar showed at while visible, sampled each frame. */
  async function watchVisible(root: HTMLElement, ms: number): Promise<Set<string>> {
    const shown = new Set<string>();
    for (let t = 0; t < ms; t += 16) {
      await vi.advanceTimersByTimeAsync(16);
      if (!root.classList.contains(PLACING)) shown.add(root.style.getPropertyValue(RIGHT));
    }
    return shown;
  }

  it('appears once, beside the buttons the header adds after mount', async () => {
    const root = mount();
    const shown = await watchVisible(root, 200);
    // The header fills in its own buttons after the toolbar first measured.
    controls.push(headerButton(header, { left: 1340, right: 1392, top: 8, bottom: 44 }, 'Share'));
    for (const offset of await watchVisible(root, 2000)) shown.add(offset);

    expect(root.classList.contains(PLACING)).toBe(false);
    expect([...shown]).toEqual(['112px']);
  });

  it('shows the only export entry within the cap even if the header never settles', async () => {
    const root = mount();
    let hiddenAt2s = false;
    // A button lands under the toolbar every 300 ms, so it never sits still.
    for (let t = 0; t < 2700; t += 300) {
      const { left } = root.getBoundingClientRect();
      controls.push(
        headerButton(header, { left: left + 10, right: left + 50, top: 8, bottom: 44 }),
      );
      await vi.advanceTimersByTimeAsync(300);
      if (t === 1800) hiddenAt2s = root.classList.contains(PLACING);
    }
    expect(hiddenAt2s).toBe(true);
    expect(root.classList.contains(PLACING)).toBe(false);
  });

  it('still shows a remembered spot at once', async () => {
    memory.values.local.set(StorageKeys.PERSISTENT_EXPORT_TOOLBAR_POSITION, {
      chatgpt: { right: 400, top: 300 },
    });
    const root = mount();
    await vi.advanceTimersByTimeAsync(16);

    expect(root.classList.contains(PLACING)).toBe(false);
    expect(root.style.getPropertyValue(RIGHT)).toBe('400px');
    expect(root.style.top).toBe('300px');
  });
});
