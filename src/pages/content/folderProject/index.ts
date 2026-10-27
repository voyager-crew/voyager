/**
 * Folder-as-Project feature
 *
 * When enabled, injects a folder picker above the Gemini chat input on new-chat
 * pages. On the first send, it prepends any folder instructions just-in-time
 * and automatically assigns the new conversation to the selected folder.
 */
import { isImeKeyEvent } from '@/core/services/composer/sendKeys/sendKeyIntent';
import { StorageKeys } from '@/core/types/common';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/project-packaged.json';

import { findChatInput } from '../chatInput/index';
import type { GeminiFolderSession } from '../folder/session/geminiFolderSession';
import { followGeminiSendKey } from '../sendBehavior/followSendKey';
import { setInputText } from '../utils/inputHelper';
import { watchRouteChanges } from '../utils/routeWatcher';
import { resolveProjectInput } from './inputTargets';
import {
  buildInstructionBlock,
  hasInstructionBlock,
  stripInstructionBlock,
} from './instructionBlock';
import { clearNewChatFolder, onNewChatFolder, pendingNewChatFolder } from './pendingFolder';
import { createPendingProjectSend } from './pendingSend';
import { type FolderSnapshot, createFolderProjectPicker } from './picker';

/**
 * Gemini's folder session as Folder-as-Project uses it: the folders to pick
 * from, and filing the new chat. It works whether the folders are on or off.
 */
export type FolderProjectFolders = Pick<
  GeminiFolderSession,
  'ensureDataLoaded' | 'getFolders' | 'addConversationToFolderFromNative'
> &
  Partial<
    Pick<
      GeminiFolderSession,
      'onFoldersReady' | 'folderAccount' | 'folderSnapshot' | 'onAccountChange'
    >
  >;

// ============================================================================
// Module state (per-tab, reset on navigation)
// ============================================================================

let featureInitialized = false;
let selectedFolderId: string | null = null;
let selectedFolderName: string | null = null;
let selectedFolderInstructions: string | null = null;
/** Whose folders the selection came from (`FolderProjectFolders.folderAccount`). */
let selectedFolderAccount: string | null = null;
/** The input whose remote read prepared instructions, retained while that composer is connected. */
let preparedRemoteInput: HTMLElement | null = null;
/** The page's folder session, once started; it answers whose folders the page shows. */
let folderSource: FolderProjectFolders | null = null;
let picker: ReturnType<typeof createFolderProjectPicker> | null = null;
let lastHref = '';
let stopRouteWatcher: (() => void) | null = null;
let ctrlEnterSendEnabled = false;
const pendingSend = createPendingProjectSend(() => {
  if (isNewChatPath(window.location.pathname)) clearPreparedInstructions();
});
let sendClickListener: ((e: Event) => void) | null = null;
let sendKeydownListener: ((e: KeyboardEvent) => void) | null = null;
let sidebarNavClickListener: ((e: Event) => void) | null = null;
let effectiveSendKey: ReturnType<typeof followGeminiSendKey> | null = null;

const SEND_BUTTON_SELECTOR = packaged['project.send'].join(', ');

// Sidebar conversation links: /app/<convId>, /u/0/app/<convId>, /gem/<gemId>/<convId>.
// Used by sidebarNavClickListener to cancel pendingSend before URL change.
const CONVERSATION_HREF_PATTERN = /\/(u\/\d+\/)?(app|gem\/[^/]+)\/[^/?#]+/;

// ============================================================================
// URL helpers
// ============================================================================

/**
 * Returns true when the current pathname is a new (empty) chat or gem page —
 * i.e., no conversation ID is present yet.
 *
 * Supports multi-profile paths like /u/0/app.
 *
 * @param path - `window.location.pathname` to test
 */
export function isNewChatPath(path: string): boolean {
  // Matches /app or /app/ but not /app/<convId>
  // Matches /gem/<gemId> or /gem/<gemId>/ but not /gem/<gemId>/<convId>
  return /^\/(u\/\d+\/)?(app\/?|gem\/[^/]+\/?)$/.test(path);
}

/**
 * Extracts the conversation ID from a Gemini chat or gem URL path.
 *
 * @param path - `window.location.pathname` to parse
 * @returns Conversation ID string, or null if none present
 */
export function extractConvId(path: string): string | null {
  const appMatch = path.match(/\/app\/([^/?#]+)/);
  if (appMatch?.[1]) return appMatch[1];
  const gemMatch = path.match(/\/gem\/[^/]+\/([^/?#]+)/);
  return gemMatch?.[1] ?? null;
}

// ============================================================================
// Send detection — distinguishes message sends from sidebar navigation
// ============================================================================

function readInputText(input: HTMLElement): string {
  return input instanceof HTMLTextAreaElement
    ? input.value
    : (input.innerText ?? input.textContent ?? '');
}

function clearPendingSendState(): void {
  pendingSend.clear();
}

function clearPreparedInstructions(input?: HTMLElement | null): void {
  // Gemini can carry the private block into a remounted composer; clean the current draft then.
  input =
    input === undefined
      ? preparedRemoteInput?.isConnected
        ? preparedRemoteInput
        : findChatInput()
      : input;
  preparedRemoteInput = null;
  if (!input) return;

  const currentText = readInputText(input);
  if (!hasInstructionBlock(currentText)) return;

  setInputText(input, stripInstructionBlock(currentText));
}

/** The folders to pick from, with the account they came from read in the same step. */
function snapshotOf(folders: FolderProjectFolders): FolderSnapshot {
  return folders.folderSnapshot?.() ?? { account: null, folders: folders.getFolders() };
}

function clearFolderSelection(): void {
  selectedFolderId = null;
  selectedFolderName = null;
  selectedFolderInstructions = null;
  selectedFolderAccount = null;
}

/**
 * Whether the chosen folder belongs to the account the page shows. One whose
 * account the page no longer shows (the tab switched accounts) is dropped
 * with its chip and any instructions already put in the composer: another
 * account's instructions must never reach this one's chat, nor its chat that
 * account's folder. While the page's account is unreadable (its control
 * loading or redrawn) the choice is kept but not acted on.
 */
function selectionBelongsToPage(): boolean {
  if (!selectedFolderId) return false;
  if (!folderSource?.folderAccount) return true;
  const account = folderSource.folderAccount();
  if (account === selectedFolderAccount) return true;
  if (account === null) return false;
  clearFolderSelection();
  clearPendingSendState();
  clearPreparedInstructions();
  picker?.resetChoice();
  return false;
}

/**
 * Whether the choice may act on the send about to go out. One that may not
 * (the page's account is unreadable now, or another one) leaves no
 * instructions in the composer and no send pending: the message goes out
 * plain and unfiled rather than carry a folder whose account is unconfirmed.
 */
function choiceMayActOnSend(input: HTMLElement | null): boolean {
  if (selectionBelongsToPage()) return true;
  clearPreparedInstructions(input);
  clearPendingSendState();
  return false;
}

function prepareInputForSend(input: HTMLElement | null, online: boolean): void {
  if (!input || !selectedFolderInstructions || !selectedFolderName) return;
  if (!selectionBelongsToPage()) return;

  const currentText = stripInstructionBlock(readInputText(input));
  const combined = `${buildInstructionBlock(selectedFolderName, selectedFolderInstructions)}${currentText}`;
  setInputText(input, combined);
  // A later bundled send owns cleanup too; it must retire the earlier remote editor.
  preparedRemoteInput = online ? input : null;
}

/** True when the input has no user text (stray instruction block stripped first). */
function isInputEmpty(input: HTMLElement | null): boolean {
  if (!input) return true;
  return stripInstructionBlock(readInputText(input)).trim() === '';
}

function markPendingSend(input: HTMLElement | null, online = false): void {
  prepareInputForSend(input, online);
  pendingSend.begin();
}

/**
 * Handle an empty-input Enter press: strip any leftover instruction block so
 * Gemini's bubble-phase handler sees a truly empty input and doesn't submit
 * a message containing only the block. Returns true when the press was
 * handled (caller should skip markPendingSend).
 *
 * Click-send is NOT routed through this — Gemini only enables the send button
 * when there is text or an attachment, so an empty-input click means
 * "send the attachment" and the auto-assignment must proceed.
 */
function handleEmptyInputEnter(input: HTMLElement | null): boolean {
  if (!isInputEmpty(input)) return false;
  if (input) {
    const currentText = readInputText(input);
    if (hasInstructionBlock(currentText)) {
      setInputText(input, stripInstructionBlock(currentText));
    }
  }
  return true;
}

function isKeyboardSend(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' || isImeKeyEvent(event) || event.shiftKey) return false;

  if (ctrlEnterSendEnabled) {
    return event.ctrlKey || event.metaKey;
  }

  return !event.ctrlKey && !event.metaKey;
}

function isEditableTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable ||
    target.getAttribute('contenteditable') === 'true' ||
    target.getAttribute('role') === 'textbox'
  );
}

function extractGemMetadata(path: string): { isGem: boolean; gemId?: string } {
  const gemMatch = path.match(/\/gem\/([^/]+)\/[^/?#]+/);
  if (!gemMatch?.[1]) {
    return { isGem: false };
  }

  return {
    isGem: true,
    gemId: gemMatch[1],
  };
}

function setupSendDetection(): void {
  if (sendClickListener || sendKeydownListener || sidebarNavClickListener) return;

  sendClickListener = (e: Event) => {
    if (!selectedFolderId) return;
    const target = e.target as HTMLElement;
    const button = target.closest(SEND_BUTTON_SELECTOR);
    if (!button) return;
    const operation = resolveProjectInput(button);
    const input = operation.value;
    if (choiceMayActOnSend(input))
      markPendingSend(input, operation.view.remoteKeys.has('project.inputs'));
  };

  sendKeydownListener = (e: KeyboardEvent) => {
    if (!selectedFolderId || !isKeyboardSend(e) || !isEditableTarget(e.target)) return;
    if (handleEmptyInputEnter(e.target)) return;
    if (choiceMayActOnSend(e.target)) markPendingSend(e.target);
  };

  // Cancel pendingSend when user clicks a sidebar conversation link, so the
  // resulting URL change isn't misattributed to the current send.
  sidebarNavClickListener = (e: Event) => {
    if (!pendingSend.isPending()) return;
    // Plain left-click only — middle/right/modifier clicks open new tabs and
    // leave the current tab's URL on /app.
    if (!(e instanceof MouseEvent)) return;
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    // Element (not HTMLElement) so closest() works on SVG icons inside <a>.
    const target = e.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href') ?? '';
    if (CONVERSATION_HREF_PATTERN.test(href)) {
      clearPendingSendState();
    }
  };

  document.addEventListener('click', sendClickListener, true);
  document.addEventListener('keydown', sendKeydownListener, true);
  document.addEventListener('click', sidebarNavClickListener, true);
}

function teardownSendDetection(): void {
  if (sendClickListener) {
    document.removeEventListener('click', sendClickListener, true);
    sendClickListener = null;
  }
  if (sendKeydownListener) {
    document.removeEventListener('keydown', sendKeydownListener, true);
    sendKeydownListener = null;
  }
  if (sidebarNavClickListener) {
    document.removeEventListener('click', sidebarNavClickListener, true);
    sidebarNavClickListener = null;
  }
  clearPendingSendState();
}

// ============================================================================
// Conversation title
// ============================================================================

function getConversationTitle(convId: string): string {
  const escapedId = convId.replace(/"/g, '\\"');
  const link = document.querySelector<HTMLAnchorElement>(
    `[data-test-id="conversation"][jslog*="c_${escapedId}"] a, a[href*="/app/${escapedId}"], a[href*="/gem/"][href$="/${escapedId}"]`,
  );
  return link?.textContent?.trim() || document.title || 'New Chat';
}

// ============================================================================
// URL change handler
// ============================================================================

function handleNavigation(folders: FolderProjectFolders, prevPath: string, newPath: string): void {
  const prevWasNewChat = isNewChatPath(prevPath);
  const newConvId = extractConvId(newPath);

  // User sent their first message: new-chat → conversation
  // Gate on pendingSend to avoid false assignment when clicking sidebar links
  if (
    prevWasNewChat &&
    newConvId &&
    pendingSend.isPending() &&
    selectionBelongsToPage() &&
    selectedFolderId
  ) {
    const title = getConversationTitle(newConvId);
    const { isGem, gemId } = extractGemMetadata(newPath);
    folders.addConversationToFolderFromNative(
      selectedFolderId,
      newConvId,
      title,
      window.location.href,
      isGem,
      gemId,
      Date.now(),
    );
    clearFolderSelection();
    clearPendingSendState();
  }

  if (isNewChatPath(newPath)) {
    // Navigated to a new chat page — (re)show picker
    clearFolderSelection();
    clearPendingSendState();
    clearPreparedInstructions();
    picker?.remove();
    void picker?.show();
  } else {
    // Left new-chat: clear folder selection so follow-up messages don't
    // re-inject instructions. Trade-off: when Branch 1 was skipped because
    // the >60s timer fired, the conversation is NOT auto-assigned (user
    // must drag it manually) — the alternative would re-introduce follow-up
    // injection on the new conversation page.
    clearFolderSelection();
    clearPendingSendState();
    picker?.remove();
  }
}

// ============================================================================
// URL watcher
// ============================================================================

function stopURLWatcher(): void {
  effectiveSendKey?.stop();
  effectiveSendKey = null;
  stopRouteWatcher?.();
  stopRouteWatcher = null;
  teardownSendDetection();
}

function startURLWatcher(folders: FolderProjectFolders): void {
  // Clean up any existing watcher (idempotent for toggle cycles)
  stopURLWatcher();
  effectiveSendKey = followGeminiSendKey((key) => {
    ctrlEnterSendEnabled = key === 'ctrlEnter';
  });
  // A pending mount may finish after an off/on cycle; keep its cleanup owner.
  picker ??= createFolderProjectPicker({
    loadFolders: async () => {
      await folders.ensureDataLoaded();
      return snapshotOf(folders);
    },
    loadedFolders: () => snapshotOf(folders),
    currentAccount: folders.folderAccount ? () => folders.folderAccount?.() ?? null : undefined,
    onAccountChange: folders.onAccountChange?.bind(folders),
    canMount: () => featureInitialized && isNewChatPath(window.location.pathname),
    onSelect: (folder, source, account) => {
      selectedFolderId = folder?.id ?? null;
      selectedFolderName = folder?.name ?? null;
      selectedFolderInstructions = folder?.instructions ?? null;
      selectedFolderAccount = folder ? account : null;
      // Pending selection leaves the input alone; only an explicit picker choice clears it.
      if (source === 'user') clearPreparedInstructions();
    },
  });

  lastHref = window.location.href;

  const checkUrl = () => {
    const current = window.location.href;
    if (current === lastHref) return;
    const prevPath = new URL(lastHref).pathname;
    const newPath = new URL(current).pathname;
    lastHref = current;
    handleNavigation(folders, prevPath, newPath);
  };

  stopRouteWatcher = watchRouteChanges(({ trigger }) => {
    if (trigger !== 'poll') clearPendingSendState();
    checkUrl();
  });

  // Also check on initial load
  if (isNewChatPath(window.location.pathname)) {
    void picker?.show();
  }

  setupSendDetection();
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * Initialise the Folder-as-Project feature. Reads the enabled flag from
 * chrome.storage.sync and sets up the URL watcher + picker injection.
 *
 * @param folders - Gemini's folder session, which the page holds
 */
export function startFolderProject(folders: FolderProjectFolders): void {
  folderSource = folders;
  chrome.storage?.sync?.get(
    {
      [StorageKeys.FOLDER_PROJECT_ENABLED]: false,
      [StorageKeys.CTRL_ENTER_SEND]: false,
    },
    (res) => {
      if (!effectiveSendKey?.isFollowing()) {
        ctrlEnterSendEnabled = res?.[StorageKeys.CTRL_ENTER_SEND] === true;
      }
      if (res?.[StorageKeys.FOLDER_PROJECT_ENABLED] !== true) return;
      if (featureInitialized) return;
      featureInitialized = true;
      startURLWatcher(folders);
    },
  );

  // "New chat in this folder" on the new-chat page itself: no navigation follows, so the
  // picker takes this tab's handoff here.
  onNewChatFolder(() => {
    if (featureInitialized && isNewChatPath(location.pathname)) void picker?.applyPending();
  });
  // A handoff whose folders had not loaded yet (the account was still unreadable) is taken
  // once they have.
  folders.onFoldersReady?.(() => {
    if (!featureInitialized || !isNewChatPath(location.pathname) || !pendingNewChatFolder()) return;
    void picker?.retryPending();
  });
  // Another account took the page: its folders are not the chosen one's.
  folders.onAccountChange?.(() => {
    // Options listed for another account are not this one's to pick.
    picker?.dropStaleOptions();
    // An unreadable account proves no switch; sending checks again.
    if ((folders.folderAccount?.() ?? null) === null || !selectedFolderId) return;
    selectionBelongsToPage();
  });

  // React to toggle changes without a page reload
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (StorageKeys.CTRL_ENTER_SEND in changes && !effectiveSendKey?.isFollowing()) {
      ctrlEnterSendEnabled = changes[StorageKeys.CTRL_ENTER_SEND].newValue === true;
    }

    if (!(StorageKeys.FOLDER_PROJECT_ENABLED in changes)) return;
    const enabled = changes[StorageKeys.FOLDER_PROJECT_ENABLED].newValue === true;
    if (enabled && !featureInitialized) {
      featureInitialized = true;
      startURLWatcher(folders);
    } else if (!enabled) {
      featureInitialized = false;
      stopURLWatcher();
      clearPreparedInstructions();
      picker?.remove();
      clearFolderSelection();
      // Drop any pending folder selection so re-enabling later doesn't auto-select a stale folder
      clearNewChatFolder();
      // Older builds handed it off through storage; one may still be stored.
      void chrome.storage?.local?.remove([StorageKeys.FOLDER_PROJECT_PENDING_FOLDER_ID]);
    }
  });
}
