import {
  resolveSiteSelectorOperationInView,
  getSiteSelectorView,
  getBundledSiteSelectorView,
  type SiteSelectorView,
} from '@/core/selectors';
import { preservesCompleteContent } from '@/core/selectors/contentIntegrity';
import { EXPORT_PROFILES } from '@/core/selectors/contracts/export';
import { logger } from '@/core/services/LoggerService';

import { queryOutsideThoughts, shouldSkipElement } from './exportDomPolicy';
import { getExportReadProfiles } from './exportSiteData';
import sharedContent from './shared-content.json';

function bundledMessageContent(element: HTMLElement, siteId: string): HTMLElement {
  const data = getExportReadProfiles(siteId);
  // Prefer the message-content we were given. querySelector skips the root, so
  // passing <message-content> used to collapse onto an inner .markdown and
  // drop sibling search/generated images (copy-as-image illustrations).
  const givenMessageContent =
    element.tagName.toLowerCase() === data['export.messageContent'] &&
    !element.closest(data['export.thoughts'])
      ? element
      : null;
  let messageContent =
    givenMessageContent || queryOutsideThoughts(element, data['export.messageContent']);

  if (!messageContent) {
    messageContent = queryOutsideThoughts(
      element,
      Object.hasOwn(EXPORT_PROFILES, siteId)
        ? getBundledSiteSelectorView(siteId).profiles['export.assistantContent'].join(',')
        : sharedContent['export.assistantFallback'].join(','),
    );
  }

  if (
    !messageContent &&
    (element.classList.contains(data['export.fallbackClass']) ||
      element.tagName.toLowerCase() === data['export.messageContent'])
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

/** Every accepted body is inside the original message and contains all of its exportable content. */
export function resolveExportMessageContent(element: HTMLElement, siteId = 'gemini'): HTMLElement {
  if (!Object.hasOwn(EXPORT_PROFILES, siteId)) return bundledMessageContent(element, siteId);
  const view = getSiteSelectorView(siteId);
  if (!view.remoteKeys.has('export.assistantContent'))
    return bundledMessageContent(element, siteId);
  const bundle = getBundledSiteSelectorView(siteId);
  const read = (view: SiteSelectorView) => {
    if (!view.remoteKeys.has('export.assistantContent'))
      return bundledMessageContent(element, siteId);
    const candidates = Array.from(
      element.querySelectorAll<HTMLElement>(view.profiles['export.assistantContent'].join(',')),
    );
    return candidates.length === 1 ? candidates[0] : null;
  };
  return (
    resolveSiteSelectorOperationInView(view, read, (candidate) => {
      if (!candidate) return false;
      const reference = read(bundle);
      if (reference !== element) return candidate === reference;
      return preservesCompleteContent(candidate, element, shouldSkipElement);
    }).value ?? bundledMessageContent(element, siteId)
  );
}
