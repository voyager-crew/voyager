import conversation from '@/features/plugins/catalog/sites/gemini/selector-data/conversation.json';

/** Conversation boundaries stay packaged: matching the bundled root cannot repair a missing one. */
export function resolveGeminiConversationRoot(
  userSelectors: readonly string[],
  doc: Document = document,
): HTMLElement {
  let first: HTMLElement | null = null;
  for (const selector of conversation['conversation.roots']) {
    const candidate = doc.querySelector<HTMLElement>(selector);
    if (!candidate) continue;
    first ??= candidate;
    if (
      userSelectors.length &&
      Array.from(candidate.querySelectorAll(userSelectors.join(','))).some(
        (node) => !node.closest('deep-research-immersive-panel'),
      )
    )
      return candidate;
  }
  return first ?? doc.body;
}
