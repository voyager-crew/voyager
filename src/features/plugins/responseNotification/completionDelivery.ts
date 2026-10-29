import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';

/**
 * The site-agnostic half of a completion run: whether a finished reply goes to
 * the system notification, how it is sent, and how a reply node is told apart
 * from an identical earlier one. Each site's run owns its page readers.
 */

const LOG_PREFIX = '[ResponseNotification]';
const MAX_FINGERPRINT_TEXT_LENGTH = 400;
const MAX_NOTIFICATION_PROMPT_LENGTH = 140;

export function shouldNotifyForBackgroundCompletion(): boolean {
  return document.visibilityState !== 'visible' || !document.hasFocus();
}

/** Asks the background for the system notification; false when it was not shown. */
export async function sendCompletionNotification(details: {
  conversationTitle: string;
  userPrompt: string;
}): Promise<boolean> {
  const { userPrompt } = details;
  try {
    const response: unknown = await chrome.runtime?.sendMessage?.({
      type: 'gv.responseComplete.notify',
      payload: {
        conversationUrl: location.href,
        conversationTitle: details.conversationTitle,
        userPrompt:
          userPrompt.length > MAX_NOTIFICATION_PROMPT_LENGTH
            ? `${userPrompt.slice(0, MAX_NOTIFICATION_PROMPT_LENGTH - 1)}…`
            : userPrompt,
      },
    });

    return (
      typeof response === 'object' && response !== null && 'ok' in response && response.ok === true
    );
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      return false;
    }
    console.warn(LOG_PREFIX, 'Failed to send completion notification:', error);
    return false;
  }
}

export function getResponseFingerprint(response: HTMLElement): string | null {
  const text = response.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  if (!text) return null;

  const boundedText =
    text.length > MAX_FINGERPRINT_TEXT_LENGTH ? text.slice(-MAX_FINGERPRINT_TEXT_LENGTH) : text;
  return `${text.length}:${boundedText}`;
}

/** Identical replies (two "OK"s) are still different turns, so each reply node is numbered. */
export function createResponseFingerprinter(): (response: HTMLElement) => string | null {
  const responseIds = new WeakMap<HTMLElement, number>();
  let nextResponseId = 0;
  return (response) => {
    const text = getResponseFingerprint(response);
    if (text === null) return null;
    let id = responseIds.get(response);
    if (id === undefined) responseIds.set(response, (id = nextResponseId++));
    return `${id}|${text}`;
  };
}
