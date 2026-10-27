/**
 * The preview card for a slash prompt: hovering a result row or a placed token
 * shows the prompt body.
 *
 * For a filled template the values the reader typed stay editable until the
 * turn is sent. An edit is reported through `onValuesEdited(previous, next)`
 * so every copy of that body the send path might read is updated together.
 */

import type { PromptScheme } from '@/features/prompt/PromptSiteAdapter';
import { parsePromptTemplate } from '@/features/prompt/model/promptTemplate';
import { matchSentPrompt } from '@/features/prompt/model/promptTextMatch';

import { createAimedRows } from './safeTriangle';

export const SLASH_PREVIEW_ID = 'gv-pm-slash-tooltip';
const TOOLTIP_VALUE_CLASS = 'gv-pm-slash-tooltip-value';
const TOOLTIP_VISIBLE_CLASS = 'gv-pm-slash-tooltip-visible';
/** On the result list while the pointer heads for the card: crossed rows do not light up. */
const AIMING_CLASS = 'gv-pm-slash-aiming';
const TOOLTIP_HIDE_GRACE_MS = 150;

export interface SlashPreview {
  /** Shows the card while the pointer is over `target`. */
  bind: (target: HTMLElement, text: string) => void;
  /**
   * Wires a result row: `onEnter` runs when the pointer enters it, and leaving
   * schedules a hide. While the pointer is on its way from the row it previews
   * to the card, the rows it crosses wait instead of swapping the card.
   */
  bindRow: (row: HTMLElement, onEnter: () => void) => void;
  /**
   * The keyboard took over: rows the pointer crossed on its way to the card
   * must not take the selection back once it settles.
   */
  cancelAim: () => void;
  show: (target: HTMLElement, text: string) => void;
  /** Hides after a grace period that entering the card cancels. */
  scheduleHide: () => void;
  hide: () => void;
  /** Hides the card and removes it from the page. */
  destroy: () => void;
}

export interface SlashPreviewOptions {
  /** Previews for rows inside this list sit above the whole list instead of the row. */
  resultList: HTMLElement;
  onValuesEdited: (previous: string, next: string) => void;
  /** The page's light/dark, from the site adapter. */
  scheme: () => PromptScheme;
}

export function createSlashPreview({
  resultList,
  onValuesEdited,
  scheme,
}: SlashPreviewOptions): SlashPreview {
  let hideTimer: number | null = null;
  /** The element the card last showed. */
  let shownTarget: HTMLElement | null = null;

  // Moving up from a lower row to the card crosses every row above it, and
  // each one used to swap the card, so a lower row's card was unreachable.
  const rows = createAimedRows({
    card: () => {
      const card = document.getElementById(SLASH_PREVIEW_ID);
      return card?.classList.contains(TOOLTIP_VISIBLE_CLASS) ? card : null;
    },
    owner: () => shownTarget,
    onAim: () => {
      cancelHide();
      // Otherwise the row under the pointer lights up like the selected one,
      // while Enter would take the row the card shows.
      resultList.classList.add(AIMING_CLASS);
    },
    onAimEnd: () => resultList.classList.remove(AIMING_CLASS),
  });

  function cancelHide(): void {
    if (hideTimer === null) return;
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }

  function conceal(): void {
    rows.stop();
    document.getElementById(SLASH_PREVIEW_ID)?.classList.remove(TOOLTIP_VISIBLE_CLASS);
  }

  function scheduleHide(): void {
    cancelHide();
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      conceal();
    }, TOOLTIP_HIDE_GRACE_MS);
  }

  function enterCard(): void {
    rows.stop();
    cancelHide();
  }

  function ensureCard(): HTMLDivElement {
    let tooltip = document.getElementById(SLASH_PREVIEW_ID) as HTMLDivElement | null;
    if (tooltip) return tooltip;
    tooltip = document.createElement('div');
    tooltip.id = SLASH_PREVIEW_ID;
    tooltip.className = 'gv-pm-slash-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.addEventListener('mouseenter', enterCard);
    tooltip.addEventListener('mouseleave', scheduleHide);
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function show(target: HTMLElement, text: string): void {
    cancelHide();
    shownTarget = target;
    const tooltip = ensureCard();
    tooltip.scrollTop = 0;
    paintTooltipBody(tooltip, text, target, onValuesEdited);
    tooltip.dataset.gvTheme = scheme();
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
    tooltip.classList.add(TOOLTIP_VISIBLE_CLASS);
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const padding = 8;
    let left: number;
    let top: number;
    if (resultList.contains(target)) {
      // Slash completion is anchored to Gemini's bottom composer. Keep prompt
      // previews above the whole result list so moving between rows never makes
      // the preview jump from one side to the other. Only fall below when the
      // viewport genuinely has no room above.
      const listRect = resultList.getBoundingClientRect();
      left = Math.max(
        padding,
        Math.min(listRect.left, window.innerWidth - tooltipRect.width - padding),
      );
      top = listRect.top - tooltipRect.height - 6;
      if (top < padding) top = listRect.bottom + 6;
      top = Math.max(padding, Math.min(top, window.innerHeight - tooltipRect.height - padding));
    } else {
      // A token sitting in the composer. Centre the card over it: the card is up
      // to 420px wide and the token is a short name, so aligning either edge puts
      // the whole card off to one side with only a corner near the thing it
      // describes, reading as loose over the page rather than as belonging to the
      // token.
      left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
      if (left + tooltipRect.width > window.innerWidth - padding) {
        left = window.innerWidth - padding - tooltipRect.width;
      }
      if (left < padding) left = padding;

      // Above by preference. The composer is pinned to the bottom of the
      // viewport, so below never fits and trying it first only ever produced the
      // fallback anyway.
      top = targetRect.top - tooltipRect.height - 6;
      if (top < padding) {
        top = targetRect.bottom + 6;
        if (top + tooltipRect.height > window.innerHeight - padding) {
          top = Math.max(padding, window.innerHeight - padding - tooltipRect.height);
        }
      }
    }
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function hide(): void {
    cancelHide();
    conceal();
  }

  return {
    bind: (target, text) => {
      target.addEventListener('mouseenter', () => show(target, text));
      target.addEventListener('mouseleave', scheduleHide);
    },
    bindRow: (row, onEnter) => rows.bind(row, onEnter, scheduleHide),
    cancelAim: rows.stop,
    show,
    scheduleHide,
    hide,
    destroy: () => {
      hide();
      document.getElementById(SLASH_PREVIEW_ID)?.remove();
    },
  };
}

/**
 * The tooltip body, with what was typed into each placeholder marked.
 *
 * A token carries an already-resolved body, so on its own the preview is a wall
 * of template text with the reader's own answers buried in it. The original
 * body rides along on `data-gv-prompt-source`, which is enough to locate them.
 */
function paintTooltipBody(
  tooltip: HTMLElement,
  text: string,
  target: HTMLElement | undefined,
  onValuesEdited: (previous: string, next: string) => void,
): void {
  tooltip.textContent = '';
  const source = target?.dataset.gvPromptSource;
  const match = source
    ? matchSentPrompt(text, [{ id: 'token', name: 'token', text: source }])
    : null;
  if (!source || !match || match.values.length === 0) {
    tooltip.textContent = text;
    tooltip.classList.remove('gv-pm-slash-tooltip-editable');
    return;
  }

  // A token that has not been sent yet is still the person's to change, so the
  // values are fields rather than marks. The body around them is not: it is the
  // saved prompt, and editing that belongs in the prompt manager.
  tooltip.classList.add('gv-pm-slash-tooltip-editable');
  const values = match.values.map(([start, end]) => text.slice(start, end));
  const fields: HTMLElement[] = [];

  const commit = (): void => {
    if (!target) return;
    const previous = target.dataset.gvPromptText ?? text;
    const next = rebuildFromValues(
      source,
      fields.map((field) => field.textContent ?? ''),
    );
    onValuesEdited(previous, next);
    target.dataset.gvPromptText = next;
  };

  let cursor = 0;
  match.values.forEach(([start, end], index) => {
    if (start > cursor) tooltip.append(text.slice(cursor, start));
    // An editable span rather than an `<input>`: an input is single-line by
    // definition, so a long value ran off the side of the card instead of
    // wrapping with the sentence it sits in. A span flows with the prose, and
    // sizing it stops being this code's problem at all.
    const field = document.createElement('span');
    field.className = TOOLTIP_VALUE_CLASS;
    field.setAttribute('contenteditable', 'true');
    field.textContent = values[index];
    field.setAttribute('role', 'textbox');
    field.setAttribute('aria-label', values[index] || 'value');
    field.addEventListener('input', commit);
    field.addEventListener('keydown', (event) => {
      // The list below is still listening for Enter and the arrow keys, and a
      // placeholder holds one value, never a second line.
      event.stopPropagation();
      if (event.key === 'Enter') event.preventDefault();
    });
    field.addEventListener('paste', (event) => {
      // Without this a paste carries the source document's markup in.
      event.preventDefault();
      const plain = event.clipboardData?.getData('text/plain')?.replace(/\s+/g, ' ') ?? '';
      field.ownerDocument.execCommand('insertText', false, plain);
    });
    fields.push(field);
    tooltip.appendChild(field);
    cursor = end;
  });
  if (cursor < text.length) tooltip.append(text.slice(cursor));
}

/** The prompt body with `values` dropped into its placeholders, in order. */
export function rebuildFromValues(source: string, values: string[]): string {
  let index = 0;
  return parsePromptTemplate(source)
    .map((segment) => (segment.kind === 'text' ? segment.value : (values[index++] ?? '')))
    .join('');
}
