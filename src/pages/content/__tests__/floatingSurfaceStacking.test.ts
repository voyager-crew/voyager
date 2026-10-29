import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { TemplateLibrary } from '@/features/researchPack/services/templates';

import { startPromptManager } from '../prompt/index';
import { resolvePromptSiteAdapter } from '../prompt/resolvePromptSiteAdapter';
import { packOf } from '../researchPack/__tests__/fixtures';
import { type ResearchPackPanel, createResearchPackPanel } from '../researchPack/panel';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
vi.mock('@/core/utils/userEvent', () => import('../prompt/__tests__/ballClicks'));

let manager: Awaited<ReturnType<typeof startPromptManager>> | undefined;
let researchPack: ResearchPackPanel | undefined;

function storageGet(values: Record<string, unknown>): typeof chrome.storage.sync.get {
  const get = (
    keys: string | string[] | Record<string, unknown> | null = null,
    callback?: (items: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown>> => {
    const defaults = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
    const names =
      keys === null
        ? Object.keys(values)
        : typeof keys === 'string'
          ? [keys]
          : Array.isArray(keys)
            ? keys
            : Object.keys(keys);
    const result = Object.fromEntries(names.map((key) => [key, values[key] ?? defaults[key]]));
    // Prompt Manager reads some keys through the callback form.
    callback?.(result);
    return Promise.resolve(result);
  };
  return get as typeof chrome.storage.sync.get;
}

const templateLibrary: TemplateLibrary = {
  load: async () => [],
  save: async () => 0,
};

function mountResearchPack(): ResearchPackPanel {
  const panel = createResearchPackPanel((key) => key, {
    onMove: vi.fn(),
    onRemove: vi.fn(),
    onInstructionChange: vi.fn(),
    onCopy: vi.fn(),
    onDownload: vi.fn(),
    onInsert: vi.fn(),
    onContinue: vi.fn(),
    onClear: vi.fn(),
    onRetry: vi.fn(),
    templateLibrary,
    onDownloadFile: vi.fn(),
  });
  document.body.appendChild(panel.root);
  panel.render(packOf('An answer worth keeping'), '# Pack');
  return panel;
}

const promptPanel = () => document.querySelector<HTMLElement>('#gv-pm-panel')!;
const promptPanelOpen = () => !promptPanel().classList.contains('gv-hidden');
const researchPanelOpen = () => !document.querySelector<HTMLElement>('.gv-rp-panel')!.hidden;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  document.body.innerHTML = '';
  localStorage.clear();
  vi.mocked(chrome.storage.sync.get).mockImplementation(
    storageGet({ [StorageKeys.LANGUAGE]: 'en' }),
  );
  vi.mocked(chrome.storage.local.get).mockImplementation(
    storageGet({ [StorageKeys.PROMPT_ITEMS]: [] }),
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn');
});

afterEach(() => {
  researchPack?.destroy();
  researchPack = undefined;
  manager?.destroy();
  manager = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('Prompt Manager and Research Pack stacking', () => {
  it('closes the Prompt Manager when the Research Pack opens from the keyboard', async () => {
    manager = await startPromptManager(resolvePromptSiteAdapter(location.href));
    document.querySelector<HTMLButtonElement>('#gv-pm-trigger')!.click();
    expect(promptPanelOpen()).toBe(true);

    researchPack = mountResearchPack();
    // Enter or Space on a focused button fires `click` with no pointerdown, so
    // the Prompt Manager's outside-click dismissal never sees it.
    document.querySelector<HTMLButtonElement>('.gv-rp-launcher')!.click();

    expect(researchPanelOpen()).toBe(true);
    expect(promptPanelOpen()).toBe(false);
  });

  it('leaves the Research Pack open beneath a Prompt Manager opened after it', async () => {
    manager = await startPromptManager(resolvePromptSiteAdapter(location.href));
    researchPack = mountResearchPack();
    document.querySelector<HTMLButtonElement>('.gv-rp-launcher')!.click();

    document.querySelector<HTMLButtonElement>('#gv-pm-trigger')!.click();

    // The newer Prompt Manager is on top by z-index (see stackingOrder.test.ts).
    expect(promptPanelOpen()).toBe(true);
    expect(researchPanelOpen()).toBe(true);
  });
});
