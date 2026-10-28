import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { getTranslationSync, setCachedLanguage } from '@/utils/i18n';

import { type LifecycleHarness, installLifecycleHarness } from '../../__tests__/lifecycleHarness';
import { activateGeminiDeepResearchExport } from '../pluginHandler';

let scope: PluginScope;
let harness: LifecycleHarness;
const entries = () =>
  document.querySelectorAll('.gv-deep-research-download, .gv-deep-research-save-report');
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function menu(complete = true): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'mat-mdc-menu-panel';
  panel.setAttribute('role', 'menu');
  panel.innerHTML = '<div class="mat-mdc-menu-content"></div>';
  if (complete) fill(panel);
  document.body.append(panel);
  return panel;
}
function fill(panel: HTMLElement): void {
  panel.querySelector('.mat-mdc-menu-content')!.innerHTML = `
    <button data-test-id="share-drive-button" role="menuitem">Share</button>
    <button data-test-id="export-to-docs-button" role="menuitem" class="mat-mdc-menu-item">
      <span class="mat-mdc-menu-item-text">Export to Docs</span>
    </button>`;
}

beforeEach(async () => {
  vi.useFakeTimers();
  await setCachedLanguage('en');
  document.body.innerHTML = '<deep-research-immersive-panel></deep-research-immersive-panel>';
  harness = installLifecycleHarness();
  scope = new PluginScope();
});
afterEach(async () => {
  await scope.dispose();
  harness.restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('Deep Research menu scope', () => {
  it('injects cached labels immediately and releases language updates and all effects on disable', async () => {
    await setCachedLanguage('fr');
    menu();
    activateGeminiDeepResearchExport(scope);
    vi.advanceTimersByTime(50);
    expect(entries()).toHaveLength(2);
    const download = entries()[0] as HTMLElement;
    expect(download.textContent).toContain(getTranslationSync('deepResearchDownload'));
    expect(download.title).toBe(getTranslationSync('deepResearchDownloadTooltip'));
    await setCachedLanguage('ja');
    expect(download.title).toBe(getTranslationSync('deepResearchDownloadTooltip'));
    const lastTitle = download.title;
    const disposing = scope.dispose();
    expect(entries()).toHaveLength(0);
    await disposing;
    await setCachedLanguage('zh');
    expect(download.title).toBe(lastTitle);
    download.click();
    await flush();
    expect(document.querySelector('.gv-export-dialog')).toBeNull();
    expect(harness.ledger.openObservers()).toHaveLength(0);
    expect(harness.ledger.openListeners({ includeDetached: true })).toHaveLength(0);
    expect(harness.ledger.openStorageListeners()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discovers wrapped and partially rendered menus without injecting into unrelated menus', async () => {
    const unrelated = menu(false);
    unrelated.querySelector('.mat-mdc-menu-content')!.innerHTML =
      '<button data-test-id="pin-button">Pin</button>';
    activateGeminiDeepResearchExport(scope);
    const panel = menu(false);
    const wrapper = document.createElement('div');
    wrapper.append(panel);
    document.body.append(wrapper);
    await vi.advanceTimersByTimeAsync(50);
    expect(entries()).toHaveLength(0);
    fill(panel);
    await vi.advanceTimersByTimeAsync(100);
    expect(entries()).toHaveLength(2);
    expect(unrelated.querySelector('.gv-deep-research-download')).toBeNull();
    panel.append(document.createElement('span'));
    await vi.advanceTimersByTimeAsync(100);
    expect(entries()).toHaveLength(2);
  });

  it('releases detached menu entries and listeners before Gemini reuses the overlay', async () => {
    const panel = menu();
    activateGeminiDeepResearchExport(scope);
    await vi.advanceTimersByTimeAsync(50);
    const listenerCount = harness.ledger.openListeners({ includeDetached: true }).length;
    const retained = panel.querySelector<HTMLElement>('.gv-deep-research-save-report')!;
    panel.remove();
    await flush();
    expect(panel.querySelector('.gv-deep-research-save-report')).toBeNull();
    retained.click();
    await flush();
    expect(document.querySelector('.gv-export-dialog')).toBeNull();
    document.body.append(panel);
    await vi.advanceTimersByTimeAsync(50);
    expect(entries()).toHaveLength(2);
    expect(harness.ledger.openListeners({ includeDetached: true })).toHaveLength(listenerCount);
  });

  it('remounts while the old cleanup ledger drains without leaving stale entries', async () => {
    menu();
    activateGeminiDeepResearchExport(scope);
    await vi.advanceTimersByTimeAsync(50);
    const old = [...entries()];
    let release!: () => void;
    scope.effect(
      () => () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      'slow sibling',
    );
    const disposing = scope.dispose();
    scope = new PluginScope();
    try {
      activateGeminiDeepResearchExport(scope);
      await vi.advanceTimersByTimeAsync(50);
      expect(entries()).toHaveLength(2);
      expect([...entries()].every((entry) => !old.includes(entry))).toBe(true);
    } finally {
      release();
      await disposing;
    }
    expect(entries()).toHaveLength(2);
  });

  it('drops delayed discovery when the Deep Research panel disappears', async () => {
    menu();
    activateGeminiDeepResearchExport(scope);
    document.querySelector('deep-research-immersive-panel')!.remove();
    await vi.advanceTimersByTimeAsync(100);
    expect(entries()).toHaveLength(0);
  });
});
