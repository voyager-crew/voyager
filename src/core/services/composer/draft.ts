const COMPOSER_BLOCK_TAGS = new Set([
  'ADDRESS',
  'BLOCKQUOTE',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'P',
  'PRE',
]);

// textContent merges paragraphs, which makes multiline delivery verification fail.
function readComposerDomText(root: HTMLElement): string {
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent || '');
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.tagName === 'BR') {
      parts.push('\n');
      return;
    }
    const block = COMPOSER_BLOCK_TAGS.has(node.tagName);
    if (block && parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) parts.push('\n');
    node.childNodes.forEach(visit);
    if (block && !parts[parts.length - 1]?.endsWith('\n')) parts.push('\n');
  };
  root.childNodes.forEach(visit);
  return parts.join('');
}

export function readComposerText(input: HTMLElement): string {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) return input.value;
  return readComposerDomText(input);
}

/** Baseline attachment-presence protocol shared by send tracking and composer delivery. */
export function hasComposerAttachments(root: Element): boolean {
  const fileInputs = root.querySelectorAll<HTMLInputElement>('input[type="file"]');
  if (Array.from(fileInputs).some((fileInput) => (fileInput.files?.length ?? 0) > 0)) return true;
  // The live card (2026-10-18) has none of the markers below and the input is empty by then;
  // its container stays in the form, childless, once the file is removed.
  if ((root.querySelector('[data-composer-attachments]')?.childElementCount ?? 0) > 0) return true;

  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-attachment-id], [data-file-id], [data-testid]'),
  ).some((candidate) => {
    if (candidate.matches('input, button, label, [hidden], [aria-hidden="true"]')) return false;
    if (candidate.hasAttribute('data-attachment-id') || candidate.hasAttribute('data-file-id')) {
      return true;
    }
    const testId = candidate.dataset.testid?.toLowerCase() || '';
    if (/(attachment|file|upload)/.test(testId) && /preview/.test(testId)) return true;
    return (
      /(attachment|file)/.test(testId) && !/(add|button|input|menu|picker|upload)/.test(testId)
    );
  });
}
