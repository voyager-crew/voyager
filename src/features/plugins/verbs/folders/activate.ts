/**
 * Folders on the shared folder core for a plugin site: a folder section in the
 * site's sidebar (introduced once by a guide), the shared floating panel, and,
 * where the site offers them, "Move to folder" in a row's menu, a row dragged
 * onto a folder, and the site's own rename. `site` holds everything that is the
 * site's; everything created here is registered on `scope`, and the folder
 * data is a lease on the site's session (`siteSession.ts`).
 */
import type { ConversationReference } from '@/core/types/folder';
import { type Dispose, PluginScope } from '@/features/plugins/runtime/pluginScope';
import { sendSiteOf, trackUserSends } from '@/features/plugins/sends/trackUserSends';
import type { PluginSettings, SiteAdapter } from '@/features/plugins/types';
import type { SiteFolderNotify } from '@/pages/content/folder/SiteFolderStore';
import { watchRouteChanges } from '@/pages/content/utils/routeWatcher';
import { getTranslationSyncUnsafe as t, initI18n } from '@/utils/i18n';

import { SiteFolderGuide } from './folderGuide';
import { SiteFoldersView } from './foldersView';
import { HIDE_FILED_SETTING, SidebarHideFiled } from './hideFiled';
import { startNewChatFiling } from './newChatFiling';
import { siteNewChatPort } from './newChatSite';
import { loadPanelPrefs } from './panelPrefs';
import { type DroppedConversation, bindSidebarRowDrag } from './rowDrag';
import { loadSectionPrefs } from './sectionPrefs';
import { SidebarWatcher } from './sidebarWatcher';
import { openSiteFolderSession } from './siteSession';
import { SidebarTitleSync } from './titleSync';
import type { SidebarConversation, SiteFoldersAdapter } from './types';

/** A sidebar row as the folder entry it files. */
function referenceOf(
  site: SiteFoldersAdapter,
  row: SidebarConversation,
  origin: string,
): DroppedConversation {
  return {
    conversationId: site.identity.storedId(row.id),
    title: site.sidebar.title(row) || t(site.messages.untitled),
    url: `${origin}${row.path}`,
  };
}

/**
 * Records when the user last sent to each chat, for the Activity view. A send
 * seen while the stored folders still load waits for them; the store refuses
 * edits until then, and the tracker has already let the send go.
 */
function trackActivity(
  scope: PluginScope,
  key: string,
  sendSite: NonNullable<ReturnType<typeof sendSiteOf>>,
  store: { readonly ready: boolean; subscribe(listener: () => void): () => void },
  setActivity: (entries: { conversationId: string; lastTurnAt: number }[]) => void,
): void {
  const waiting = new Map<string, number>();
  const flush = (): void => {
    // Storage can finish loading while the folders turn off; nothing is saved after that.
    if (scope.isDisposed || !store.ready || waiting.size === 0) return;
    const entries = Array.from(waiting, ([conversationId, lastTurnAt]) => ({
      conversationId,
      lastTurnAt,
    }));
    waiting.clear();
    setActivity(entries);
  };
  scope.effect(() => {
    const unsubscribe = store.subscribe(flush);
    return () => {
      unsubscribe();
      waiting.clear();
    };
  }, `${key}:activity-wait`);
  // A chat's Activity time is when the user last sent a message in it.
  trackUserSends(scope, sendSite, ({ conversationKey, at }) => {
    waiting.set(conversationKey, Math.max(at, waiting.get(conversationKey) ?? 0));
    flush();
  });
}

/** A running site folders runtime, as its plugin handler sees it. */
export interface SiteFoldersRuntime {
  /** Settles once start-up finished, or stopped early because the folders went off. */
  readonly started: Promise<void>;
  /** Applies new plugin settings in place: hiding filed chats turns on or off, the folders stay loaded. */
  updateSettings(settings: PluginSettings): void;
  /** 1 while the folders are on screen (the sidebar section or the floating button), else 0. */
  onScreen(): number;
}

/**
 * Starts a site's folders on `scope`. Start-up runs as one of the scope's
 * effects, so turning the folders off while it still awaits waits for it and
 * leaves nothing behind; the folder data is a lease on the site's session,
 * released (and drained) last.
 */
export function startSiteFolders(
  scope: PluginScope,
  site: SiteFoldersAdapter,
  settings: PluginSettings = {},
  adapter: SiteAdapter | null = null,
): SiteFoldersRuntime {
  let hideFiled = settings[HIDE_FILED_SETTING] === true;
  let setHideFiled: ((on: boolean) => void) | null = null;
  let view: SiteFoldersView | null = null;
  const runtime = {
    updateSettings(next: PluginSettings): void {
      hideFiled = next[HIDE_FILED_SETTING] === true;
      setHideFiled?.(hideFiled);
    },
    onScreen: () => (view?.onScreen() ? 1 : 0),
  };
  if (scope.isDisposed) return { started: Promise.resolve(), ...runtime };

  async function run(): Promise<void> {
    await initI18n();
    if (scope.isDisposed) return;
    const { key } = site;
    // The store starts loading now; a notice from that load waits for the view.
    const early: Array<Parameters<SiteFolderNotify>> = [];
    const lease = openSiteFolderSession(site, (message, tone) => {
      if (view) view.notifyStorage(message, tone);
      else early.push([message, tone]);
    });
    scope.effect(() => () => lease.release(), `${key}:session`);
    const { store, commands } = lease;
    const [prefs, sectionPrefs] = await Promise.all([
      loadPanelPrefs(site.prefsKeys.panel),
      loadSectionPrefs(site.prefsKeys.section),
    ]);
    if (scope.isDisposed) return;
    // Set by `setHideFiled` below, from closures the compiler cannot follow.
    let hidden = null as { readonly rows: SidebarHideFiled; readonly stop: Dispose } | null;
    const nativeRename = site.native.rename;
    const renameNative = async (conversation: ConversationReference): Promise<void> => {
      if (!nativeRename) return;
      const nativeTitle = await nativeRename(site.identity.bareId(conversation.conversationId), {
        sidebar: () => site.sidebar.find(),
        reveal: (id) => hidden?.rows.reveal(id) ?? (() => {}),
        active: () => !scope.isDisposed,
      });
      if (nativeTitle === null || scope.isDisposed) return;
      await commands.run({
        kind: 'restoreNativeTitle',
        conversationId: conversation.conversationId,
        nativeTitle,
      });
    };
    const shown = new SiteFoldersView(scope, site, store, commands, prefs, (c) => {
      void renameNative(c);
    });
    view = shown;
    for (const [message, tone] of early.splice(0)) shown.notifyStorage(message, tone);
    const sendSite = sendSiteOf(adapter);
    const newChatPort = siteNewChatPort(site, adapter, store, shown);
    const newChat = newChatPort ? startNewChatFiling(scope, newChatPort) : null;
    shown.start(sectionPrefs, sendSite !== null, newChat?.menuItems);
    if (sendSite) {
      trackActivity(scope, key, sendSite, store, (entries) => {
        void commands.run({ kind: 'setConversationActivity', entries });
      });
    }
    const sidebar = new SidebarWatcher(
      scope,
      { find: (doc) => site.sidebar.find(doc), attributes: site.sidebar.observedAttributes },
      key,
    );
    const moveMenu =
      site.native.createMoveMenu?.({
        label: () => t('conversation_move_to_folder'),
        untitled: () => t(site.messages.untitled),
        canFile: () => store.ready,
        onMove: (conversation) => shown.pickFolderFor(conversation),
      }) ?? null;
    const titles = new SidebarTitleSync(store, commands, {
      rows: site.sidebar,
      isPlaceholderTitle: (title) => site.page.isPlaceholderTitle(title),
      storedId: (id) => site.identity.storedId(id),
    });
    const guide = site.guide
      ? new SiteFolderGuide(
          scope,
          site.guide,
          {
            anchor: () => shown.guideAnchor(),
            ready: () => store.ready,
            busy: () => shown.sectionBusy(),
          },
          key,
        )
      : null;
    if (moveMenu) scope.effect(() => () => moveMenu.dispose(), `${key}:move-menu`);
    const rowAt = site.native.rowAt;
    if (rowAt) {
      bindSidebarRowDrag(scope, {
        conversationAt: (target) => {
          const row = rowAt(target);
          return row ? referenceOf(site, row, location.origin) : null;
        },
        label: key,
        dropTargetAt: (x, y) => shown.dropTargetAt(x, y),
        onDrop: (folderId, conversation) => shown.file(folderId, conversation, 'outside-drop'),
      });
    }
    sidebar.onChange((nav) => {
      shown.placeSection(nav);
      hidden?.rows.sync(nav);
      titles.sync(nav);
      guide?.check();
      if (moveMenu?.check(nav)) sidebar.schedule();
    });
    scope.effect(() => store.subscribe(() => sidebar.schedule()), `${key}:sidebar-sync`);
    // A chat older than the loaded sidebar opens without any sidebar change.
    scope.effect(() => watchRouteChanges(() => sidebar.schedule()), `${key}:route`);
    // Hiding filed chats has its own scope, so the setting turns it on and off in place.
    setHideFiled = (on) => {
      if (scope.isDisposed || on === (hidden !== null)) return;
      if (hidden) {
        void hidden.stop();
        hidden = null;
      } else {
        const own = new PluginScope();
        const rows = new SidebarHideFiled(own, site.hideFiled, site.sidebar, key);
        own.effect(
          () =>
            store.subscribe(() => {
              rows.update(store.filedIds());
              // Marked here, not only on the next frame: a tab opened in the background
              // draws none, so its filed rows stayed shown once the folders loaded.
              rows.sync(site.sidebar.find());
            }),
          `${key}:hide-filed-sync`,
        );
        // Filed chats are known once the data loaded, editable or not (another tab may hold
        // the folders), and the rows are marked now: a hidden tab runs no frame pass.
        rows.update(store.filedIds());
        rows.sync(site.sidebar.find());
        hidden = { rows, stop: scope.child({ destroy: () => own.dispose() }, `${key}:hide-filed`) };
      }
      sidebar.schedule();
    };
    setHideFiled(hideFiled);
    sidebar.start();
    await lease.ready;
    if (scope.isDisposed) return;
    shown.refresh();
    hidden?.rows.update(store.filedIds());
    sidebar.schedule();
  }

  let started!: Promise<void>;
  // An effect, so disposing the scope waits for start-up instead of racing it.
  scope.effect(() => {
    started = run();
    return started.then(() => () => {});
  }, `${site.key}:start`);
  return { started, ...runtime };
}

/** Starts a site's folders and settles once they started; see `startSiteFolders`. */
export function activateSiteFolders(
  scope: PluginScope,
  site: SiteFoldersAdapter,
  settings: PluginSettings = {},
  adapter: SiteAdapter | null = null,
): Promise<void> {
  return startSiteFolders(scope, site, settings, adapter).started;
}
