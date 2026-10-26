/**
 * In-app navigation for AI Studio. A full page load would drop the SPA's
 * state, so these never assign `location`.
 */
import { logger } from '@/core/services/LoggerService';
import {
  aistudioPackagedSelector,
  aistudioLibraryFallbackPath,
  readAIStudioLibraryLink,
} from '@/pages/content/folder/aistudioLocatorReads';

/** Opens /library: the nav's own Library link, else the History API. */
export function openLibraryInApp(): void {
  const link = readAIStudioLibraryLink();
  if (link) {
    link.click();
    return;
  }
  try {
    window.history.pushState({}, '', aistudioLibraryFallbackPath());
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {}
}

/**
 * Opens a prompt: the history list's own link, else the History API. When the
 * History API refuses, the page stays where it is. Returns whether it navigated.
 */
export function openPromptInApp(promptId: string, url: string): boolean {
  const escapedId = Array.from(promptId, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || character === '"' || character === '\\'
      ? `\\${code.toString(16)} `
      : character;
  }).join('');
  const link = document.querySelector<HTMLAnchorElement>(
    `${aistudioPackagedSelector('navigation.promptLink')}[href*="/prompts/${escapedId}"]`,
  );
  if (link) {
    link.click();
    return true;
  }
  try {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
    return true;
  } catch (error) {
    logger.warn('[AIStudioFolder] Could not open the prompt in the app', { url, error });
    return false;
  }
}
