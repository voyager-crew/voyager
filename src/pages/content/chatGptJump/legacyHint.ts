import { createToaster } from '@/core/ui/toast/toaster';
import { isUserEvent } from '@/core/utils/userEvent';
import { CHATGPT_CONVERSATION_ID_ATTRIBUTE } from '@/features/plugins/builtin';
import { createTranslator, initI18n } from '@/utils/i18n';

const REDIRECT_WINDOW_MS = 30000;
const ROUTE_CHECK_MS = 200;
const CONVERSATION_ROUTE = /^\/c\/([^/]+)\/?$/;
const HOME_ROUTE = '/';

function conversationInRoute(): string | undefined {
  return CONVERSATION_ROUTE.exec(location.pathname)?.[1];
}

/** The URL this document was loaded from; SPA route changes do not rewrite it. */
function loadedUrl(): URL | undefined {
  const entry = performance.getEntriesByType('navigation')[0];
  if (!entry?.name) return undefined;
  try {
    return new URL(entry.name);
  } catch {
    return undefined;
  }
}

/** The host already bounced a saved-turn load home before this script started. */
function bouncedBeforeStart(): boolean {
  if (location.pathname !== HOME_ROUTE) return false;
  const loaded = loadedUrl();
  return (
    loaded?.origin === location.origin &&
    CONVERSATION_ROUTE.test(loaded.pathname) &&
    loaded.hash.startsWith('#gv-turn-')
  );
}

function targetTurnsRendered(conversationId: string): boolean {
  return Array.from(document.querySelectorAll(`[${CHATGPT_CONVERSATION_ID_ATTRIBUTE}]`)).some(
    (node) => node.getAttribute(CHATGPT_CONVERSATION_ID_ATTRIBUTE)?.trim() === conversationId,
  );
}

/** Shows the switch-account hint once i18n is ready; the returned stop removes it. */
function showSwitchHint(): () => void {
  const toaster = createToaster();
  const t = createTranslator();
  let stopped = false;
  const show = (): void => {
    if (stopped) return;
    toaster.show({
      message: t('savedLibraryChatGptSwitchHint'),
      tone: 'warning',
      durationMs: null,
      dismissLabel: t('changelog_close'),
    });
  };
  void initI18n().then(show, show);
  return () => {
    stopped = true;
    toaster.destroy();
  };
}

/**
 * A saved-turn link the host bounces home on its own suggests another account
 * (or a deleted chat). The route alone is language-independent; user input,
 * history navigation and a successful load all mean a later home route is the
 * user's choice, not a bounce.
 */
export function startChatGptLegacyJumpHint(): () => void {
  const target = conversationInRoute();
  // The content script is registered at document_idle, which in a background
  // tab can land after the host has already replaced the route with `/`.
  if (!target) return bouncedBeforeStart() ? showSwitchHint() : () => {};
  if (!location.hash.startsWith('#gv-turn-')) return () => {};
  let hide: (() => void) | undefined;
  let armed = true;

  const disarm = (): void => {
    if (!armed) return;
    armed = false;
    window.removeEventListener('pointerdown', onUserInput, true);
    window.removeEventListener('keydown', onUserInput, true);
    window.removeEventListener('popstate', disarm);
    clearInterval(interval);
    clearTimeout(expiry);
  };
  const onUserInput = (event: Event): void => {
    if (isUserEvent(event)) disarm();
  };
  const check = (): void => {
    if (!armed) return;
    if (conversationInRoute() === target) {
      if (targetTurnsRendered(target)) disarm();
      return;
    }
    const bouncedHome = location.pathname === HOME_ROUTE;
    disarm();
    if (bouncedHome) hide = showSwitchHint();
  };

  // Capture phase sees the click or shortcut before the host's router acts on it.
  window.addEventListener('pointerdown', onUserInput, true);
  window.addEventListener('keydown', onUserInput, true);
  window.addEventListener('popstate', disarm);
  const interval = setInterval(check, ROUTE_CHECK_MS);
  const expiry = setTimeout(disarm, REDIRECT_WINDOW_MS);
  check();
  return () => {
    disarm();
    hide?.();
  };
}
