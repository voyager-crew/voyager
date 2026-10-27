import { isEditable, isTextField } from './find';
import { insertLexicalText, isLexicalComposer } from './lexical';
import { insertQuillText, replaceQuillText } from './quill';
import { setTextFieldValue } from './textField';

export type ComposerInsertMode = 'append' | 'replace' | 'insertAtCursor';

export { findComposer } from './find';
export type { FindComposerOptions } from './find';

// ChatGPT turns a Drive link into a chip whose svg icon carries a <style> sheet; its CSS is not draft text.
const NON_TEXT_ELEMENTS = new Set(['style', 'script', 'svg', 'template']);

function domText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
  if (node instanceof Element && NON_TEXT_ELEMENTS.has(node.localName)) return '';
  if (
    node instanceof Element &&
    /^(P|DIV)$/.test(node.tagName) &&
    node.childNodes.length === 1 &&
    node.firstChild instanceof Element &&
    node.firstChild.tagName === 'BR'
  )
    return '';
  if (node instanceof Element && node.tagName === 'BR') {
    return node.classList.contains('ProseMirror-trailingBreak') ? '' : '\n';
  }
  const children = Array.from(node.childNodes);
  return children
    .map((child, index) => {
      const isBlock = (candidate: Node) =>
        candidate instanceof Element && /^(P|DIV|LI)$/.test(candidate.tagName);
      const separator = index > 0 && (isBlock(child) || isBlock(children[index - 1])) ? '\n' : '';
      return separator + domText(child);
    })
    .join('');
}

/** Plain text only; attachment/mention emptiness remains the receiver's stricter check. */
export function readComposer(field: HTMLElement): string {
  if (isTextField(field)) return field.value;
  // innerText separates paragraphs with a blank line, so a read-back draft would grow on every restore.
  const text = domText(field)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ');
  // An empty ProseMirror paragraph contributes a layout newline, not draft text.
  if (
    text.trim().length === 0 &&
    !field.textContent?.replace(/[\u200b\ufeff]/g, '') &&
    field.children.length <= 1 &&
    !field.querySelector('p p, p div, br + br')
  )
    return '';
  return text;
}

export function isQuillComposer(field: HTMLElement): boolean {
  return (
    !isTextField(field) &&
    (field.matches('.ql-editor, .ql-blank') || field.closest('rich-textarea') !== null)
  );
}

function insertTextField(
  field: HTMLTextAreaElement | HTMLInputElement,
  text: string,
  mode: ComposerInsertMode,
): void {
  field.focus();
  const current = field.value;
  const start =
    mode === 'replace'
      ? 0
      : mode === 'append'
        ? current.length
        : (field.selectionStart ?? current.length);
  const end =
    mode === 'replace'
      ? current.length
      : mode === 'append'
        ? current.length
        : (field.selectionEnd ?? start);
  const next = current.slice(0, start) + text + current.slice(end);
  if (next === current) return;
  setTextFieldValue(field, next, start + text.length);
}

/** Returns true when the host editor took the edit itself and renders it later (Lexical). */
function insertContentEditable(
  field: HTMLElement,
  text: string,
  mode: ComposerInsertMode,
): boolean {
  const doc = field.ownerDocument;
  const selection = doc.getSelection();
  if (!selection) return false;
  const current = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const useCurrent =
    mode === 'insertAtCursor' && current && field.contains(current.commonAncestorContainer);
  const range = useCurrent ? current.cloneRange() : doc.createRange();
  if (!useCurrent) {
    range.selectNodeContents(field);
    if (mode !== 'replace') range.collapse(false);
  }
  field.focus();
  selection.removeAllRanges();
  selection.addRange(range);
  // Lexical drops a native insert that opens new blocks, so a quote below a draft vanished.
  if (text.length > 0 && isLexicalComposer(field) && insertLexicalText(field, text)) return true;
  try {
    // ProseMirror needs a native editing transaction; DOM/beforeinput fallbacks lose host state.
    if (mode === 'replace' && text.length === 0) doc.execCommand('delete', false);
    else doc.execCommand('insertText', false, text);
  } catch {
    // Unavailable editing commands leave the host document unchanged.
  }
  return false;
}

/** Edit only: no keyboard events, send-button clicks or form submission. */
export function insertIntoComposer(
  field: HTMLElement,
  text: string,
  mode: ComposerInsertMode,
): boolean {
  if (!isEditable(field) || (text.length === 0 && mode !== 'replace')) return false;
  const before = readComposer(field);
  if (isTextField(field)) {
    insertTextField(field, text, mode);
  } else if (isQuillComposer(field)) {
    if (mode === 'replace') replaceQuillText(field, text);
    else insertQuillText(field, text, mode);
  } else if (insertContentEditable(field, text, mode)) {
    return true;
  }
  return readComposer(field) !== before;
}
