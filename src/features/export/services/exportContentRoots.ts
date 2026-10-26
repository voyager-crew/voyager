import { logger } from '@/core/services/LoggerService';

import { queryOutsideThoughts } from './exportDomPolicy';

export function resolveExportMessageContent(element: HTMLElement): HTMLElement {
  // Prefer the message-content we were given. querySelector skips the root, so
  // passing <message-content> used to collapse onto an inner .markdown and
  // drop sibling search/generated images (copy-as-image illustrations).
  const givenMessageContent =
    element.tagName.toLowerCase() === 'message-content' &&
    !element.closest('model-thoughts, .thoughts-container, .thoughts-content')
      ? element
      : null;
  let messageContent = givenMessageContent || queryOutsideThoughts(element, 'message-content');

  if (!messageContent) {
    messageContent = queryOutsideThoughts(
      element,
      '.markdown-main-panel, .markdown, .model-response-text',
    );
  }

  if (
    !messageContent &&
    (element.classList.contains('markdown') || element.tagName.toLowerCase() === 'message-content')
  ) {
    messageContent = element;
  }

  if (!messageContent) {
    // Last resort: use element directly
    logger.warn('[DOMContentExtractor] Response container not found, using element directly');
    messageContent = element;
  }

  return messageContent as HTMLElement;
}
