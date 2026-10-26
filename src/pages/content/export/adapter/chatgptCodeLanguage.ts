import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { getBundledSiteSelectorView, getSiteSelectorView } from '@/core/selectors';

const KEY = 'export.codeLanguage';
const COPY_EXCLUDED = '[data-markdown-copy="exclude"]';

/** Metadata must belong to the code's ancestor chain, not the proposed label or nearby prose. */
function codeLanguages(block: Element): Set<string> {
  const languages = new Set<string>();
  for (const code of block.querySelectorAll('code')) {
    if (code.closest(COPY_EXCLUDED)) continue;
    for (let owner: Element | null = code; owner; owner = owner.parentElement) {
      for (const token of owner.classList) {
        const language = /^language-([a-z0-9_+#.-]{1,32})$/i.exec(token)?.[1];
        if (language) languages.add(language.toLowerCase());
      }
      if (owner === block) break;
    }
  }
  return languages;
}

export function chatgptCodeLanguageLabel(block: Element): string {
  const bundle = getBundledSiteSelectorView('chatgpt');
  const fallback = () =>
    block.querySelector(bundle.profiles[KEY].join(','))?.textContent?.trim() ?? '';
  const view = getSiteSelectorView('chatgpt');
  if (!view.remoteKeys.has(KEY)) return fallback();
  try {
    const labels = Array.from(block.querySelectorAll(view.profiles[KEY].join(',')));
    const label = labels[0];
    const text = label?.textContent?.trim() ?? '';
    const languages = codeLanguages(block);
    // An unrelated header word must never become the exported code fence's language.
    return labels.length === 1 &&
      languages.size === 1 &&
      languages.has(text.toLowerCase()) &&
      !label.closest('code, form, [contenteditable], input, textarea, dialog, [role="dialog"]') &&
      !hasVoyagerOwner(label)
      ? text
      : fallback();
  } catch {
    return fallback();
  }
}
