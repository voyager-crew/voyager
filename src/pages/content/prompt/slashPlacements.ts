/**
 * Prompts placed into the composer by slash completion, from the moment one is
 * chosen until the turn is sent.
 *
 * A placed prompt shows only its name; the body replaces it at send time. The
 * host editor can rebuild a token as plain text, move the caret into it, or
 * swap the whole editor element, so each placement is also remembered here as
 * a name at a text offset. This module is the only owner of those records: it
 * keeps them aligned with typing, with deletion, and with the overlay markers,
 * and expands them into prompt bodies.
 *
 * The records are module-level so `expandAllPromptTokens` can run without a
 * live controller.
 */
import type { PromptScheme } from '@/features/prompt/PromptSiteAdapter';

import { insertTextIntoChatInput } from '../chatInput/index';
import {
  type PromptQuery,
  TOKEN_CLASS,
  TOKEN_SPACER,
  type TokenPrompt,
  dispatchInput,
  findTextBoundary,
  getInputSelectionOffsets,
  getPromptAnchor,
  readText,
  restoreCaretAfterInput,
  restoreCaretAfterPrompt,
} from './slashComposerText';
import { findSlashTokenInput } from './slashInputTargets';
import {
  INPUT_PROMPT_SELECTION_CLASS,
  TEXTAREA_HAS_TOKEN_CLASS,
  TEXTAREA_HIDE_VALUE_CLASS,
  TEXTAREA_TOKEN_CLASS,
  createMarkerLayer,
  stripAllMarkers,
} from './slashMarkers';
import {
  replaceContentEditableQuery,
  replaceTextareaQuery,
  isTextareaPromptOnlyValue,
  getAtomicPromptGap,
  findPromptTokenBeforeCaret,
} from './slashTokenEditing';

type BindPreview = (target: HTMLElement, text: string) => void;

interface SelectedPrompt {
  id: string;
  name: string;
  start: number;
  text: string;
}

interface PendingPromptEdit {
  start: number;
  end: number;
  previousLength: number;
}

type PromptBackspaceResult =
  | { kind: 'spacer'; caretOffset: number; token: HTMLElement | null }
  | { kind: 'prompt'; index: number; caretOffset: number };

const selectedPrompts = new Map<HTMLElement, SelectedPrompt[]>();

export interface PromptPlacements {
  /** Replaces the slash query with `prompt`. False when the query can no longer be located. */
  place: (query: PromptQuery, prompt: TokenPrompt, hideInputValue: boolean) => boolean;
  /** Whether `input` holds a placed prompt that must be expanded before sending. */
  has: (input: HTMLElement) => boolean;
  /** Records the selection an edit is about to replace; call on `beforeinput`. */
  noteEdit: (input: HTMLElement) => void;
  /** Brings the records and markers in line with the composer; call on `input`. */
  afterInput: (input: HTMLElement) => void;
  /** Forgets the prompts the current selection covers. True when there were any. */
  removeSelected: (input: HTMLElement) => boolean;
  /**
   * Deletes the placed prompt (or its trailing spacer) right before the caret
   * as one unit. True when Backspace was handled and the caller must cancel it.
   */
  backspace: (input: HTMLElement) => boolean;
  /** Replaces every placed prompt in `input` with its body. */
  expandForSend: (input: HTMLElement) => void;
  /** Mirrors a selection over placed prompts onto the composer and markers. */
  syncSelection: () => void;
  position: () => void;
  /** Expands every placed prompt and removes the marker layer. */
  destroy: () => void;
}

export function createPromptPlacements({
  bindPreview,
  scheme,
}: {
  bindPreview: BindPreview;
  /** The page's light/dark, from the site adapter. */
  scheme: () => PromptScheme;
}): PromptPlacements {
  const pendingPromptEdits = new WeakMap<HTMLElement, PendingPromptEdit>();
  const markers = createMarkerLayer({
    promptsFor: (input) => selectedPrompts.get(input) || [],
    bindPreview,
    scheme,
  });

  /** Drops the markers along with the records of the composer they describe. */
  function dropMarkers(input: HTMLElement | null): void {
    if (input) selectedPrompts.delete(input);
    markers.clear(input);
  }

  function syncSelection(): void {
    document
      .querySelectorAll<HTMLElement>(`.${INPUT_PROMPT_SELECTION_CLASS}`)
      .forEach((input) => input.classList.remove(INPUT_PROMPT_SELECTION_CLASS));
    markers.markSelected([]);

    for (const input of selectedPrompts.keys()) {
      const selectedIndexes = getSelectedPromptIndexes(input);
      if (selectedIndexes.length === 0) continue;
      if (isPromptOnlySelection(input, selectedIndexes)) {
        input.classList.add(INPUT_PROMPT_SELECTION_CLASS);
      }
      if (markers.input === input) {
        markers.markSelected(selectedIndexes);
      }
      break;
    }
  }

  function removeSelectedPromptRecords(input: HTMLElement, indexes: number[]): void {
    if (indexes.length === 0) return;
    const prompts = selectedPrompts.get(input);
    if (!prompts) return;
    const removed: number[] = [];
    const descendingIndexes = [...new Set(indexes)].sort((left, right) => right - left);
    for (const index of descendingIndexes) {
      if (index < 0 || index >= prompts.length) continue;
      prompts.splice(index, 1);
      removed.push(index);
    }
    if (markers.input === input) markers.remove(removed);
    if (prompts.length === 0) {
      if (markers.input === input) {
        dropMarkers(input);
      } else {
        selectedPrompts.delete(input);
      }
      syncSelection();
      return;
    }
    selectedPrompts.set(input, prompts);
    input.classList.remove(TEXTAREA_HIDE_VALUE_CLASS);
    syncSelection();
  }

  function afterInput(input: HTMLElement): void {
    const inputText = readText(input);
    const rememberedInput = markers.input;
    if (rememberedInput && rememberedInput !== input) {
      const rememberedPrompts = selectedPrompts.get(rememberedInput) || [];
      if (
        rememberedPrompts.length > 0 &&
        rememberedPrompts.every((prompt) => inputText.includes(prompt.name))
      ) {
        selectedPrompts.delete(rememberedInput);
        selectedPrompts.set(input, rememberedPrompts);
        const pendingEdit = pendingPromptEdits.get(rememberedInput);
        if (pendingEdit) {
          pendingPromptEdits.delete(rememberedInput);
          pendingPromptEdits.set(input, pendingEdit);
        }
        markers.follow(input);
      } else {
        dropMarkers(rememberedInput);
      }
    }
    const selected = selectedPrompts.get(input) || [];
    if (input instanceof HTMLTextAreaElement && !isTextareaPromptOnlyValue(inputText, selected)) {
      input.classList.remove(TEXTAREA_HIDE_VALUE_CLASS);
    }
    if (
      selected.length > 0 &&
      (!inputText.trim() || !selected.every((prompt) => inputText.includes(prompt.name)))
    ) {
      dropMarkers(markers.input);
      selectedPrompts.delete(input);
    }
    const pendingEdit = pendingPromptEdits.get(input) || null;
    pendingPromptEdits.delete(input);
    refreshPromptStarts(input, inputText, pendingEdit);
    if (input instanceof HTMLTextAreaElement && !input.value.trim()) {
      dropMarkers(markers.input);
      selectedPrompts.delete(input);
    }
    markers.reflow();
    syncSelection();
  }

  return {
    place: (query, prompt, hideInputValue) => {
      const inserted =
        query.input instanceof HTMLTextAreaElement
          ? replaceTextareaQuery(query, prompt)
          : replaceContentEditableQuery(query, prompt, bindPreview, scheme());
      if (!inserted) return false;
      rememberPrompt(query.input, prompt, query.start);
      markers.add(prompt, query.input, hideInputValue);
      syncSelection();
      return true;
    },
    has: hasPromptToken,
    noteEdit: (input) => {
      const selection = getInputSelectionOffsets(input);
      if (selection) {
        pendingPromptEdits.set(input, {
          ...selection,
          previousLength: readText(input).length,
        });
      }
    },
    afterInput,
    removeSelected: (input) => {
      const indexes = getSelectedPromptIndexes(input);
      if (indexes.length === 0) return false;
      removeSelectedPromptRecords(input, indexes);
      return true;
    },
    backspace: (input) => {
      const result = handlePromptBackspace(input);
      if (!result) return false;
      if (result.kind === 'prompt') {
        if ((selectedPrompts.get(input) || []).length === 0) dropMarkers(input);
        else markers.remove([result.index]);
      }
      dispatchInput(input);
      if (result.kind === 'spacer') {
        restoreCaretAfterPrompt(input, result.token, result.caretOffset);
      } else {
        restoreCaretAfterInput(input, result.caretOffset);
      }
      return true;
    },
    expandForSend: (input) => {
      if (input instanceof HTMLTextAreaElement) {
        expandTextareaPromptTokens(input);
      } else {
        expandPromptTokens(input);
      }
      if (markers.input === input) dropMarkers(input);
    },
    syncSelection,
    position: () => markers.position(),
    destroy: () => {
      expandAllPromptTokens();
      selectedPrompts.clear();
      markers.destroy();
    },
  };
}

function rememberPrompt(input: HTMLElement, prompt: TokenPrompt, start: number): void {
  const selected = selectedPrompts.get(input) || [];
  selected.push({ id: prompt.id, name: prompt.name!.trim(), start, text: prompt.text });
  selectedPrompts.set(input, selected);
}

/**
 * Carry an edit to every place the send path might read it from.
 *
 * A placed prompt exists in up to three: the inline token's dataset, the
 * overlay chip's dataset, and the record `expandPromptTokens` and
 * `expandTextareaPromptTokens` fall back on. Which one is read depends on the
 * composer and on whether the host rebuilt the token as plain text, so an edit
 * that reached only one would send whichever the editor happened to leave
 * behind. The overlay chip in particular is not inside the composer at all -
 * it lives in a fixed container on `body`, so it cannot be found from the
 * input, which is how the first version of this missed it entirely.
 *
 * Matching on the previous body rather than on identity is deliberate: two
 * tokens of the same prompt with the same values are indistinguishable to the
 * reader, so moving them together is the predictable behaviour.
 */
export function syncEditedPromptText(previous: string, next: string): void {
  if (previous === next) return;
  document
    .querySelectorAll<HTMLElement>(`.${TOKEN_CLASS}, .${TEXTAREA_TOKEN_CLASS}`)
    .forEach((element) => {
      if (element.dataset.gvPromptText === previous) element.dataset.gvPromptText = next;
    });
  for (const records of selectedPrompts.values()) {
    for (const record of records) {
      if (record.text === previous) record.text = next;
    }
  }
}

function replaceRangeWithPromptBody(input: HTMLElement, range: Range, body: string): boolean {
  if (!body.includes('\n')) {
    range.deleteContents();
    if (body.length > 0) range.insertNode(document.createTextNode(body));
    return true;
  }
  const selection = window.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return insertTextIntoChatInput(body, input);
}

function expandPromptTokens(input?: HTMLElement | null): void {
  const tokens = Array.from(
    (input || document).querySelectorAll<HTMLElement>(`.${TOKEN_CLASS}`),
  ).reverse();
  if (input) {
    // These offsets describe the editor before live token bodies change its text length.
    const selected = [...(selectedPrompts.get(input) || [])].sort(
      (left, right) => right.start - left.start,
    );
    for (const prompt of selected) {
      // A live token is expanded by the DOM-token pass below. The remembered
      // offset exists so a token that Gemini rebuilt as plain text can still
      // be expanded; applying both paths to the same live token duplicates
      // its body because a Range can insert text inside contenteditable=false.
      if (getPromptAnchor(input, prompt).nativeToken) continue;
      if (readText(input).slice(prompt.start, prompt.start + prompt.name.length) !== prompt.name) {
        continue;
      }
      const start = findTextBoundary(input, prompt.start);
      const end = findTextBoundary(input, prompt.start + prompt.name.length);
      if (!start || !end) continue;
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      replaceRangeWithPromptBody(input, range, prompt.text);
    }
  }
  for (const token of tokens) {
    const body = token.dataset.gvPromptText || token.textContent || '';
    const tokenInput = input || findSlashTokenInput(token);
    if (!tokenInput) continue;
    const range = document.createRange();
    range.selectNode(token);
    replaceRangeWithPromptBody(tokenInput, range, body);
  }
  if (input && (tokens.length > 0 || selectedPrompts.has(input))) {
    selectedPrompts.delete(input);
    input.classList.remove(INPUT_PROMPT_SELECTION_CLASS);
    dispatchInput(input);
  }
}

function expandTextareaPromptTokens(input: HTMLTextAreaElement): void {
  const selected = [...(selectedPrompts.get(input) || [])].sort(
    (left, right) => right.start - left.start,
  );
  let value = input.value;
  for (const prompt of selected) {
    const name = prompt.name;
    const body = prompt.text;
    const index =
      value.slice(prompt.start, prompt.start + name.length) === name ? prompt.start : -1;
    if (index >= 0) value = `${value.slice(0, index)}${body}${value.slice(index + name.length)}`;
  }
  if (value !== input.value) {
    input.value = value;
    dispatchInput(input);
  }
  selectedPrompts.delete(input);
  input.classList.remove(INPUT_PROMPT_SELECTION_CLASS);
}

function hasPromptToken(input: HTMLElement): boolean {
  return selectedPrompts.has(input) || Boolean(input.querySelector(`.${TOKEN_CLASS}`));
}

function getSelectedPromptIndexes(input: HTMLElement): number[] {
  const prompts = selectedPrompts.get(input) || [];
  if (prompts.length === 0) return [];

  const selection = getInputSelectionOffsets(input);
  if (!selection || selection.start === selection.end) return [];
  return prompts.flatMap((prompt, index) => {
    const promptEnd = prompt.start + prompt.name.length;
    return selection.start < promptEnd && selection.end > prompt.start ? [index] : [];
  });
}

function isPromptOnlySelection(input: HTMLElement, selectedIndexes: number[]): boolean {
  if (selectedIndexes.length === 0) return false;
  const selection = getInputSelectionOffsets(input);
  if (!selection || selection.start === selection.end) return false;
  const prompts = selectedPrompts.get(input) || [];
  const inputText = readText(input);

  for (let offset = selection.start; offset < selection.end; offset++) {
    if (/\s/.test(inputText[offset] || '')) continue;
    const belongsToPrompt = selectedIndexes.some((index) => {
      const prompt = prompts[index];
      return prompt && offset >= prompt.start && offset < prompt.start + prompt.name.length;
    });
    if (!belongsToPrompt) return false;
  }
  return true;
}

function refreshPromptStarts(
  input: HTMLElement,
  inputText: string,
  pendingEdit: PendingPromptEdit | null,
): void {
  for (const prompt of selectedPrompts.get(input) || []) {
    // Move the remembered occurrence by the real edit delta before matching names.
    // Otherwise an identical name inserted at the old offset can steal this prompt.
    if (pendingEdit && pendingEdit.end <= prompt.start) {
      prompt.start = Math.max(0, prompt.start + inputText.length - pendingEdit.previousLength);
    }
    const candidates: number[] = [];
    let index = inputText.indexOf(prompt.name);
    while (index >= 0) {
      candidates.push(index);
      index = inputText.indexOf(prompt.name, index + prompt.name.length);
    }
    if (candidates.length > 0) {
      prompt.start = candidates.reduce((closest, candidate) =>
        Math.abs(candidate - prompt.start) < Math.abs(closest - prompt.start) ? candidate : closest,
      );
    }
  }
}

function handlePromptBackspace(input: HTMLElement): PromptBackspaceResult | null {
  const prompts = selectedPrompts.get(input) || [];
  if (prompts.length === 0) return null;

  if (input instanceof HTMLTextAreaElement) {
    const caret = input.selectionStart ?? 0;
    if (caret !== input.selectionEnd) return null;
    for (let index = prompts.length - 1; index >= 0; index--) {
      const prompt = prompts[index];
      const start = prompt.start;
      const promptEnd = start + prompt.name.length;
      if (input.value.slice(start, promptEnd) !== prompt.name) continue;
      if (caret < promptEnd) continue;
      const gap = input.value.slice(promptEnd, caret);
      if (gap !== '' && gap !== TOKEN_SPACER) continue;
      if (gap === TOKEN_SPACER) {
        const caretOffset = caret - TOKEN_SPACER.length;
        input.setRangeText('', caretOffset, caret, 'end');
        return { kind: 'spacer', caretOffset, token: null };
      }
      input.setRangeText('', start, caret, 'end');
      prompts.splice(index, 1);
      if (prompts.length === 0) {
        selectedPrompts.delete(input);
      }
      return { kind: 'prompt', index, caretOffset: start };
    }
    return null;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const caretRange = selection.getRangeAt(0);
  if (!caretRange.collapsed || !input.contains(caretRange.commonAncestorContainer)) return null;
  const prefixRange = caretRange.cloneRange();
  prefixRange.selectNodeContents(input);
  prefixRange.setEnd(caretRange.endContainer, caretRange.endOffset);
  const prefix = prefixRange.toString();

  for (let index = prompts.length - 1; index >= 0; index--) {
    const prompt = prompts[index];
    let startOffset = prompt.start;
    const tokenMatch = findPromptTokenBeforeCaret(input, prompt.id, startOffset, caretRange);
    const token = tokenMatch?.token || null;
    if (tokenMatch) {
      startOffset = tokenMatch.start;
      prompt.start = startOffset;
    }
    if (!token && prefix.slice(startOffset, startOffset + prompt.name.length) !== prompt.name) {
      continue;
    }
    const gapRange = caretRange.cloneRange();
    if (token) {
      gapRange.setStartAfter(token);
    } else {
      const promptEnd = findTextBoundary(input, startOffset + prompt.name.length);
      if (!promptEnd) continue;
      gapRange.setStart(promptEnd.node, promptEnd.offset);
    }
    const gap = getAtomicPromptGap(gapRange);
    if (gap === null) continue;
    if (gap === TOKEN_SPACER) {
      gapRange.deleteContents();
      gapRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(gapRange);
      return {
        kind: 'spacer',
        caretOffset: startOffset + prompt.name.length,
        token,
      };
    }
    const deleteRange = caretRange.cloneRange();
    if (token) {
      deleteRange.setStartBefore(token);
    } else {
      const start = findTextBoundary(input, startOffset);
      if (!start) return null;
      deleteRange.setStart(start.node, start.offset);
    }
    deleteRange.deleteContents();
    deleteRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(deleteRange);
    prompts.splice(index, 1);
    if (prompts.length === 0) {
      selectedPrompts.delete(input);
    }
    return { kind: 'prompt', index, caretOffset: startOffset };
  }
  return null;
}

export function expandAllPromptTokens(): void {
  const inputs = new Set<HTMLElement>();
  document.querySelectorAll<HTMLElement>(`.${TOKEN_CLASS}`).forEach((token) => {
    const input = findSlashTokenInput(token);
    if (input) inputs.add(input);
  });
  for (const input of inputs) expandPromptTokens(input);
  for (const input of selectedPrompts.keys()) {
    if (input instanceof HTMLTextAreaElement) expandTextareaPromptTokens(input);
    else expandPromptTokens(input);
  }
  document
    .querySelectorAll<HTMLTextAreaElement>(`textarea.${TEXTAREA_HAS_TOKEN_CLASS}`)
    .forEach((input) => expandTextareaPromptTokens(input));
  stripAllMarkers();
}
