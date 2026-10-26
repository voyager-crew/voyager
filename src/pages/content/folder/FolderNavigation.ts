import { GEMINI_PACKAGED_SIDEBAR_SELECTORS } from '@/core/gemini/sidebar/packaged';
import { closestGeminiSidebarElement } from '@/core/gemini/sidebar/queries';

import { handOffNewChatFolder } from '../folderProject/pendingFolder';
import { watchRouteChanges } from '../utils/routeWatcher';
import { normalizeConversationId, resolveConversationRouteId } from './folderConversationIdentity';
import {
  buildConversationUrlFromId,
  getCurrentConversationId,
  getCurrentHexIdFromLocation,
} from './nativeConversationIds';
import { syncConversationTitleFromNative } from './nativeConversationTitles';
import { findNativeConversationLinkById, triggerNativeConversationClick } from './nativeSidebarDom';
import type { ConversationReference } from './types';

const FOLDER_NAVIGATION_CONFIRM_DELAY_MS = 1200;

interface FolderNavigationOptions {
  getContext(): {
    container: HTMLElement | null;
    sidebar: HTMLElement | null;
    isDestroyed: boolean;
    accountIsolationEnabled: boolean;
  };
  /** The route changed: an account route may now name another account. */
  onRouteChange?(): void;
  /** Whose folders a new chat's folder comes from (`GeminiFolderSession.folderAccount`). */
  folderAccount?(): string | null;
  onOpened(conversationId: string): void;
  onTitleChange(conversationId: string, title: string): void;
  onGemDetected(conversationId: string, gemId: string): void;
  /** The open conversation may have changed: rows drawn elsewhere mark it again. */
  onActiveChange?(): void;
}

function debug(...args: unknown[]): void {
  try {
    if (localStorage.getItem('gvFolderDebug') === '1') console.log('[FolderManager]', ...args);
  } catch {
    /* Debugging must not affect navigation. */
  }
}

/** Owns native-first navigation and the listeners that track its active folder row. */
export class FolderNavigation {
  private activeFolderConversationKey: string | null = null;
  private folderNavigationConfirmTimer: number | null = null;
  private lastPathname: string | null = null;
  private routeChangeCleanup: (() => void) | null = null;
  private sidebarClickListener: ((event: Event) => void) | null = null;
  private boundSidebar: HTMLElement | null = null;
  private readonly timers = new Set<number>();

  constructor(private readonly options: FolderNavigationOptions) {}

  bind(): void {
    this.unbind();
    this.installRouteChangeListener();
    this.installSidebarClickListener();
  }

  /** A sidebar remount replaces listeners but keeps an in-progress navigation. */
  unbind(): void {
    try {
      this.routeChangeCleanup?.();
    } catch (error) {
      debug('Route change cleanup failed:', error);
    }
    this.routeChangeCleanup = null;
    if (this.sidebarClickListener) {
      this.boundSidebar?.removeEventListener('click', this.sidebarClickListener, true);
    }
    this.sidebarClickListener = null;
    this.boundSidebar = null;
  }

  /** Account changes invalidate both the fallback route and delayed page metadata. */
  cancel(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    this.folderNavigationConfirmTimer = null;
    this.activeFolderConversationKey = null;
  }

  destroy(): void {
    this.unbind();
    this.cancel();
  }

  private schedule(callback: () => void, delay: number): number {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      if (!this.options.getContext().isDestroyed) callback();
    }, delay);
    this.timers.add(timer);
    return timer;
  }

  private checkGem(conversationId: string): void {
    this.schedule(() => {
      const gemId = window.location.pathname.match(/\/gem\/([^/]+)/)?.[1];
      if (gemId) this.options.onGemDetected(conversationId, gemId);
    }, 500);
  }

  getConversationHref(conversation: ConversationReference): string {
    const routeId = resolveConversationRouteId(conversation.url, conversation.conversationId);

    try {
      const storedUrl = new URL(conversation.url, window.location.origin);

      if (this.options.getContext().accountIsolationEnabled && routeId) {
        const currentUserMatch = window.location.pathname.match(/\/u\/(\d+)\//);
        const accountPrefix = currentUserMatch ? `/u/${currentUserMatch[1]}` : '';
        return `${storedUrl.origin}${accountPrefix}/app/${routeId}${storedUrl.search}`;
      }

      return storedUrl.toString();
    } catch (error) {
      debug('Failed to build folder conversation href:', error);
    }

    return routeId
      ? buildConversationUrlFromId(routeId, this.options.getContext().accountIsolationEnabled)
      : window.location.href;
  }

  private getInstanceKey(folderId: string, conversationId: string): string {
    return `${folderId}:${conversationId}`;
  }

  /** Whether `folderId` is the folder the open conversation was last opened from. */
  isActiveInstance(folderId: string, conversationId: string): boolean {
    return this.activeFolderConversationKey === this.getInstanceKey(folderId, conversationId);
  }

  highlightActiveConversation(): void {
    const container = this.options.getContext().container;
    if (!container) return;
    this.options.onActiveChange?.();
    const hex = getCurrentHexIdFromLocation();
    const currentId = normalizeConversationId(hex);
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.gv-folder-conversation'));

    rows.forEach((row) => row.classList.remove('gv-folder-conversation-selected'));
    if (!currentId) return;

    const matches = rows.filter((row) => {
      const link = row.querySelector<HTMLAnchorElement>('a.gv-folder-conversation-link[href]');
      return resolveConversationRouteId(link?.href, row.dataset.conversationId) === currentId;
    });
    const activeRow =
      matches.find(
        (row) =>
          row.dataset.folderId &&
          row.dataset.conversationId &&
          this.getInstanceKey(row.dataset.folderId, row.dataset.conversationId) ===
            this.activeFolderConversationKey,
      ) ?? matches[0];

    activeRow?.classList.add('gv-folder-conversation-selected');
  }

  /**
   * Opens a new chat that Folder-as-Project files into `folderId` on its first
   * send, in this page: the folder goes to this tab's picker in the page
   * (`pendingFolder.ts`, never through storage another tab would see), then
   * Gemini's own new-chat link opens the page, or the History API when the
   * link is missing or does not navigate. On the new-chat page already, the
   * picker takes the folder in place. Never a full page load: if both routes
   * fail, the folder stays handed off for this tab's next new chat.
   */
  createNewChatInFolder(folderId: string): void {
    const userPrefix = window.location.pathname.match(/^\/u\/\d+/)?.[0] ?? '';
    const targetPath = `${userPrefix}/app`;
    const onNewChat = () =>
      window.location.pathname === targetPath || window.location.pathname === `${targetPath}/`;
    handOffNewChatFolder(folderId, this.options.folderAccount?.() ?? null);
    if (onNewChat()) return;
    const spaNavigate = () => {
      if (!this.navigateWithSpaRoute(`${window.location.origin}${targetPath}`)) {
        console.warn('[folder] could not open a new chat; the folder stays pending');
      }
    };
    // Gemini's own sidebar control is an in-app route to the new-chat page.
    const link = document.querySelector<HTMLElement>(GEMINI_PACKAGED_SIDEBAR_SELECTORS.newChat);
    if (!link) {
      spaNavigate();
      return;
    }
    triggerNativeConversationClick(link);
    this.schedule(() => {
      if (!onNewChat()) spaNavigate();
    }, FOLDER_NAVIGATION_CONFIRM_DELAY_MS);
  }

  private navigateWithSpaRoute(url: string): boolean {
    try {
      const targetUrl = new URL(url, window.location.origin);
      window.history.pushState({}, '', `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
      const event =
        typeof PopStateEvent === 'function'
          ? new PopStateEvent('popstate', { state: window.history.state })
          : new Event('popstate');
      window.dispatchEvent(event);
      return true;
    } catch (error) {
      debug('SPA route navigation failed:', error);
      return false;
    }
  }

  private clearConfirmation(): void {
    if (this.folderNavigationConfirmTimer === null) return;
    window.clearTimeout(this.folderNavigationConfirmTimer);
    this.timers.delete(this.folderNavigationConfirmTimer);
    this.folderNavigationConfirmTimer = null;
  }

  navigate(conversation: ConversationReference, folderId?: string): void {
    const url = conversation.url;
    if (folderId !== undefined) {
      this.activeFolderConversationKey = this.getInstanceKey(folderId, conversation.conversationId);
    }
    // A newer folder click supersedes any delayed fallback from an older one.
    this.clearConfirmation();

    // Use History API to navigate without page reload (SPA-style)
    // This mimics how Gemini's original conversation links work
    try {
      const targetUrl = new URL(url);
      const hexId = resolveConversationRouteId(targetUrl.toString(), conversation?.conversationId);
      const currentConversationId = getCurrentConversationId();

      let effectivePath: string | null = null;
      let effectiveUrl: string | null = null;

      if (this.options.getContext().accountIsolationEnabled && hexId) {
        // In hard isolation mode, build a navigation URL that matches the
        // current account context:
        // - If the current path contains /u/{num}/, reuse that {num}
        // - Otherwise navigate to /app/{hexId} directly
        // This prevents us from reusing stale /u/{num} segments from previously
        // saved URLs when the active account index has changed.
        const currentPath = window.location.pathname;
        const currentUserMatch = currentPath.match(/\/u\/(\d+)\//);
        if (currentUserMatch) {
          effectivePath = `/u/${currentUserMatch[1]}/app/${hexId}`;
        } else {
          effectivePath = `/app/${hexId}`;
        }
        effectiveUrl = `${window.location.origin}${effectivePath}${targetUrl.search}`;
      }

      const navigationUrl =
        this.options.getContext().accountIsolationEnabled && effectiveUrl ? effectiveUrl : url;
      const finishNavigation = () => {
        this.highlightActiveConversation();

        // After navigation, sync title and check for gem updates
        this.schedule(() => {
          if (conversation && hexId) {
            const syncedTitle = syncConversationTitleFromNative(hexId);
            if (syncedTitle && syncedTitle !== conversation.title) {
              this.options.onTitleChange(hexId, syncedTitle);
              debug('Updated conversation title after navigation:', syncedTitle);
            }
          }

          if (conversation && hexId && !conversation.gemId) {
            this.checkGem(hexId);
          } else if (conversation?.gemId) {
            debug('Known gem conversation:', conversation.gemId);
          }
        }, 300);
      };
      // Missing or slow native links must still preserve the loaded Gemini session.
      const spaNavigate = () => {
        if (hexId) {
          this.options.onOpened(hexId);
        }

        if (this.navigateWithSpaRoute(navigationUrl)) {
          finishNavigation();
        }
      };

      if (hexId && currentConversationId === hexId) {
        this.highlightActiveConversation();
        return;
      }

      const sidebarLink = hexId ? findNativeConversationLinkById(hexId) : null;
      if (!sidebarLink) {
        debug('Sidebar link not found, falling back to SPA route navigation');
        spaNavigate();
        return;
      }

      triggerNativeConversationClick(sidebarLink);
      debug('Triggered native sidebar link click');

      this.folderNavigationConfirmTimer = this.schedule(() => {
        this.folderNavigationConfirmTimer = null;
        if (!hexId || getCurrentConversationId() === hexId) {
          finishNavigation();
          return;
        }

        debug('Native sidebar click did not navigate, falling back to SPA route navigation');
        spaNavigate();
      }, FOLDER_NAVIGATION_CONFIRM_DELAY_MS);
    } catch (error) {
      console.error('[FolderManager] Navigation error:', error);
    }
  }

  private installRouteChangeListener(): void {
    const update = () => {
      if (this.options.getContext().isDestroyed) return;
      this.schedule(() => {
        this.options.onRouteChange?.();
        this.highlightActiveConversation();
        const currentConversationId = getCurrentConversationId();
        if (currentConversationId) {
          this.options.onOpened(currentConversationId);
        }
      }, 0);
    };

    const cleanupFns: (() => void)[] = [];

    try {
      window.addEventListener('popstate', update);
      cleanupFns.push(() => window.removeEventListener('popstate', update));
    } catch (e) {
      debug('Failed to add popstate listener:', e);
    }

    try {
      const hist = history as History & Record<string, unknown>;
      const originalPushState = hist.pushState;
      const originalReplaceState = hist.replaceState;

      const wrap = (
        method: 'pushState' | 'replaceState',
        original: (...args: unknown[]) => unknown,
      ) => {
        hist[method] = function (...args: unknown[]) {
          const ret = original.apply(this, args);
          try {
            update();
          } catch {
            /* Ignore - update is non-critical */
          }
          return ret;
        };
      };
      wrap('pushState', originalPushState as (...args: unknown[]) => unknown);
      wrap('replaceState', originalReplaceState as (...args: unknown[]) => unknown);

      cleanupFns.push(() => {
        hist.pushState = originalPushState;
        hist.replaceState = originalReplaceState;
      });
    } catch (e) {
      debug('Failed to wrap history methods:', e);
    }

    // Shared fallback for routers/flows that don't emit events.
    try {
      this.lastPathname = window.location.pathname;
      cleanupFns.push(
        watchRouteChanges(() => {
          if (this.options.getContext().isDestroyed) return;
          const now = window.location.pathname;
          if (now !== this.lastPathname) {
            this.lastPathname = now;
            update();
          }
        }),
      );
    } catch (e) {
      debug('Failed to setup navigation watcher:', e);
    }

    this.routeChangeCleanup = () => {
      cleanupFns.forEach((fn) => fn());
    };
  }

  private installSidebarClickListener(): void {
    // Capture clicks in Gemini's native sidebar and update highlight after navigation happens
    const root = this.options.getContext().sidebar;
    if (!root) return;

    this.sidebarClickListener = (e: Event) => {
      if (this.options.getContext().isDestroyed) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const a = closestGeminiSidebarElement(target, 'sidebar.conversationLinks');
      if (a) {
        this.schedule(() => this.highlightActiveConversation(), 0);
      }
    };

    this.boundSidebar = root;
    try {
      root.addEventListener('click', this.sidebarClickListener, true);
    } catch (e) {
      debug('Failed to add sidebar click listener:', e);
    }
  }
}
