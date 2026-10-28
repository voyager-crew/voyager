import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { showExportNotice } from '@/features/export/ui/exportToasts';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { getTranslation, setCachedLanguage } from '@/utils/i18n';

import { type LifecycleHarness, installLifecycleHarness } from '../../__tests__/lifecycleHarness';
import { CANVAS_MARKDOWN_BUTTON_CLASS } from '../menuInjection';
import { activateGeminiCanvasCopy } from '../pluginHandler';
import { canvasFixture, fillMenu, setup } from './fixtures';

vi.mock('@/utils/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/i18n')>()),
  getTranslation: vi.fn(async (key: string) => key),
}));
vi.mock('@/features/export/ui/exportToasts', () => ({ showExportNotice: vi.fn() }));

let scope: PluginScope;
let harness: LifecycleHarness;
const selector = `.${CANVAS_MARKDOWN_BUTTON_CLASS}`;
const buttons = () => document.querySelectorAll<HTMLElement>(selector);
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

async function mount(): Promise<void> {
  activateGeminiCanvasCopy(scope);
  await vi.advanceTimersByTimeAsync(30);
}

beforeEach(async () => {
  vi.useFakeTimers();
  await setCachedLanguage('en');
  vi.mocked(getTranslation).mockImplementation(async (key) => key);
  vi.mocked(showExportNotice).mockClear();
  vi.stubGlobal(
    'navigator',
    Object.assign(Object.create(navigator), {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    }),
  );
  harness = installLifecycleHarness();
  scope = new PluginScope();
});

afterEach(async () => {
  await scope.dispose();
  vi.unstubAllGlobals();
  harness.restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('Canvas copy plugin lifecycle', () => {
  it('copies converted Markdown once and requests native Export menu dismissal', async () => {
    const panel = setup();
    const dismiss = vi.fn((event: KeyboardEvent) => {
      if (event.key === 'Escape') panel.remove();
    });
    panel.addEventListener('keydown', dismiss);
    await mount();
    expect(buttons()).toHaveLength(1);
    buttons()[0].click();
    await flush();
    expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(
      '# Document\n\nHello **world**',
    );
    expect(document.getElementById('canvas-menu')).toBeNull();
    expect(showExportNotice).toHaveBeenCalledWith('canvasExportCopied', { tone: 'success' });
  });

  it.each(['inline-preview', 'immersive-panel'])(
    'copies the %s that opened Export when two editors exist',
    async (owner) => {
      setup(true, owner);
      document.body.insertAdjacentHTML(
        'afterbegin',
        canvasFixture(
          owner === 'inline-preview' ? 'immersive-panel' : 'inline-preview',
          'other-menu',
        ),
      );
      document.querySelector('.ProseMirror')!.textContent = 'Wrong document';
      await mount();
      buttons()[0].click();
      expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(
        '# Document\n\nHello **world**',
      );
    },
  );

  it.each(['Enter', ' '])('reaches Copy with ArrowDown and activates with %s once', async (key) => {
    const panel = setup();
    await mount();
    const native = panel.querySelector<HTMLElement>('[value="download_md"]')!;
    native.focus();
    native.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(buttons()[0]);
    buttons()[0].dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it('keeps native menu actions intact and navigates in both directions', async () => {
    const panel = setup();
    await mount();
    const download = panel.querySelector<HTMLElement>('[value="download_md"]')!;
    const drive = panel.querySelector<HTMLElement>('[value="export_md_drive"]')!;
    const nativeAction = vi.fn();
    drive.addEventListener('click', nativeAction);
    const press = (key: string) =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
    drive.focus();
    press('ArrowUp');
    expect(document.activeElement).toBe(buttons()[0]);
    press('ArrowUp');
    expect(document.activeElement).toBe(download);
    press('End');
    expect(document.activeElement).toBe(drive);
    press('Home');
    expect(document.activeElement).toBe(download);
    drive.click();
    expect(nativeAction).toHaveBeenCalledTimes(1);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('does not bubble Copy activation into Gemini download handlers or repeat it', async () => {
    const panel = setup();
    await mount();
    const hostAction = vi.fn();
    panel.addEventListener('click', hostAction);
    panel.addEventListener('keydown', hostAction);
    buttons()[0].click();
    buttons()[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true }),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(hostAction.mock.calls.map(([event]) => event.key)).toEqual(['Escape']);
  });

  it('warns about empty Canvas content without writing the clipboard', async () => {
    setup();
    document.querySelector('.ProseMirror')!.innerHTML = '';
    await mount();
    buttons()[0].click();
    await flush();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(showExportNotice).toHaveBeenCalledWith('canvasExportEmpty', { tone: 'warning' });
  });

  it('reports a clipboard failure', async () => {
    setup();
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
    await mount();
    buttons()[0].click();
    await flush();
    expect(showExportNotice).toHaveBeenCalledWith('canvasExportFailed', { tone: 'error' });
  });

  it('retries an unfinished menu and never duplicates a button on DOM changes', async () => {
    const panel = setup(false);
    await mount();
    expect(buttons()).toHaveLength(0);
    fillMenu(panel);
    await vi.advanceTimersByTimeAsync(80);
    expect(buttons()).toHaveLength(1);
    panel.append(document.createElement('span'));
    await vi.advanceTimersByTimeAsync(800);
    expect(buttons()).toHaveLength(1);
  });

  it('finds a menu added after activation and leaves unrelated menus alone', async () => {
    const panel = setup();
    panel.remove();
    await mount();
    document.body.append(panel);
    await vi.advanceTimersByTimeAsync(30);
    expect(buttons()).toHaveLength(1);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<deep-research-immersive-panel></deep-research-immersive-panel>',
    );
    panel.querySelector(selector)!.remove();
    panel.append(document.createElement('span'));
    await vi.advanceTimersByTimeAsync(800);
    expect(buttons()).toHaveLength(0);
  });

  it('disable synchronously removes buttons and releases observers and listeners', async () => {
    setup();
    await mount();
    const retainedButton = buttons()[0];
    const disposal = scope.dispose();
    expect(buttons()).toHaveLength(0);
    await disposal;
    retainedButton.click();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(harness.ledger.openObservers()).toHaveLength(0);
    expect(harness.ledger.openStorageListeners()).toBe(0);
    expect(harness.ledger.openListeners({ includeDetached: true })).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disabling while Copy is focused leaves the native Export menu keyboard reachable', async () => {
    const panel = setup();
    await mount();
    const download = panel.querySelector<HTMLElement>('[value="download_md"]')!;
    download.focus();
    download.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons()[0]);
    const disposal = scope.dispose();
    expect(buttons()).toHaveLength(0);
    expect(document.activeElement).toBe(download);
    expect(download.tabIndex).toBe(0);
    expect(download.classList.contains('active')).toBe(true);
    expect(download.querySelector('gem-menu-item-content')?.classList.contains('active')).toBe(
      true,
    );
    await disposal;
  });

  it('teardown during a pending retry cannot inject later', async () => {
    const panel = setup(false);
    await mount();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await scope.dispose();
    fillMenu(panel);
    await vi.advanceTimersByTimeAsync(1000);
    expect(buttons()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('detaching a menu releases its button listener and reopening injects just once', async () => {
    const panel = setup();
    await mount();
    const oldButton = buttons()[0];
    panel.remove();
    await flush();
    expect(panel.querySelector(selector)).toBeNull();
    oldButton.click();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    document.body.append(panel);
    await vi.advanceTimersByTimeAsync(30);
    expect(buttons()).toHaveLength(1);
  });

  it('an already open menu has the cached language on its first injection', async () => {
    await setCachedLanguage('fr');
    setup();
    activateGeminiCanvasCopy(scope);
    // Do not flush promises: the first visible label must already be translated.
    vi.advanceTimersByTime(30);
    expect(buttons()).toHaveLength(1);
    expect(buttons()[0].textContent).toContain('Copier en Markdown');
    expect(buttons()[0].getAttribute('aria-label')).toBe(
      'Copier le contenu du Canvas au format Markdown',
    );
  });

  it('open menu labels follow cached language changes and stop after teardown', async () => {
    setup();
    await mount();
    const oldButton = buttons()[0];
    await setCachedLanguage('fr');
    expect(oldButton.textContent).toContain('Copier en Markdown');
    expect(oldButton.getAttribute('aria-label')).toBe(
      'Copier le contenu du Canvas au format Markdown',
    );
    await scope.dispose();
    await setCachedLanguage('ja');
    expect(oldButton.textContent).toContain('Copier en Markdown');
    scope = new PluginScope();
    await mount();
    expect(buttons()).toHaveLength(1);
    expect(buttons()[0].textContent).toContain('Markdown としてコピー');
  });

  it.each([undefined, {}])(
    'activation tolerates an unavailable storage API (%s)',
    async (storage) => {
      setup();
      vi.stubGlobal('chrome', { ...chrome, storage });
      await mount();
      expect(buttons()).toHaveLength(1);
      await setCachedLanguage('fr');
      expect(buttons()[0].textContent).toContain('Copier en Markdown');
    },
  );

  it('a remount while the old scope drains still shows one button', async () => {
    setup();
    await mount();
    const oldButton = buttons()[0];
    let finishCleanup!: () => void;
    const cleanupBarrier = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    scope.effect(() => () => cleanupBarrier, 'delayed sibling cleanup');
    const disposal = scope.dispose();
    scope = new PluginScope();
    try {
      // Mount before the old ledger settles, as the host does on remount.
      await mount();
    } finally {
      finishCleanup();
      await disposal;
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(buttons()).toHaveLength(1);
    expect(buttons()[0]).not.toBe(oldButton);
    buttons()[0].click();
    await flush();
    expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(
      '# Document\n\nHello **world**',
    );
  });

  it('late clipboard completion after disable does not show a notice', async () => {
    let finish!: () => void;
    vi.mocked(navigator.clipboard.writeText).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    setup();
    await mount();
    buttons()[0].click();
    await scope.dispose();
    finish();
    await flush();
    expect(showExportNotice).not.toHaveBeenCalled();
  });
});
