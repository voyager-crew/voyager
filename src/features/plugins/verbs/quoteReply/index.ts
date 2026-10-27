import { findComposer, insertIntoComposer, readComposer } from '@/core/services/composer';
import { LAYER_ATTR, isVoyagerLayerEvent } from '@/core/ui/layer';
import { createToaster } from '@/core/ui/toast/toaster';
import { formatQuotedText } from '@/core/utils/quotedText';
import { getTranslationSync, onCachedLanguageChange } from '@/utils/i18n';

import { getPrimitiveContract } from '../contracts';
import type { Primitive } from '../types';
import './messages';
import { extractQuoteText } from './text';

export type QuoteReplyParams = Readonly<Record<string, never>>;

const BUTTON_CLASS = 'gv-quote-reply-button';
const EDGE = 10;
const GAP = 8;
// Page tokens from contentStyle.css (005-ui-tokens.css) follow `data-gv-scheme`; the literals
// keep the button painted if the sheet has not landed yet.
const CSS = `
.${BUTTON_CLASS} {
  position: fixed; z-index: 9999; box-sizing: border-box;
  min-height: 32px; min-width: 44px; margin: 0; padding: 6px 12px;
  border: 1px solid var(--gv-ui-border, oklch(0.92 0.004 250 / 0.7)); border-radius: 8px;
  background: var(--gv-ui-surface, oklch(0.995 0.002 250));
  color: var(--gv-ui-text, oklch(0.14 0.004 285)); cursor: pointer;
  font: 500 13px/1.4 var(--gv-ui-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
  letter-spacing: normal;
  box-shadow: var(--gv-ui-shadow, 0 6px 20px oklch(0 0 0 / 0.16));
}
.${BUTTON_CLASS}:focus-visible {
  outline: 2px solid var(--gv-ui-focus-ring, var(--gv-pm-brand, var(--gv-pm-brand-default)));
  outline-offset: 2px;
}
@media (hover: hover) {
  .${BUTTON_CLASS}:hover { background: var(--gv-ui-surface-hover, oklch(0.97 0.003 250)); }
}
body.gv-rtl .${BUTTON_CLASS} { direction: rtl; }
@media (pointer: coarse) { .${BUTTON_CLASS} { min-height: 44px; } }
`;

function enclosingElement(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

export const quoteReplyPrimitive: Primitive<QuoteReplyParams> = {
  contract: getPrimitiveContract('quoteReply')!,
  validateParams(raw: unknown) {
    if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) {
      return { success: false, error: [{ path: 'params', message: 'must be an object' }] };
    }
    const keys = Object.keys(raw ?? {});
    return keys.length
      ? {
          success: false,
          error: keys.map((key) => ({ path: `params.${key}`, message: 'unknown parameter' })),
        }
      : { success: true, data: {} };
  },

  activate(scope, _params, context) {
    const { doc, adapter } = context;
    const selector = adapter?.selectors.assistantTurn;
    const view = doc.defaultView;
    if (!selector || !adapter?.selectors.composer || !view) return;
    context.setTargetCounter(
      () => doc.querySelectorAll(adapter.selectors.assistantTurn ?? selector).length,
    );

    // One ledger entry removes the UI and its watchers synchronously, including during a restart.
    scope.effect(() => {
      const style = doc.createElement('style');
      style.setAttribute('data-gv-plugin-scope', 'quoteReply');
      style.textContent = CSS;
      doc.head.append(style);
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = BUTTON_CLASS;
      button.setAttribute(LAYER_ATTR, 'quote-reply');
      const toaster = createToaster();
      const listeners = new view.AbortController();
      const options = { signal: listeners.signal };
      let saved: { range: Range; turn: Element; text: string } | null = null;

      const relabel = () => {
        const label = getTranslationSync('quoteReplyAction');
        button.textContent = label;
        button.setAttribute('aria-label', label);
      };
      relabel();
      const stopLanguage = onCachedLanguageChange(relabel);
      const hide = () => {
        saved = null;
        button.remove();
      };
      const allowedTurn = (range: Range): Element | null => {
        if (range.collapsed) return null;
        // The frozen catalog data still needs current response ownership at selection and click.
        const turn = enclosingElement(range.commonAncestorContainer)?.closest(
          adapter.selectors.assistantTurn ?? selector,
        );
        if (
          !turn?.isConnected ||
          !turn.contains(range.startContainer) ||
          !turn.contains(range.endContainer)
        )
          return null;
        for (const excluded of [adapter.selectors.userTurn, adapter.selectors.thinkingBlock]) {
          if (!excluded) continue;
          for (const element of doc.querySelectorAll(excluded)) {
            if (range.intersectsNode(element)) return null;
          }
        }
        return turn;
      };
      const showSelection = () => {
        if (scope.isDisposed) return;
        // Safari may collapse the page selection when Tab focuses Quote; keep its captured range usable.
        if (doc.activeElement === button && saved && allowedTurn(saved.range) === saved.turn)
          return;
        const selection = doc.getSelection();
        const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
        const turn = range && allowedTurn(range);
        if (!range || !turn) {
          hide();
          return;
        }
        const text = extractQuoteText(range);
        if (!text) {
          hide();
          return;
        }
        const rects = range.getClientRects();
        const rect = rects[rects.length - 1] ?? range.getBoundingClientRect();
        if ((!rect.width && !rect.height) || rect.bottom < 0 || rect.top > view.innerHeight) {
          hide();
          return;
        }
        saved = { range: range.cloneRange(), turn, text };
        if (!button.isConnected) doc.body.append(button);
        const size = button.getBoundingClientRect();
        const left = doc.body.classList.contains('gv-rtl') ? rect.left : rect.right - size.width;
        const below = rect.bottom + GAP;
        const top =
          below + size.height <= view.innerHeight - EDGE ? below : rect.top - GAP - size.height;
        button.style.left = `${Math.max(EDGE, Math.min(left, view.innerWidth - size.width - EDGE))}px`;
        button.style.top = `${Math.max(EDGE, Math.min(top, view.innerHeight - size.height - EDGE))}px`;
      };
      button.addEventListener('mousedown', (event) => event.preventDefault(), options);
      button.addEventListener(
        'blur',
        () => {
          if (doc.getSelection()?.isCollapsed) hide();
        },
        options,
      );
      button.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (
            !saved ||
            allowedTurn(saved.range) !== saved.turn ||
            extractQuoteText(saved.range) !== saved.text
          ) {
            hide();
            return;
          }
          const composer = findComposer(adapter, { doc });
          if (!composer) {
            toaster.show({
              message: getTranslationSync('quoteReplyComposerMissing'),
              tone: 'error',
              durationMs: null,
              channel: 'quote-reply',
            });
            return;
          }
          const prefix = readComposer(composer).length ? '\n\n' : '';
          const quote = `${prefix}${formatQuotedText(saved.text)}\n`;
          if (!insertIntoComposer(composer, quote, 'append')) {
            // A composer that refused the quote must not look like success: keep the selection to retry.
            const selection = doc.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(saved.range);
            toaster.show({
              message: getTranslationSync('quoteReplyInsertFailed'),
              tone: 'error',
              durationMs: null,
              channel: 'quote-reply',
            });
            return;
          }
          hide();
        },
        options,
      );
      doc.addEventListener('selectionchange', showSelection, options);
      doc.addEventListener(
        'pointerdown',
        (event) => {
          if (!isVoyagerLayerEvent(event)) hide();
        },
        { ...options, capture: true },
      );
      doc.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) hide();
        },
        options,
      );
      view.addEventListener('scroll', hide, { ...options, capture: true, passive: true });
      view.addEventListener('resize', hide, options);
      const observer = new view.MutationObserver((records) => {
        if (
          saved &&
          (!saved.turn.isConnected || records.some((record) => saved?.turn.contains(record.target)))
        )
          hide();
      });
      // Content changes only: other plugins restamp attributes on answers whenever the body changes,
      // including when this button is appended, which would hide it at once.
      observer.observe(doc.body, { childList: true, characterData: true, subtree: true });
      showSelection();

      return () => {
        listeners.abort();
        observer.disconnect();
        stopLanguage();
        hide();
        style.remove();
        toaster.destroy();
      };
    }, 'quote-reply');
    return { updateSettings() {} };
  },
};
