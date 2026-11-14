/**
 * The folders primitive on AI Studio: a lease on AI Studio's folder session
 * (which the content script's start point also holds, so the data and its
 * migration outlive the plugin), and the view that shows it in the nav and on
 * /library. Start-up runs as one of the scope's effects, so turning the
 * folders off while it still awaits waits for it and leaves nothing behind.
 */
import type { PluginScope } from '@/features/plugins/runtime/pluginScope';
import type { FoldersSection } from '@/features/plugins/sites/sections/foldersData';
import type { PluginSettings, SiteAdapter } from '@/features/plugins/types';
import { openAIStudioFolderSession } from '@/pages/content/folder/session/aistudioFolderSessions';

import { HIDE_FILED_SETTING } from '../hideFiled';
import { startNewChatFiling } from '../newChatFiling';
import { aistudioNewChatPort } from './newChat';
import { AIStudioFoldersView, aistudioPageDom } from './view';

export interface AIStudioFoldersRuntime {
  /** Settles once start-up finished, or stopped early because the folders went off. */
  readonly started: Promise<void>;
  /** `hideFiledChats` hides the /library rows of filed prompts, in place. */
  updateSettings(settings: PluginSettings): void;
  /** 1 while the panel is in the nav, else 0. */
  onScreen(): number;
  /** The view while it runs; for tests that drive the page. */
  view(): AIStudioFoldersView | null;
}

/** `null` where AI Studio's site.json has no usable `folders` section. */
export function startAIStudioFolders(
  scope: PluginScope,
  section: FoldersSection,
  settings: PluginSettings = {},
  selectors?: SiteAdapter['selectors'],
): AIStudioFoldersRuntime | null {
  const dom = aistudioPageDom(section);
  if (!dom) return null;
  let hideArchived = settings[HIDE_FILED_SETTING] === true;
  let view: AIStudioFoldersView | null = null;
  const runtime = {
    updateSettings: (next: PluginSettings) => {
      hideArchived = next[HIDE_FILED_SETTING] === true;
      view?.setHideArchived(hideArchived);
    },
    onScreen: () => (view?.container?.isConnected ? 1 : 0),
    view: () => view,
  };
  if (scope.isDisposed) return { started: Promise.resolve(), ...runtime };

  async function run(): Promise<void> {
    const lease = openAIStudioFolderSession();
    // Last on stop: the view detaches first, then the lease drains.
    scope.effect(() => () => lease.release(), 'aistudio-folders:session');
    await lease.ready;
    if (scope.isDisposed) return;
    const newChatPort = aistudioNewChatPort(lease.session, selectors, () => view);
    const newChat = newChatPort ? startNewChatFiling(scope, newChatPort) : null;
    const shown = new AIStudioFoldersView(lease.session, dom!, hideArchived, newChat?.menuItems);
    view = shown;
    scope.effect(
      () => () => {
        if (view === shown) view = null;
        shown.destroy();
      },
      'aistudio-folders:view',
    );
    await shown.start();
  }

  let started!: Promise<void>;
  scope.effect(() => {
    started = run().catch((error) => {
      console.error('[AIStudioFolderManager] Start error:', error);
    });
    return started.then(() => () => {});
  }, 'aistudio-folders:start');
  return { started, ...runtime };
}
