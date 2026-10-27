/**
 * Slash completion in the Gemini composer: typing `/name` offers saved
 * Prompts by name, places the chosen one as a name token, and expands every
 * placed token into its body just before the turn is sent.
 *
 * This module owns the result list, the completion drawn past the caret, the
 * template fill hand-off and the send interception. What happens to a prompt
 * once it is placed lives in `slashPlacements.ts`.
 */
import browser from 'webextension-polyfill';

import { promptStorageService } from '@/core/services/StorageService';
import { isImeKeyEvent } from '@/core/services/composer/sendKeys/sendKeyIntent';
import { StorageKeys } from '@/core/types/common';
import { type PromptItem } from '@/core/types/sync';
import type { PromptScheme } from '@/features/prompt/PromptSiteAdapter';
import { isPromptTemplate } from '@/features/prompt/model/promptTemplate';
import { getTranslationSync } from '@/utils/i18n';

import { followGeminiSendKey } from '../sendBehavior/followSendKey';
import { findClosestSendActionButton, isSendKeyboardEvent } from '../sendBehavior/sendButton';
import { type TemplateFillHandle } from './PromptTemplateFill';
import { createPromptSendReplay } from './promptPageScope';
import { openScopedTemplateFill } from './scopedTemplateFill';
import {
  type PromptQuery,
  TOKEN_CLASS,
  completeQuery,
  getPromptQuery,
  getQueryAnchorRect,
  placeCaretAtInputStart,
  readText,
} from './slashComposerText';
import {
  inputFromTarget,
  findPromptInputForSendButton,
  findSlashFormInput,
  isInsideSlashInput,
} from './slashInputTargets';
import { ghostSuffix, isPromptItem, matchSlashPrompts } from './slashMatch';
import { createPromptPlacements, syncEditedPromptText } from './slashPlacements';
import { SLASH_PREVIEW_ID, createSlashPreview } from './slashPreview';
import { hideGhost, removeGhost, showGhost } from './slashPromptView';

const ROOT_ID = 'gv-pm-slash-root';
const LIST_ID = 'gv-pm-slash-list';

export interface SlashPromptController {
  destroy: () => void;
}

interface SlashPromptOptions {
  /** The page's light/dark, from the site adapter; every slash surface paints in it. */
  scheme: () => PromptScheme;
  initialItems?: PromptItem[];
  initialCtrlEnterSend?: boolean;
}

export function startPromptSlashCommand(options: SlashPromptOptions): SlashPromptController {
  if (!document.body || document.getElementById(ROOT_ID)) return { destroy: () => {} };

  let items = Array.isArray(options.initialItems) ? options.initialItems.filter(isPromptItem) : [];
  let activeInput: HTMLElement | null = null;
  let activeQuery: PromptQuery | null = null;
  let selectedIndex = 0;
  let results: PromptItem[] = [];
  let ctrlEnterSendEnabled = options.initialCtrlEnterSend === true;
  const effectiveSendKey = followGeminiSendKey((key) => {
    ctrlEnterSendEnabled = key === 'ctrlEnter';
  });
  const { scheme } = options;
  const slashRefreshSuppressedInputs = new WeakSet<HTMLElement>();

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'gv-pm-slash-root';
  root.dataset.gvInteraction = 'keyboard';
  root.hidden = true;
  const list = document.createElement('div');
  list.id = LIST_ID;
  list.className = 'gv-pm-slash-list';
  list.setAttribute('role', 'listbox');
  root.appendChild(list);
  document.body.appendChild(root);

  const preview = createSlashPreview({
    resultList: root,
    onValuesEdited: syncEditedPromptText,
    scheme,
  });
  const placements = createPromptPlacements({ bindPreview: preview.bind, scheme });

  /* Outlives `close()` on purpose: accepting a template closes the result list
   * and then opens this, so tearing it down here would dismiss it instantly.
   * Page/account changes and `destroy` close it. */
  let templateFill: TemplateFillHandle | null = null;
  const sendReplay = createPromptSendReplay();

  function close(): void {
    root.hidden = true;
    activeInput = null;
    activeQuery = null;
    results = [];
    preview.hide();
    hideGhost();
  }

  function expandTokensForSend(input: HTMLElement): void {
    close();
    slashRefreshSuppressedInputs.add(input);
    try {
      placements.expandForSend(input);
    } finally {
      slashRefreshSuppressedInputs.delete(input);
    }
  }

  function position(): void {
    root.dataset.gvTheme = scheme();
    if (activeInput && activeQuery && !root.hidden) {
      const rect = activeInput.getBoundingClientRect();
      const anchorRect = getQueryAnchorRect(activeQuery, rect);
      const width = Math.max(120, Math.min(380, rect.width || 320, window.innerWidth - 16));
      root.style.width = `${Math.round(width)}px`;
      root.style.left = `${Math.round(
        Math.max(8, Math.min(anchorRect.left, window.innerWidth - width - 8)),
      )}px`;
      const listHeight = list.getBoundingClientRect().height || 240;
      const below = anchorRect.bottom + 6;
      const above = anchorRect.top - listHeight - 6;
      const spaceBelow = window.innerHeight - below - 8;
      const spaceAbove = anchorRect.top - 14;
      const preferredTop = spaceBelow >= listHeight || spaceBelow >= spaceAbove ? below : above;
      const maxTop = Math.max(8, window.innerHeight - listHeight - 8);
      root.style.top = `${Math.round(Math.max(8, Math.min(preferredTop, maxTop)))}px`;
    }
    placements.position();
  }

  /*
   * A template collects its values before the token is placed, so the token
   * carries an already-resolved body. That keeps `expandTokensForSend` and the
   * textarea overlay markers untouched: they still see one prompt with one
   * text. "Keep as is" is the deferred path — it stores the body with its
   * placeholders intact, which then expands literally at send time.
   */
  function openTemplateFillForQuery(
    query: PromptQuery,
    prompt: PromptItem,
    hideInputValue: boolean,
  ): void {
    templateFill?.close();
    templateFill = openScopedTemplateFill({
      text: prompt.text,
      name: prompt.name?.trim() || undefined,
      // Anchored to the composer, not to the result list: the list has just
      // been closed and a hidden element has no rect to position against.
      anchor: query.input,
      theme: scheme(),
      labels: {
        insert: getTranslationSync('pm_fill_insert'),
        keepRaw: getTranslationSync('pm_fill_keep_raw'),
        title: getTranslationSync('pm_fill_title'),
      },
      onSubmit: (filled) => {
        templateFill = null;
        try {
          query.input.focus?.();
        } catch {}
        placements.place(
          query,
          { ...prompt, text: filled, gvSourceText: prompt.text },
          hideInputValue,
        );
      },
      onCancel: () => {
        templateFill = null;
      },
    });
  }

  function confirm(index: number): boolean {
    if (!activeQuery || !results[index]) return false;
    const prompt = results[index];
    const query = activeQuery;
    const hideInputValue = query.start === 0 && query.end === readText(query.input).length;

    if (isPromptTemplate(prompt.text)) {
      // Grow the query into the name first. A template collects its values
      // before the token is placed, so without this the composer sat on the
      // bare `/` for the whole time the fill surface was open and said nothing
      // about what had just been chosen.
      const name = prompt.name!.trim();
      const completed = completeQuery(query, name)
        ? {
            ...query,
            query: name,
            end: query.start + 1 + name.length,
          }
        : query;
      close();
      openTemplateFillForQuery(
        completed,
        prompt,
        completed.start === 0 && completed.end === readText(completed.input).length,
      );
      return true;
    }

    if (!placements.place(query, prompt, hideInputValue)) return false;
    close();
    return true;
  }

  function render(nextResults: PromptItem[]): void {
    results = nextResults;
    selectedIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));
    list.replaceChildren();
    if (results.length === 0) {
      close();
      return;
    }
    root.hidden = false;
    syncGhost();
    results.forEach((prompt, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'gv-pm-slash-option';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', index === selectedIndex ? 'true' : 'false');
      const name = document.createElement('span');
      name.className = 'gv-pm-slash-option-name';
      name.textContent = prompt.name!.trim();
      row.appendChild(name);
      const tags = document.createElement('span');
      tags.className = 'gv-pm-slash-option-tags';
      for (const tag of prompt.tags || []) {
        const tagEl = document.createElement('span');
        tagEl.className = 'gv-pm-slash-option-tag';
        tagEl.textContent = tag;
        tags.appendChild(tagEl);
      }
      row.appendChild(tags);
      preview.bindRow(row, () => {
        root.dataset.gvInteraction = 'pointer';
        selectedIndex = index;
        renderSelectionState();
        preview.show(row, prompt.text);
      });
      row.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        confirm(index);
      });
      list.appendChild(row);
    });
    position();
  }

  function renderSelectionState(): void {
    list.querySelectorAll<HTMLElement>('.gv-pm-slash-option').forEach((option, index) => {
      option.setAttribute('aria-selected', index === selectedIndex ? 'true' : 'false');
    });
    syncGhost();
  }

  /** Keep the completion showing the row that Enter would actually take. */
  function syncGhost(): void {
    const prompt = results[selectedIndex];
    if (!activeQuery || root.hidden || !prompt?.name) {
      hideGhost();
      return;
    }
    showGhost(activeQuery, prompt.name, scheme());
  }

  function refresh(target: EventTarget | null): void {
    const input = inputFromTarget(target);
    if (!input) return;
    const query = getPromptQuery(input);
    if (!query) {
      close();
      return;
    }
    activeInput = input;
    activeQuery = query;
    selectedIndex = 0;
    render(matchSlashPrompts(items, query.query));
  }

  function onInput(event: Event): void {
    const input = inputFromTarget(event.target);
    if (!input) return;
    if (slashRefreshSuppressedInputs.has(input)) return;
    placements.afterInput(input);
    refresh(event.target);
  }

  function onKeydown(event: KeyboardEvent): void {
    const input = inputFromTarget(event.target);
    if (!input) return;
    if (isImeKeyEvent(event)) return;

    if (event.key === 'Home' && !event.shiftKey && !event.altKey && placements.has(input)) {
      // A selected prompt starts with an atomic contenteditable=false token.
      // Native Home can place the selection inside that token, where browsers
      // keep focus on the editor but do not paint a caret.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      placeCaretAtInputStart(input);
      return;
    }

    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      !root.hidden &&
      activeInput === input
    ) {
      // Gemini can rebuild the editor while deleting, which means the ensuing
      // input event may no longer resolve to this active input. Invalidate the
      // old completion now; a still-valid slash query will reopen on input.
      close();
    }

    if ((event.key === 'Backspace' || event.key === 'Delete') && placements.removeSelected(input)) {
      return;
    }

    if (event.key === 'Backspace' && placements.backspace(input)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }

    if (!root.hidden && activeInput === input && results.length > 0) {
      if (['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(event.key)) preview.cancelAim();
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        root.dataset.gvInteraction = 'keyboard';
        selectedIndex =
          (selectedIndex + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
        renderSelectionState();
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.altKey)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        // Tab takes the completion that is already drawn past the caret, and
        // stops there. Pressing it used to place the token outright, which for
        // a template meant the fill surface opened over a composer still
        // reading `/a` - the completion it had just offered never arrived.
        const selected = results[selectedIndex];
        if (
          event.key === 'Tab' &&
          activeQuery &&
          selected?.name &&
          ghostSuffix(activeQuery.query, selected.name) &&
          completeQuery(activeQuery, selected.name)
        ) {
          return;
        }
        confirm(selectedIndex);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
    }

    if (event.key === 'Escape' && !root.hidden) {
      close();
      return;
    }

    if (isSendKeyboardEvent(event, ctrlEnterSendEnabled ? 'ctrlEnter' : 'host')) {
      if (!placements.has(input)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      expandTokensForSend(input);
      sendReplay.schedule(() => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: event.code || 'Enter',
            bubbles: true,
            cancelable: true,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          }),
        );
      });
    }
  }

  function onBeforeInput(event: InputEvent): void {
    const input = inputFromTarget(event.target);
    if (!input) return;
    placements.noteEdit(input);
    if (!event.inputType.startsWith('delete')) return;
    if (!root.hidden && activeInput === input) close();
    placements.removeSelected(input);
  }

  function onPointerDown(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(`#${ROOT_ID}, #${SLASH_PREVIEW_ID}`)) return;
    if (!target || !isInsideSlashInput(target)) close();
  }

  function onSubmit(event: Event): void {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    const input = findSlashFormInput(form);
    if (!input || !placements.has(input)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    expandTokensForSend(input);
    const submitter = event instanceof SubmitEvent ? event.submitter : null;
    sendReplay.schedule(() => {
      if (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) {
        form.requestSubmit(submitter);
      } else {
        form.requestSubmit();
      }
    });
  }

  function onClick(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    const button = target ? findClosestSendActionButton(target) : null;
    if (!button) return;
    const input = findPromptInputForSendButton(button, placements.has);
    if (!input) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    expandTokensForSend(input);
    sendReplay.schedule(() => button.click());
  }

  function onPointerOver(event: PointerEvent): void {
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>(`.${TOKEN_CLASS}`) : null;
    if (target) preview.show(target, target.dataset.gvPromptText || target.textContent || '');
  }

  function onPointerOut(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target.closest(`.${TOKEN_CLASS}`) : null;
    if (target) preview.scheduleHide();
  }

  function onStorageChanged(
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void {
    if (area === 'sync' && changes[StorageKeys.CTRL_ENTER_SEND]) {
      if (!effectiveSendKey.isFollowing()) {
        ctrlEnterSendEnabled = changes[StorageKeys.CTRL_ENTER_SEND].newValue === true;
      }
      return;
    }
    if (area !== 'local') return;
    const change = changes[StorageKeys.PROMPT_ITEMS];
    if (!change || !Array.isArray(change.newValue)) return;
    items = change.newValue.filter(isPromptItem);
    if (activeInput && activeQuery) render(matchSlashPrompts(items, activeQuery.query));
  }

  const onScrollOrResize = () => position();
  document.addEventListener('input', onInput, true);
  document.addEventListener('beforeinput', onBeforeInput, true);
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('pointerover', onPointerOver, true);
  document.addEventListener('pointerout', onPointerOut, true);
  document.addEventListener('selectionchange', placements.syncSelection);
  document.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);
  browser.storage.onChanged.addListener(onStorageChanged);

  return {
    destroy: () => {
      sendReplay.destroy();
      effectiveSendKey.stop();
      templateFill?.close();
      templateFill = null;
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('beforeinput', onBeforeInput, true);
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('selectionchange', placements.syncSelection);
      document.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      browser.storage.onChanged.removeListener(onStorageChanged);
      preview.hide();
      placements.destroy();
      root.remove();
      preview.destroy();
      removeGhost();
    },
  };
}

export async function startStoredPromptSlashCommand(
  scheme: () => PromptScheme,
): Promise<SlashPromptController> {
  const [stored, sendMode] = await Promise.all([
    promptStorageService.get<PromptItem[]>(StorageKeys.PROMPT_ITEMS),
    browser.storage.sync
      .get({ [StorageKeys.CTRL_ENTER_SEND]: false })
      .catch(() => ({ [StorageKeys.CTRL_ENTER_SEND]: false })),
  ]);
  return startPromptSlashCommand({
    scheme,
    initialItems: stored.success && Array.isArray(stored.data) ? stored.data : [],
    initialCtrlEnterSend: sendMode[StorageKeys.CTRL_ENTER_SEND] === true,
  });
}
