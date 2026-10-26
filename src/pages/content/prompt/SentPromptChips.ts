/**
 * Keeps a sent prompt looking like the token it was chosen as.
 *
 * `expandTokensForSend` replaces the composer token with the full body before
 * submit, so the turn Gemini stores and re-renders is a wall of prompt text.
 * This puts the prompt's name back in front of it, with the words the person
 * typed themselves beside it, and the body one click away.
 *
 * The prompt is re-rendered here rather than revealed in place. Gemini's own
 * lines stay hidden throughout, which buys three things: the body can be set
 * apart as a quotation, the values that were filled in can be marked inside it,
 * and Gemini's clamp and its show-more button are never touched - pressing that
 * button makes Gemini re-render the whole turn, and stripping the clamp makes
 * it put the clamp straight back.
 *
 * Additive only: one inserted container, one class on the lines it stands in
 * for. Nothing Gemini owns is moved, rewritten or removed, because the bubble
 * is re-rendered on navigation and its structure changes without notice.
 */

import { createPackageIcon } from '@/core/icons/promptManagerIcons';
import type { PromptScheme } from '@/features/prompt/PromptSiteAdapter';
import {
  type PromptIdentity,
  type SentPromptMatch,
  compilePrompts,
  matchCompiledPrompt,
} from '@/features/prompt/model/promptTextMatch';
import { getTranslationSync } from '@/utils/i18n';

import { readSentChipTargets } from './sentChipTargets';

const ROOT_CLASS = 'gv-pm-sent';
const CHIP_CLASS = 'gv-pm-sent-chip';
const BODY_CLASS = 'gv-pm-sent-body';
const VALUE_CLASS = 'gv-pm-sent-value';
const REST_CLASS = 'gv-pm-sent-rest';
const LINE_CLASS = 'gv-pm-sent-line';
const MARKED_ATTR = 'data-gv-pm-sent';

const TOGGLE_HIDDEN_CLASS = 'gv-pm-sent-toggle-hidden';

export interface SentPromptChipsOptions {
  /** Saved prompts to recognise. Replaced wholesale by `setPrompts`. */
  prompts: PromptIdentity[];
  /** The page's light/dark, read as each chip is drawn. */
  scheme: () => PromptScheme;
  root?: ParentNode;
}

export interface SentPromptChipsController {
  setPrompts: (prompts: PromptIdentity[]) => void;
  /** Re-scan now. Called by the observer; exposed for tests and navigation. */
  refresh: () => void;
  destroy: () => void;
}

export function startSentPromptChips(options: SentPromptChipsOptions): SentPromptChipsController {
  const root = options.root ?? document;
  let compiled = compilePrompts(options.prompts);
  let destroyed = false;

  const mounted = new Map<HTMLElement, HTMLElement>();

  /**
   * Turns the reader has opened, keyed by their own text.
   *
   * Gemini re-renders a turn for reasons this code does not control, and when
   * it does the container below and every class it set are gone with it. An
   * element reference cannot outlive that, so the open state hangs off the
   * message rather than off the DOM.
   */
  const opened = new Set<string>();

  function release(bubble: HTMLElement): void {
    mounted.get(bubble)?.remove();
    mounted.delete(bubble);
    bubble.removeAttribute(MARKED_ATTR);
    bubble.removeAttribute('data-gv-theme');
    bubble.querySelectorAll(`.${LINE_CLASS}`).forEach((el) => el.classList.remove(LINE_CLASS));
    bubble
      .querySelectorAll(`.${TOGGLE_HIDDEN_CLASS}`)
      .forEach((el) => el.classList.remove(TOGGLE_HIDDEN_CLASS));
  }

  /**
   * The prompt's own text, rebuilt line by line with the filled values marked.
   * Built from the message rather than from the saved prompt, so what is shown
   * is what was actually sent, even if the prompt has been edited since.
   */
  function buildBody(message: string, match: SentPromptMatch): HTMLElement {
    const body = document.createElement('div');
    body.className = BODY_CLASS;

    const promptText = message.slice(0, match.end);
    let line = document.createElement('p');
    body.appendChild(line);

    const emit = (text: string, isValue: boolean): void => {
      const parts = text.split('\n');
      parts.forEach((part, index) => {
        if (index > 0) {
          line = document.createElement('p');
          body.appendChild(line);
        }
        if (!part) return;
        if (!isValue) {
          line.append(part);
          return;
        }
        const mark = document.createElement('mark');
        mark.className = VALUE_CLASS;
        mark.textContent = part;
        line.appendChild(mark);
      });
    };

    let cursor = 0;
    for (const [start, end] of match.values) {
      if (start >= promptText.length) break;
      emit(promptText.slice(cursor, start), false);
      emit(promptText.slice(start, Math.min(end, promptText.length)), true);
      cursor = Math.min(end, promptText.length);
    }
    emit(promptText.slice(cursor), false);

    return body;
  }

  function mount(
    bubble: HTMLElement,
    anchor: HTMLElement,
    message: string,
    match: SentPromptMatch,
    lineEls: HTMLElement[],
    key: string,
    toggle: Element | null,
  ): void {
    const container = document.createElement('div');
    container.className = ROOT_CLASS;

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = CHIP_CLASS;
    // The name alone leaves a chip in a conversation ambiguous - it could be
    // anything the extension put there. The icon says which kind of thing.
    chip.append(createPackageIcon(14), match.name);
    chip.title = getTranslationSync('pm_sent_chip_hint');
    chip.setAttribute('aria-label', match.name);

    const body = buildBody(message, match);

    // Everything past the prompt is the person's own, and stays visible in both
    // states: it is the half of the turn worth reading at a glance.
    const remainder = message.slice(match.end).trim();
    const rest = remainder ? document.createElement('p') : null;
    if (rest) {
      rest.className = REST_CLASS;
      rest.textContent = remainder;
    }

    const head = document.createElement('div');
    head.className = `${ROOT_CLASS}-head`;
    head.appendChild(chip);

    container.append(head, body);
    if (rest) container.appendChild(rest);

    const setOpen = (open: boolean): void => {
      body.hidden = !open;
      chip.setAttribute('aria-expanded', open ? 'true' : 'false');
      container.classList.toggle(`${ROOT_CLASS}-open`, open);
    };

    chip.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = body.hidden;
      if (open) opened.add(key);
      else opened.delete(key);
      setOpen(open);
    });

    for (const line of lineEls) line.classList.add(LINE_CLASS);
    toggle?.classList.add(TOGGLE_HIDDEN_CLASS);
    bubble.setAttribute(MARKED_ATTR, match.name);
    bubble.setAttribute('data-gv-theme', options.scheme());
    anchor.after(container);
    setOpen(opened.has(key));
    mounted.set(bubble, container);
  }

  function refresh(): void {
    if (destroyed) return;
    for (const { bubble, lines: lineEls, anchor, toggle } of readSentChipTargets(root)) {
      const message = lineEls.map((line) => line.textContent ?? '').join('\n');
      const match = lineEls.length > 0 ? matchCompiledPrompt(message, compiled) : null;
      const already = bubble.getAttribute(MARKED_ATTR);

      if (!match) {
        if (already !== null) release(bubble);
        continue;
      }
      // Same prompt, same turn, and the container survived whatever the
      // observer just reacted to.
      if (already === match.name && mounted.get(bubble)?.isConnected) continue;

      release(bubble);
      if (anchor) mount(bubble, anchor, message, match, lineEls, message, toggle);
    }
  }

  // Gemini streams a reply into the same subtree, so the observer fires
  // constantly while one is being written. Coalesce into one pass.
  let scheduled: number | null = null;
  const observer = new MutationObserver(() => {
    if (scheduled !== null) return;
    scheduled = window.setTimeout(() => {
      scheduled = null;
      refresh();
    }, 120);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  refresh();

  return {
    setPrompts: (prompts: PromptIdentity[]) => {
      compiled = compilePrompts(prompts);
      // A renamed or deleted prompt must stop labelling turns it no longer
      // explains, so every mount is torn down before rescanning. Deleting the
      // current key during Map iteration is well defined.
      for (const bubble of mounted.keys()) release(bubble);
      refresh();
    },
    refresh,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      if (scheduled !== null) window.clearTimeout(scheduled);
      scheduled = null;
      for (const bubble of mounted.keys()) release(bubble);
    },
  };
}
