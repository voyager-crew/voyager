import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/deep-research-packaged.json';
import type { Dispose, PluginScope } from '@/features/plugins/runtime/pluginScope';
import { onCachedLanguageChange } from '@/utils/i18n';

import { injectDownloadButton, updateDeepResearchMenuLabel } from './menuButton';

const MENU_SELECTOR = packaged['deepResearch.menuPanel'];
const INJECTION_DELAY_MS = 50;

/** The scope owns menu admission; accepted exports retain their native lifetime. */
export function activateGeminiDeepResearchExport(scope: PluginScope): void {
  const pending = new Map<HTMLElement, Dispose>();
  const buttons = new Map<HTMLElement, Dispose>();
  const remove = (button: HTMLElement, release: Dispose): void => {
    button.remove();
    void release();
    buttons.delete(button);
  };
  // Remove at abort, before the ledger drains, so a successor can populate the same open menu.
  scope.on(
    scope.signal,
    'abort',
    () => {
      for (const [button, release] of buttons) remove(button, release);
    },
    { once: true },
  );
  scope.effect(
    () =>
      onCachedLanguageChange(() => {
        if (scope.isDisposed) return;
        for (const button of buttons.keys()) updateDeepResearchMenuLabel(button);
      }),
    'deep-research:language',
  );

  const schedule = (panel: HTMLElement): void => {
    if (scope.isDisposed || !panel.isConnected || pending.has(panel)) return;
    if (!document.querySelector(packaged['deepResearch.panel'])) return;
    if (
      panel.querySelector('.gv-deep-research-download') &&
      panel.querySelector('.gv-deep-research-save-report')
    )
      return;
    pending.set(
      panel,
      scope.timer(() => {
        pending.delete(panel);
        if (scope.isDisposed || !document.querySelector(packaged['deepResearch.panel'])) return;
        for (const { button, release } of injectDownloadButton(scope, panel))
          buttons.set(button, release);
      }, INJECTION_DELAY_MS),
    );
  };

  scope.observe(document.body, { childList: true, subtree: true }, (mutations) => {
    if (scope.isDisposed) return;
    for (const [panel, cancel] of pending) {
      if (!panel.isConnected) {
        void cancel();
        pending.delete(panel);
      }
    }
    for (const [button, release] of buttons) {
      if (!button.isConnected) remove(button, release);
    }
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const panel = node.closest<HTMLElement>(MENU_SELECTOR);
        if (panel) schedule(panel);
        node.querySelectorAll<HTMLElement>(MENU_SELECTOR).forEach(schedule);
      }
    }
  });
  document.querySelectorAll<HTMLElement>(MENU_SELECTOR).forEach(schedule);
}
