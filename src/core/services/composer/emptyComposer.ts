import { isTextField } from './find';

/** Whitespace, including the zero-width characters editors use to hold a caret. */
const BLANK_TEXT = /^[\s​﻿]*$/;

/**
 * Elements of an empty editor: the paragraph, its trailing `<br>`, and the
 * caret separator image ProseMirror adds. Placeholders are attributes or CSS
 * on the paragraph, never child nodes.
 */
function isEmptySkeletonElement(element: Element): boolean {
  switch (element.tagName) {
    case 'P':
    case 'BR':
      return true;
    case 'IMG':
      return isProseMirrorSeparator(element);
    default:
      return false;
  }
}

/** The only attributes ProseMirror gives its separator image. */
const SEPARATOR_ATTRIBUTES = new Set(['class', 'alt', 'mark-placeholder']);

/**
 * ProseMirror's decorative caret image, exactly as prosemirror-view renders it:
 * `<img class="ProseMirror-separator" alt="">`, plus `mark-placeholder="true"`
 * on the cursor wrapper. Never a source, never alt text; a class alone does not
 * make an image decorative.
 */
function isProseMirrorSeparator(element: Element): boolean {
  return (
    element.classList.contains('ProseMirror-separator') &&
    element.getAttribute('alt') === '' &&
    Array.from(element.attributes).every((attribute) => SEPARATOR_ATTRIBUTES.has(attribute.name))
  );
}

/**
 * A composer Voyager may write a whole message into (the research pack, Create
 * mode): nothing typed, pasted, attached or restored as a draft. Empty text is
 * not enough in an editor, since an image or a mention chip has none; any
 * element outside the empty-editor skeleton counts as content. A text field
 * keeps its text in `value`, not in child nodes.
 */
export function isEmptyComposer(composer: HTMLElement): boolean {
  if (isTextField(composer)) return BLANK_TEXT.test(composer.value);
  const walker = composer.ownerDocument.createTreeWalker(
    composer,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!BLANK_TEXT.test(node.nodeValue ?? '')) return false;
    } else if (!isEmptySkeletonElement(node as Element)) {
      return false;
    }
  }
  return true;
}
