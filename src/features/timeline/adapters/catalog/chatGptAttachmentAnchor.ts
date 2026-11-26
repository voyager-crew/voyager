/** ChatGPT's attachment-only prompts use a user group with no text bubble. */
export function chatGptAttachmentAnchor(keyedTurn: Element): HTMLElement | null {
  return keyedTurn.querySelector<HTMLElement>(
    'h4[data-conversation-role="user"] + [data-chatgpt-search-unit-key]:has(img)',
  );
}
