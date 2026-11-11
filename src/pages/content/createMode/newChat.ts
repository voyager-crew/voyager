/**
 * Where each site's new chat lives and how Voyager gets there without a page
 * load: the site's own in-app control first, then, only where the router is
 * known to follow it, the History API. Never `location.assign`, `href` or
 * `reload` (AGENTS.md, protected behavior). Only Gemini's targets are proven
 * on the live page; the others are packaged guesses that the live checklist
 * covers, and a miss there leaves the page alone and says so.
 */
import { findGeminiNewChat } from '@/core/gemini/sidebar/actions';
import { chatgptActionSelector } from '@/features/plugins/builtin/chatgptActionTargets';

export interface NewChatTarget {
  /** The new-chat path for the account the page is on. */
  path(location: Location): string;
  /** The site's own control that opens a new chat, or null. */
  link(doc: Document): HTMLElement | null;
  /** The router follows pushState plus popstate, so the History API may stand in for the control. */
  readonly history: boolean;
}

const accountPrefix = (location: Location): string =>
  /^\/u\/\d+/.exec(location.pathname)?.[0] ?? '';

/** A control of the page's own, never one of Voyager's. */
function nativeLink(doc: Document, selector: string): HTMLElement | null {
  const found = doc.querySelector<HTMLElement>(selector);
  return found && !found.closest('[class^="gv-"], [class*=" gv-"]') ? found : null;
}

export const NEW_CHAT_TARGETS = {
  gemini: {
    path: (location) => `${accountPrefix(location)}/app`,
    link: (doc) => findGeminiNewChat(doc),
    history: true,
  },
  aistudio: {
    path: () => '/prompts/new_chat',
    link: (doc) => nativeLink(doc, 'a[href$="/prompts/new_chat"]'),
    history: false,
  },
  chatgpt: {
    path: (location) => {
      const custom = /^(?:\/u\/[^/]+)?\/g\/[^/]+/.exec(location.pathname)?.[0];
      return custom ? `${custom}/` : `${/^\/u\/[^/]+/.exec(location.pathname)?.[0] ?? ''}/`;
    },
    link: (doc) => nativeLink(doc, chatgptActionSelector('actions.newChat', doc)),
    history: false,
  },
  claude: {
    path: () => '/new',
    link: (doc) => nativeLink(doc, 'a[href="/new"]'),
    history: false,
  },
  deepseek: {
    path: () => '/',
    link: (doc) => nativeLink(doc, 'a[href="/"]'),
    history: false,
  },
  kimi: {
    path: () => '/',
    link: (doc) => nativeLink(doc, 'a[href="/"]'),
    history: false,
  },
} as const satisfies Record<string, NewChatTarget>;

export function newChatTarget(siteId: string): NewChatTarget | null {
  return Object.hasOwn(NEW_CHAT_TARGETS, siteId)
    ? NEW_CHAT_TARGETS[siteId as keyof typeof NEW_CHAT_TARGETS]
    : null;
}

const trimSlash = (path: string): string => path.replace(/\/+$/, '');

export function isOnNewChat(target: NewChatTarget, location: Location): boolean {
  return trimSlash(location.pathname) === trimSlash(target.path(location));
}

/** The site's own click sequence, as a sidebar row is opened elsewhere. */
export function clickNativeControl(target: HTMLElement): void {
  const options = { bubbles: true, cancelable: true };
  target.dispatchEvent(new MouseEvent('pointerdown', options));
  target.dispatchEvent(new MouseEvent('mousedown', options));
  target.dispatchEvent(new MouseEvent('mouseup', options));
  target.dispatchEvent(new MouseEvent('click', options));
}

/** Same-document navigation to `path`, as Gemini's router expects; false when it threw. */
export function navigateInApp(path: string): boolean {
  try {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    return true;
  } catch {
    return false;
  }
}
