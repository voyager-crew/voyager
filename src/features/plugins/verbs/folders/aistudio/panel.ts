/**
 * The folder panel in AI Studio's left nav: the folder section's panel mode
 * with AI Studio's header (title, /library shortcut, cloud, create), where it
 * goes in the legacy or V2 nav, and a watch that notices when Angular rebuilds
 * the nav and drops it. `nav` is the `sidebar` of AI Studio's site.json
 * `folders` section.
 */
import { createLibraryIcon } from '@/core/icons/folderIcons';
import { AISTUDIO_ROOT_BUCKET_ID } from '@/features/folder/constants';
import { isLibraryPath } from '@/pages/content/folder/aistudioLibraryTable';
import {
  aistudioPackagedList,
  aistudioPackagedSelector,
  readAIStudioHistoryRoot,
} from '@/pages/content/folder/aistudioLocatorReads';
import type { TreeActions } from '@/pages/content/folder/floatingTree/shared';
import {
  type FolderHeaderAction,
  setFolderHeaderAction,
} from '@/pages/content/folder/folderHeader/folderHeader';
import { folderHeaderActions } from '@/pages/content/folder/folderHeader/folderHeaderActions';
import type { FolderData } from '@/pages/content/folder/types';

import { type PanelSection, mountPanelSection } from '../panelSection';
import { waitForAIStudioAnchor } from './panelAnchorWait';
import { openLibraryInApp } from './routes';
import { AISTUDIO_TREE_CSS, AISTUDIO_TREE_HOST_CLASS, AISTUDIO_TREE_SITE } from './tree';

const REINJECT_THROTTLE_MS = 250;
const LIBRARY_CLASS = 'gv-folder-library-btn';
/** `.gv-aistudio` scopes AI Studio's page styles away from Gemini's. */
const CONTAINER_CLASS = 'gv-folder-container gv-aistudio';

export type PanelActions = {
  cloud: { upload: () => void; sync: () => void; tooltip?: () => Promise<string> };
  onCreateFolder: () => void;
};

/** The V2 nav's /library shortcut, which the shared header has no slot for. */
function libraryAction(): FolderHeaderAction {
  return {
    className: LIBRARY_CLASS,
    icon: () => createLibraryIcon(18),
    labelKey: 'folder_manage_in_library',
    hidden: isLibraryPath(),
    onClick: () => openLibraryInApp(),
  };
}

/**
 * Builds the panel with its tree. The V2 nav, which has no inline history
 * (`legacyNav` false), gets a /library shortcut.
 */
export function buildFolderPanel(
  actions: PanelActions,
  legacyNav: boolean,
  tree: { data: FolderData; actions: TreeActions; activeConversationId: string | null },
): PanelSection {
  return mountPanelSection({
    containerClass: CONTAINER_CLASS,
    title: { tag: 'h2', labelKey: 'folder_title', className: 'gv-folder-title' },
    actions: folderHeaderActions({
      extra: legacyNav ? [] : [libraryAction()],
      cloud: actions.cloud,
      create: { labelKey: 'folder_create', onClick: actions.onCreateFolder },
    }),
    tree: {
      hostClass: AISTUDIO_TREE_HOST_CLASS,
      css: AISTUDIO_TREE_CSS,
      data: tree.data,
      rootBucketId: AISTUDIO_ROOT_BUCKET_ID,
      conversationSortMode: 'manual',
      actions: tree.actions,
      site: AISTUDIO_TREE_SITE,
      activeConversationId: tree.activeConversationId,
    },
  });
}

/** The /library shortcut is hidden on /library itself. */
export function updateLibraryShortcut(root: ParentNode | null): void {
  if (root) setFolderHeaderAction(root, LIBRARY_CLASS, { hidden: isLibraryPath() });
}

/** Stable insertion anchors: Angular renders the nav shell before its children. */
function findPanelAnchor(nav: string): HTMLElement | null {
  const history = readAIStudioHistoryRoot();
  const selector = aistudioPackagedList('navigation.anchorSteps')
    .map((step) => `${nav}${step}`)
    .join(', ');
  const anchor = document.querySelector<HTMLElement>(selector);
  if (!history) return anchor;
  if (!anchor) return history;
  return history.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING
    ? history
    : anchor;
}

/**
 * Inserts the panel above the legacy history list, or in the V2 nav just
 * above `.empty-space` so `.bottom-actions` stays pinned. Returns false when
 * the nav has no place for it.
 */
export function insertFolderPanel(
  container: HTMLElement,
  historyRoot: HTMLElement | null,
  nav: string,
): boolean {
  if (historyRoot) {
    (historyRoot.parentElement ?? historyRoot).insertAdjacentElement('beforebegin', container);
    return true;
  }
  const navContent = document.querySelector(nav);
  const navElement =
    navContent?.querySelector(aistudioPackagedSelector('navigation.navChild')) ?? null;
  const anchor =
    navElement?.querySelector(aistudioPackagedSelector('navigation.empty')) ??
    navElement?.querySelector(aistudioPackagedSelector('navigation.bottom'));
  const parent = navElement ?? navContent;
  if (anchor) anchor.insertAdjacentElement('beforebegin', container);
  else if (parent) parent.appendChild(container);
  else return false;
  container.classList.add('gv-aistudio-v2');
  return true;
}

/**
 * Calls `onDetached` when an Angular rebuild of the nav has dropped the panel,
 * at most once per burst of mutations. Returns the stop, or null without a nav.
 */
export function watchPanelMount(
  nav: string,
  isMounted: () => boolean,
  onDetached: () => void,
): (() => void) | null {
  const navContent = document.querySelector(nav);
  if (!navContent) return null;
  let lastReinjectAt = 0;
  const observer = new MutationObserver(() => {
    if (isMounted()) return;
    const now = Date.now();
    if (now - lastReinjectAt < REINJECT_THROTTLE_MS) return;
    lastReinjectAt = now;
    onDetached();
  });
  try {
    observer.observe(navContent, { childList: true, subtree: true });
  } catch {}
  return () => observer.disconnect();
}

/**
 * Resolves with the first panel anchor on the page, or null after `timeoutMs`
 * or once `signal` aborts (the folders turned off meanwhile).
 */
export function waitForPanelAnchor(
  nav: string,
  signal: AbortSignal,
  timeoutMs = 10000,
): Promise<HTMLElement | null> {
  return waitForAIStudioAnchor(() => findPanelAnchor(nav), signal, timeoutMs);
}
