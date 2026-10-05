/**
 * Mounts the shared folder tree the way each of its three consumers does, through
 * that consumer's own entry point and with the `TreeActions` a test hands in:
 *
 * - `panel`: the Gemini (and ChatGPT) floating panel, `mountFloatingPanel`.
 * - `aistudio`: AI Studio's sidebar tree, `mountAIStudioTree`, inside a nav.
 * - `chatgpt`: ChatGPT's sidebar section, `ChatGptFolderSection`.
 *
 * The characterization suites run the same cases over all three and state each
 * difference as data, so a rewrite of the tree's internals has to keep all of them.
 */
import { AISTUDIO_ROOT_BUCKET_ID, ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import { ChatGptFolderSection } from '@/features/plugins/builtin/chatgptFolders/chatgptFolderSection';
import { DEFAULT_SECTION_PREFS } from '@/features/plugins/builtin/chatgptFolders/sectionPrefs';
import { getTranslationSyncUnsafe } from '@/utils/i18n';

import { GEMINI_PANEL } from '../../__tests__/floatingPanelHarness';
import { mountAIStudioTree } from '../../aistudioTree';
import { mountFloatingPanel } from '../../floatingPanel';
import type { FolderData } from '../../types';
import type { TreeActions } from '../shared';

export type ConsumerId = 'panel' | 'aistudio' | 'chatgpt';

export type MountedTree = {
  consumer: ConsumerId;
  /** The light-DOM element that holds the tree's shadow root. */
  host: HTMLElement;
  /** Where the tree renders. */
  root: ShadowRoot;
  rootBucketId: string;
  /** New data from the host's store, as each consumer receives it. */
  update: (data: FolderData) => void;
  /** Opens the name form for a new top-level folder, the way the consumer offers it. */
  startCreateRootFolder: () => void;
  /** AI Studio only: the page opened another prompt. */
  setActiveConversation?: (conversationId: string | null) => void;
  destroy: () => void;
};

export type MountOptions = {
  /** AI Studio only: the prompt the page has open. */
  activeConversationId?: string | null;
};

const mounted: MountedTree[] = [];

/** The nav AI Studio's tree sits in; it transforms and clips, as page layouts may. */
export const AISTUDIO_NAV_CLASS = 'test-aistudio-nav';

function clickCreateButton(root: ShadowRoot): void {
  const label = getTranslationSyncUnsafe('floatingPanelCreateFolder');
  const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error('no "Create folder" button');
  button.click();
}

function mountPanel(data: FolderData, actions: TreeActions): MountedTree {
  const handle = mountFloatingPanel({ ...GEMINI_PANEL, data, cloudActions: false, ...actions });
  const root = handle.element.shadowRoot;
  if (!root) throw new Error('the floating panel has no shadow root');
  return {
    consumer: 'panel',
    host: handle.element,
    root,
    rootBucketId: ROOT_CONVERSATIONS_ID,
    update: (next) => handle.update(next),
    startCreateRootFolder: () => clickCreateButton(root),
    destroy: () => handle.destroy(),
  };
}

function mountAIStudio(data: FolderData, actions: TreeActions, options: MountOptions): MountedTree {
  const nav = document.createElement('div');
  nav.className = AISTUDIO_NAV_CLASS;
  nav.style.transform = 'translateX(0)';
  nav.style.overflow = 'hidden';
  document.body.appendChild(nav);
  const tree = mountAIStudioTree({
    data,
    actions,
    activeConversationId: options.activeConversationId ?? null,
  });
  nav.appendChild(tree.host);
  const root = tree.host.shadowRoot;
  if (!root) throw new Error('the AI Studio tree has no shadow root');
  return {
    consumer: 'aistudio',
    host: tree.host,
    root,
    rootBucketId: AISTUDIO_ROOT_BUCKET_ID,
    update: (next) => tree.update(next),
    startCreateRootFolder: () => tree.startCreateFolder(),
    setActiveConversation: (conversationId) => tree.setActiveConversation(conversationId),
    destroy: () => {
      tree.destroy();
      nav.remove();
    },
  };
}

function mountChatGpt(data: FolderData, actions: TreeActions): MountedTree {
  const section = new ChatGptFolderSection({
    data,
    rootBucketId: ROOT_CONVERSATIONS_ID,
    actions,
    transfer: { import: () => {}, export: () => {} },
    cloud: { upload: () => {}, sync: () => {} },
    prefs: DEFAULT_SECTION_PREFS,
    onPrefsChange: () => {},
  });
  document.body.appendChild(section.element);
  const root = section.element.shadowRoot;
  if (!root) throw new Error('the ChatGPT section has no shadow root');
  return {
    consumer: 'chatgpt',
    host: section.element,
    root,
    rootBucketId: ROOT_CONVERSATIONS_ID,
    update: (next) => section.update(next),
    startCreateRootFolder: () => clickCreateButton(root),
    destroy: () => section.destroy(),
  };
}

export function mountConsumer(
  consumer: ConsumerId,
  data: FolderData,
  actions: TreeActions,
  options: MountOptions = {},
): MountedTree {
  const tree =
    consumer === 'panel'
      ? mountPanel(data, actions)
      : consumer === 'aistudio'
        ? mountAIStudio(data, actions, options)
        : mountChatGpt(data, actions);
  mounted.push(tree);
  return tree;
}

export function destroyMountedTrees(): void {
  for (const tree of mounted.splice(0)) tree.destroy();
}

export const CONSUMERS: ReadonlyArray<{ consumer: ConsumerId; name: string }> = [
  { consumer: 'panel', name: 'floating panel' },
  { consumer: 'aistudio', name: 'AI Studio sidebar' },
  { consumer: 'chatgpt', name: 'ChatGPT sidebar section' },
];
