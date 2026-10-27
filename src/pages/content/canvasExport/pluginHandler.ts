import { logger } from '@/core/services/LoggerService';
import type { ToastTone } from '@/core/ui/toast/types';
import { showExportNotice } from '@/features/export/ui/exportToasts';
import type { Dispose, PluginScope } from '@/features/plugins/runtime/pluginScope';
import { getTranslation, getTranslationSync, onCachedLanguageChange } from '@/utils/i18n';
import type { TranslationKey } from '@/utils/translations';

import { convertCanvasDomToMarkdown } from './markdownConverter';
import {
  CANVAS_MARKDOWN_BUTTON_CLASS,
  closeCanvasMenuOverlay,
  findCanvasProseMirrorRoot,
  injectCanvasCopyMarkdownButton,
  navigateCanvasMenu,
  removeCanvasCopyMarkdownButton,
  resolveCanvasEntryPanels,
  updateCanvasCopyLabel,
} from './menuInjection';

const MENU_INJECTION_RETRY_LIMIT = 8;
const MENU_INJECTION_RETRY_DELAY_MS = 80;

/**
 * One mounted lifetime: DOM retries and label refreshes do not introduce a
 * separate workflow phase. Labels follow the shared language cache;
 * the clipboard write is submitted synchronously from the user's click.
 */
export function activateGeminiCanvasCopy(scope: PluginScope): void {
  const readLabels = () => ({
    label: getTranslationSync('canvasExportCopyMarkdown'),
    tooltip: getTranslationSync('canvasExportCopyMarkdownTooltip'),
  });
  let labels = readLabels();
  const pending = new Map<HTMLElement, Dispose>();
  const buttons = new Map<HTMLElement, Dispose>();

  const clearButtons = (): void => {
    for (const [button, release] of buttons) {
      removeCanvasCopyMarkdownButton(button);
      void release();
    }
    buttons.clear();
  };
  // A successor activation skips panels containing our button, so remove it at abort
  // before the old cleanup ledger drains and the successor scans the open menu.
  scope.on(scope.signal, 'abort', clearButtons, { once: true });

  const notice = async (key: TranslationKey, tone: ToastTone): Promise<void> => {
    if (scope.isDisposed) return;
    const message = await getTranslation(key);
    if (!scope.isDisposed) showExportNotice(message, { tone });
  };

  const copy = async (panel: HTMLElement): Promise<void> => {
    if (scope.isDisposed) return;
    const root = findCanvasProseMirrorRoot(panel);
    const markdown = root ? convertCanvasDomToMarkdown(root).trim() : '';
    if (!markdown) {
      await notice('canvasExportEmpty', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(markdown);
      await notice('canvasExportCopied', 'success');
    } catch (error) {
      if (scope.isDisposed) return;
      logger.error('Canvas markdown copy failed', { error: String(error) });
      await notice('canvasExportFailed', 'error');
    }
  };

  const refreshLabels = (): void => {
    if (scope.isDisposed) return;
    labels = readLabels();
    for (const button of buttons.keys()) {
      updateCanvasCopyLabel(button, labels);
    }
  };
  scope.effect(() => onCachedLanguageChange(refreshLabels), 'canvas-copy:language');

  const schedule = (panel: HTMLElement, retriesLeft = MENU_INJECTION_RETRY_LIMIT): void => {
    if (scope.isDisposed || !panel.isConnected || pending.has(panel)) return;
    // Our own insertion and label mutations must not start another retry chain.
    if (panel.querySelector(`.${CANVAS_MARKDOWN_BUTTON_CLASS}`)) return;
    pending.set(
      panel,
      scope.timer(
        () => {
          pending.delete(panel);
          if (scope.isDisposed || !panel.isConnected) return;
          const button = injectCanvasCopyMarkdownButton(panel, labels);
          if (!button) {
            if (retriesLeft > 0) schedule(panel, retriesLeft - 1);
            return;
          }
          const activate = (event: Event): void => {
            if (scope.isDisposed) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            void copy(panel);
            closeCanvasMenuOverlay(panel);
          };
          const releaseClick = scope.on(button, 'click', activate);
          const releaseKey = scope.on(button, 'keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              if (!event.repeat) activate(event);
              else {
                event.preventDefault();
                event.stopImmediatePropagation();
              }
            }
          });
          const releaseNavigation = scope.on(
            panel,
            'keydown',
            (event) => {
              if (!scope.isDisposed) navigateCanvasMenu(panel, event);
            },
            { capture: true },
          );
          buttons.set(button, () => {
            void releaseClick();
            void releaseKey();
            void releaseNavigation();
          });
        },
        retriesLeft === MENU_INJECTION_RETRY_LIMIT ? 30 : MENU_INJECTION_RETRY_DELAY_MS,
      ),
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
      if (!button.isConnected) {
        // Gemini can retain detached overlays; remove our node and its click listener too.
        removeCanvasCopyMarkdownButton(button);
        void release();
        buttons.delete(button);
      }
    }
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        resolveCanvasEntryPanels(node).forEach((panel) => schedule(panel));
      }
    }
  });
  resolveCanvasEntryPanels(document).forEach((panel) => schedule(panel));
}
