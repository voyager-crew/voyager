import { insertIntoComposer, isQuillComposer, readComposer } from '@/core/services/composer';
import { getBrowserName } from '@/core/utils/browser';
import { formatQuotedText, replaceMathWithLatex } from '@/core/utils/quotedText';

import { findChatInput } from '../chatInput/index';
import { COLLAPSED_CLASS } from '../inputCollapse/dom';
import { expandInputCollapseIfNeeded } from '../inputCollapse/index';
import { capturePageIdentity, isSamePageSession } from '../selectionToolbar/pageIdentity';

const INSERTION_DELAY_MS = 200;

function countLineBreaks(raw: string): number {
  return (raw.match(/\n/g) || []).length;
}

interface SeparatorInsertResult {
  inserted: boolean;
  insertedBreaks: number;
}

function getContenteditableQuoteSeparator(): string {
  // Firefox + Quill contenteditable tends to render an extra visual break
  // for double-newline insertion, so we use a single newline separator there.
  return getBrowserName() === 'Firefox' ? '\n' : '\n\n';
}

function getPlaceholderCandidates(input: HTMLElement): string[] {
  const richTextarea = input.closest('rich-textarea');
  const candidates = [
    input.getAttribute('data-placeholder'),
    input.getAttribute('aria-placeholder'),
    input.getAttribute('placeholder'),
    richTextarea?.getAttribute('data-placeholder'),
    richTextarea?.getAttribute('aria-placeholder'),
    richTextarea?.getAttribute('placeholder'),
  ];

  return candidates.filter((value): value is string => Boolean(value)).map((value) => value.trim());
}

function isChatInputEmpty(input: HTMLElement | HTMLTextAreaElement): boolean {
  if (input instanceof HTMLTextAreaElement) {
    return input.value.trim().length === 0;
  }

  const rawContent = input.innerText ?? input.textContent ?? '';
  const trimmedContent = rawContent.trim();

  // If visible text exists and it's not placeholder text, treat as non-empty even if
  // Quill's `ql-blank` class lags behind DOM updates.
  if (trimmedContent.length > 0) {
    const placeholders = getPlaceholderCandidates(input);
    const isPlaceholderText = placeholders.some(
      (placeholder) => placeholder.length > 0 && placeholder === trimmedContent,
    );
    if (!isPlaceholderText) {
      return false;
    }
  }

  // Gemini currently uses Quill internals. `ql-blank` is its canonical empty marker.
  if (input.classList.contains('ql-blank')) {
    return true;
  }

  return trimmedContent.length === 0;
}

/**
 * Attempts to insert separator text via execCommand and reports whether
 * content changed plus how many line breaks were observed as inserted.
 */
function tryInsertQuoteSeparator(input: HTMLElement, separator: string): SeparatorInsertResult {
  const beforeVisible = input.innerText ?? '';
  const beforeRaw = input.textContent ?? '';
  const beforeVisibleLineBreakCount = countLineBreaks(beforeVisible);
  const beforeRawLineBreakCount = countLineBreaks(beforeRaw);
  let ok = false;
  try {
    ok = document.execCommand('insertText', false, separator);
  } catch {
    ok = false;
  }
  if (!ok) return { inserted: false, insertedBreaks: 0 };

  const afterVisible = input.innerText ?? '';
  const afterRaw = input.textContent ?? '';
  if (afterVisible === beforeVisible && afterRaw === beforeRaw) {
    return { inserted: false, insertedBreaks: 0 };
  }

  const visibleLineBreakDelta = countLineBreaks(afterVisible) - beforeVisibleLineBreakCount;
  const rawLineBreakDelta = countLineBreaks(afterRaw) - beforeRawLineBreakCount;
  const insertedBreaks = Math.max(0, visibleLineBreakDelta, rawLineBreakDelta);
  return { inserted: true, insertedBreaks };
}

function focusChatInput(input: HTMLElement | HTMLTextAreaElement): void {
  if (document.activeElement === input) {
    return;
  }

  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }
}

/**
 * Extract text from a Range, preserving LaTeX math syntax.
 *
 * `Range.toString()` returns visually rendered text, which loses LaTeX
 * delimiters (e.g. `U∈[0,1)` instead of `$U \in [0, 1)$`). This function
 * clones the range contents, replaces math elements with their `$...$` /
 * `$$...$$` LaTeX source, then returns the resulting text.
 */
function extractTextWithLatex(range: Range): string {
  const fragment = range.cloneContents();

  // Short-circuit: no math elements → use native Range.toString()
  if (!fragment.querySelector('.math-inline, .math-block, [data-math]')) {
    return range.toString();
  }

  replaceMathWithLatex(fragment);

  // Use a temporary element to get innerText (preserves newlines from block elements / <br>)
  const temp = document.createElement('div');
  temp.style.position = 'fixed';
  temp.style.left = '-9999px';
  temp.style.opacity = '0';
  temp.style.pointerEvents = 'none';
  temp.appendChild(fragment);
  document.body.appendChild(temp);
  // innerText preserves newlines from block elements / <br>; textContent is the fallback
  const text = temp.innerText ?? temp.textContent ?? '';
  temp.remove();

  return text;
}

function prepareContenteditableQuote(input: HTMLElement, quote: string, isInputEmpty: boolean) {
  // Try to insert a separator via execCommand in one shot.
  // If the command succeeds and mutates content, only the quote body
  // (or missing part of it) remains to be inserted.
  // If insertion does not mutate content, fall back to prepending separator.
  if (isInputEmpty) return { contentToInsert: quote, forceRangeInsertion: false };
  const quoteSeparator = getContenteditableQuoteSeparator();
  const requiredSeparatorBreaks = countLineBreaks(quoteSeparator);
  let contentToInsert: string;
  let forceRangeInsertion = false;
  const separatorResult = tryInsertQuoteSeparator(input, quoteSeparator);
  if (separatorResult.inserted) {
    const missingBreaks = Math.max(0, requiredSeparatorBreaks - separatorResult.insertedBreaks);
    contentToInsert = missingBreaks > 0 ? `${'\n'.repeat(missingBreaks)}${quote}` : quote;
    // Avoid re-running execCommand after partial mutation to prevent duplicate separators.
    forceRangeInsertion = missingBreaks > 0;
  } else {
    contentToInsert = `${quoteSeparator}${quote}`;
  }

  return { contentToInsert, forceRangeInsertion };
}

function appendContenteditableQuote(
  input: HTMLElement,
  quote: string,
  isInputEmpty: boolean,
): void {
  const sel = window.getSelection();

  // For empty editors, insert from start.
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(input);
    if (isInputEmpty) {
      range.collapse(true);
    } else {
      range.collapse(false); // Move cursor to very end
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  const { contentToInsert, forceRangeInsertion } = prepareContenteditableQuote(
    input,
    quote,
    isInputEmpty,
  );

  // Quill handles text insertion better with native insertText command.
  // Fallback to manual Range insertion when command is unavailable.
  let inserted = false;
  if (!forceRangeInsertion) {
    try {
      inserted = document.execCommand('insertText', false, contentToInsert);
    } catch {
      inserted = false;
    }
  }

  if (!inserted) {
    const textNode = document.createTextNode(contentToInsert);
    if (sel && forceRangeInsertion) {
      const endRange = document.createRange();
      endRange.selectNodeContents(input);
      endRange.collapse(false);
      sel.removeAllRanges();
      sel.addRange(endRange);
    }

    if (sel && sel.rangeCount > 0) {
      const insertRange = sel.getRangeAt(0);
      insertRange.insertNode(textNode);

      // Move cursor to after the inserted text
      insertRange.setStartAfter(textNode);
      insertRange.setEndAfter(textNode);
      sel.removeAllRanges();
      sel.addRange(insertRange);
    } else {
      // Fallback: just append to the input
      input.appendChild(textNode);
    }
  }
}

function appendQuote(input: HTMLElement, quoteBody: string): void {
  // Resolve emptiness after the expansion delay; the user may have typed meanwhile.
  if (!isQuillComposer(input)) {
    const prefix = readComposer(input).trim().length === 0 ? '' : '\n\n';
    insertIntoComposer(input, `${prefix}${quoteBody}\n`, 'append');
    return;
  }
  focusChatInput(input);
  const isInputEmpty = isChatInputEmpty(input);
  const quote = `${quoteBody}\n`;
  // Quill's browser-specific separator repair must not become generic paragraph insertion.
  appendContenteditableQuote(input, quote, isInputEmpty);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Schedule a quote in the live composer; false leaves the selection untouched. An accepted quote
 * still lands after the feature stops, but only in the chat, account and composer it was taken in.
 */
export function insertQuotedSelection(range: Range): boolean {
  const selectedText = extractTextWithLatex(range).trim();
  if (!selectedText) return false;

  let input = findChatInput({ online: true });
  if (!input) {
    // Input collapse hides the editor before Quote can expand it; other hidden editors stay untouched.
    const folded = findChatInput({ requireVisible: false, online: true });
    if (folded?.closest(`.${COLLAPSED_CLASS}`)) input = folded;
  }
  if (input) {
    const composer = input;
    const accepted = capturePageIdentity();
    expandInputCollapseIfNeeded();

    // Format: > selection
    // Prepare quote body (without leading/trailing newlines - those are added at insertion time)
    const quoteBody = formatQuotedText(selectedText);

    // Ensure the input is visible
    composer.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Wait for expansion while leaving focus/selection alone until insertion.
    setTimeout(() => {
      // Gemini reuses one composer across chats and accounts: a quote taken in chat A must not
      // land in B, and a replaced composer is no longer the one the user quoted into.
      if (!composer.isConnected || !isSamePageSession(accepted, capturePageIdentity())) return;
      appendQuote(composer, quoteBody);
    }, INSERTION_DELAY_MS);

    return true;
  } else {
    console.warn('[Gemini Voyager] Could not find chat input.');
    return false;
  }
}
