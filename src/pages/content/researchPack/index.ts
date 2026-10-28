/**
 * Research Pack (Gemini).
 *
 * Users pick answers (or a selected part) into a pack, add an instruction,
 * and carry the assembled Markdown to another model by copying, downloading,
 * or inserting it into a composer. Everything is user-initiated: answers are
 * read only on an "Add to pack" click, and insertion fills the composer
 * without sending.
 */
import { accountIsolationService } from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { createRuntimePromptLibraryClient } from '@/features/prompt/library/promptLibraryMessages';
import {
  buildResearchPackFilename,
  buildResearchPackMarkdown,
} from '@/features/researchPack/services/markdown';
import { createResearchPackClient } from '@/features/researchPack/services/packMessages';
import {
  createEmptyPack,
  parsePack,
  setInstruction,
} from '@/features/researchPack/services/packModel';
import type { ResearchPackOp } from '@/features/researchPack/services/packOps';
import type {
  ResearchPackApplyResult,
  ResearchPackStore,
} from '@/features/researchPack/services/packStore';
import {
  type TemplateLibrary,
  createTemplateLibrary,
} from '@/features/researchPack/services/templates';
import type { AddItemOutcome, ResearchPack } from '@/features/researchPack/services/types';
import { getTranslationSync, onCachedLanguageChange } from '@/utils/i18n';

import { findChatInput, insertTextIntoChatInput } from '../chatInput';
import type { StopNativeFeature } from '../featureLifecycle';
import { type ContinueInDeps, createContinueInController } from './continueIn';
import { createResearchPackPanel } from './panel';
import {
  type ResearchPackScopeContext,
  createResearchPackKeyResolver,
  isIsolationSettingChange,
  readScopeContext,
  scopeIdentity,
} from './scope';
import {
  ADD_BUTTON_CLASS,
  ensureAddButtons,
  removeAddButtons,
  updateAddButtonLabels,
} from './turnButtons';
import { captureAnswer } from './turnCapture';

const OBSERVER_DEBOUNCE_MS = 300;
const ADDED_FLASH_MS = 1500;
const DOWNLOAD_URL_REVOKE_MS = 1000;

function createChromeKeyResolver(): (context: ResearchPackScopeContext) => Promise<string> {
  return createResearchPackKeyResolver({
    getSync: (keys) => chrome.storage.sync.get(keys),
    resolveAccountScope: (hints) => accountIsolationService.resolveAccountScope(hints),
  });
}

/** Reads come straight from storage; every edit goes to the background owner. */
function createChromeClient(): ResearchPackStore {
  return createResearchPackClient({
    area: {
      get: (key) => chrome.storage.local.get(key),
      set: (items) => chrome.storage.local.set(items),
    },
    send: (request) => chrome.runtime.sendMessage(request),
  });
}

/** Templates live in the Prompt Manager library, read and added to in place. */
function createChromeTemplateLibrary(): TemplateLibrary {
  return createTemplateLibrary({
    area: { get: (key) => chrome.storage.local.get(key) },
    key: StorageKeys.PROMPT_ITEMS,
    apply: createRuntimePromptLibraryClient().apply,
  });
}

const ADD_OUTCOME_MESSAGES = {
  added: 'researchPackAdded',
  duplicate: 'researchPackDuplicate',
  full: 'researchPackFull',
  empty: 'researchPackCaptureFailed',
} as const satisfies Record<AddItemOutcome, Parameters<typeof getTranslationSync>[0]>;

export interface StartResearchPackOptions {
  store?: ResearchPackStore;
  /** Storage key for an account context; rejects when the scope cannot be known. */
  resolveKey?: (context: ResearchPackScopeContext) => Promise<string>;
  /** The page URL scopes are read from (defaults to `location.href`). */
  pageUrl?: () => string;
  /** How "Continue in ChatGPT / Claude" reaches the background and the clipboard. */
  continueIn?: ContinueInDeps;
  /** Where instruction templates are kept (defaults to the Prompt Manager library). */
  templateLibrary?: TemplateLibrary;
}

/** A context whose pack key is being resolved, tagged with that context's identity. */
interface ScopeCheck {
  readonly identity: string;
  readonly key: Promise<string>;
}

export function startResearchPack(options: StartResearchPackOptions = {}): StopNativeFeature {
  const store = options.store ?? createChromeClient();
  const resolveKey = options.resolveKey ?? createChromeKeyResolver();
  const pageUrl = options.pageUrl ?? (() => window.location.href);
  const readContext = (): ResearchPackScopeContext => readScopeContext(pageUrl());
  const t = getTranslationSync;
  let stopped = false;
  let pack: ResearchPack = createEmptyPack();
  let observerTimer: ReturnType<typeof setTimeout> | null = null;
  const flashTimers = new Set<ReturnType<typeof setTimeout>>();
  const pendingDownloads = new Map<ReturnType<typeof setTimeout>, string>();

  const markdown = (): string => buildResearchPackMarkdown(pack, Date.now());
  /** What Copy, Download and Insert hand over: the stored items plus the typed instruction. */
  const exportMarkdown = (): string => {
    const now = Date.now();
    return buildResearchPackMarkdown(setInstruction(pack, panel.instructionDraft(), now), now);
  };

  const reportError = (error: unknown): void => {
    if (stopped || isExtensionContextInvalidatedError(error)) return;
    panel.notify(t('researchPackSaveFailed'), 'error');
  };

  // Which pack the page belongs to. `settled` is the last resolved scope and
  // `checking` resolves a context whose identity differs from it; a check is
  // dropped once the page's identity moves on. The isolation epoch is part of
  // the identity because toggling isolation maps the same context to another key.
  let isolationEpoch = 0;
  let settled: { identity: string; key: string | null } | null = null;
  let checking: ScopeCheck | null = null;
  const identityOf = (context: ResearchPackScopeContext): string =>
    `${isolationEpoch}:${scopeIdentity(context)}`;

  // What the panel shows: the pack under `view.key` at `view.revision`. A null
  // revision means that pack has no snapshot on screen yet, so the panel is locked.
  let view: { key: string | null; revision: number | null } = { key: null, revision: null };
  // Bumped whenever the pack on screen is removed or another pack is put on
  // screen. Revisions start again from 1 after a removal, so they only order
  // snapshots within one generation: a read or write answers only if no
  // generation started since it was sent. Storage events need no tag because
  // they arrive in order, after the removal they follow.
  let generation = 0;

  /**
   * Show a snapshot unless it was asked for in an earlier generation, another
   * pack is on screen, or a newer revision of it already is.
   */
  const offer = (key: string, snapshot: ResearchPack, askedIn: number): void => {
    if (stopped || askedIn !== generation || key !== view.key) return;
    if (view.revision !== null && snapshot.revision < view.revision) return;
    const first = view.revision === null;
    view = { key, revision: snapshot.revision };
    pack = snapshot;
    panel.render(pack, markdown(), { replaceInstruction: first });
  };

  const apply = async (
    key: string,
    op: ResearchPackOp,
  ): Promise<ResearchPackApplyResult | null> => {
    const askedIn = generation;
    try {
      const result = await store.apply(key, op);
      offer(key, result.pack, askedIn);
      return result;
    } catch (error) {
      reportError(error);
      return null;
    }
  };

  /** Editing stays blocked; the panel says the pack could not be read and offers Retry. */
  const showLoadFailure = (): void => {
    panel.render(pack, markdown(), { replaceInstruction: true, loadFailed: true });
  };

  const load = async (key: string): Promise<void> => {
    const askedIn = generation;
    try {
      offer(key, await store.load(key), askedIn);
    } catch {
      if (stopped || askedIn !== generation || key !== view.key) return;
      if (view.revision === null) showLoadFailure();
    }
  };

  /**
   * Put another pack on screen. Unsaved typing is saved to the pack it was
   * typed in, and the panel stays cleared and locked until the new pack's
   * first snapshot, so that snapshot cannot overwrite anything typed meanwhile.
   */
  const showPack = (key: string | null): void => {
    const pending = panel.takePendingInstruction();
    if (view.key !== null && pending !== null) {
      void apply(view.key, { kind: 'setInstruction', instruction: pending });
    }
    generation += 1;
    view = { key, revision: null };
    pack = createEmptyPack();
    panel.render(pack, markdown(), { replaceInstruction: true, locked: true });
    if (key === null) showLoadFailure();
    else void load(key);
  };

  const settle = (check: ScopeCheck, key: string | null): void => {
    if (stopped || checking !== check) return;
    checking = null;
    if (identityOf(readContext()) !== check.identity) {
      // The page moved on while this resolved; check where it is now instead.
      checkScope();
      return;
    }
    settled = { identity: check.identity, key };
    if (key !== view.key || key === null) showPack(key);
  };

  /**
   * Match the scope to the page as it is now. Any change of route, email,
   * platform or isolation setting is resolved; only a different key switches
   * the pack on screen. Returns the running check for the current context, or
   * null when the settled scope already matches it. A scope that failed to
   * resolve is only tried again on `retryFailed` (Add and Retry), not on every scan.
   */
  const checkScope = (retryFailed = false): ScopeCheck | null => {
    const context = readContext();
    const identity = identityOf(context);
    if (checking?.identity === identity) return checking;
    if (settled?.identity === identity && !(retryFailed && settled.key === null)) {
      checking = null;
      return null;
    }
    const check: ScopeCheck = { identity, key: resolveKey(context) };
    checking = check;
    // A key that cannot be resolved fails closed: no pack is read or written.
    void check.key.then(
      (key) => settle(check, key),
      () => settle(check, null),
    );
    return check;
  };

  /** The pack for what the page shows now, waiting for its check if one is running. */
  const keyForPage = async (): Promise<string> => {
    const check = checkScope(true);
    const key = check ? await check.key : (settled?.key ?? null);
    if (key === null) throw new Error('This page has no research pack scope');
    return key;
  };

  /** After a failure: resolve the scope again, or read the pack on screen again. */
  const retry = (): void => {
    if (view.revision !== null) return;
    panel.render(pack, markdown(), { replaceInstruction: true, locked: true });
    if (view.key === null) checkScope(true);
    else void load(view.key);
  };

  /** Panel edits act on the pack on screen, and only once it has rendered. */
  const editShown = (op: ResearchPackOp): Promise<unknown> | undefined => {
    if (view.key === null || view.revision === null) return undefined;
    return apply(view.key, op);
  };

  /** Save `content` as a file. The object URL is revoked shortly after the click. */
  const downloadFile = (filename: string, content: string, type: string): void => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    // Firefox only downloads from an anchor that is in the document.
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    const timer = setTimeout(() => {
      pendingDownloads.delete(timer);
      URL.revokeObjectURL(url);
    }, DOWNLOAD_URL_REVOKE_MS);
    pendingDownloads.set(timer, url);
  };

  const continueIn = createContinueInController(
    options.continueIn ?? {
      send: (message) => chrome.runtime.sendMessage(message),
      writeClipboard: (text) => navigator.clipboard.writeText(text),
    },
    t,
    (message, tone) => panel.notify(message, tone),
  );

  const panel = createResearchPackPanel(t, {
    onMove: (id, delta) => void editShown({ kind: 'move', id, delta }),
    onRemove: (id) => void editShown({ kind: 'remove', id }),
    // The text belongs to the pack on screen, so it is saved there.
    onInstructionChange: (instruction) => editShown({ kind: 'setInstruction', instruction }),
    onClear: () => void editShown({ kind: 'clear' }),
    onRetry: retry,
    // Exports hand over the pack on screen; the buttons are disabled while it loads.
    onCopy: () => {
      // The copy itself completes; a stopped run just says nothing about it.
      void navigator.clipboard
        .writeText(exportMarkdown())
        .then(() => {
          if (!stopped) panel.notify(t('researchPackCopied'));
        })
        .catch(() => {
          if (!stopped) panel.notify(t('researchPackCopyFailed'), 'error');
        });
    },
    onDownload: () =>
      downloadFile(
        buildResearchPackFilename(Date.now()),
        exportMarkdown(),
        'text/markdown;charset=utf-8',
      ),
    onInsert: () => {
      // Fill the composer only. The user reviews the pack and sends it.
      const input = findChatInput();
      if (!input || !insertTextIntoChatInput(exportMarkdown(), input)) {
        panel.notify(t('researchPackNoComposer'), 'error');
        return;
      }
      panel.close();
      panel.notify(t('researchPackInserted'));
    },
    // Hands over the same pack Copy does: the one on screen, with the typed instruction.
    onContinue: (target) => continueIn.continueIn(target, exportMarkdown()),
    onOpen: () => continueIn.refresh(),
    templateLibrary: options.templateLibrary ?? createChromeTemplateLibrary(),
    onDownloadFile: (filename, content) =>
      downloadFile(filename, content, 'application/json;charset=utf-8'),
  });

  const onAdd = async (
    host: HTMLElement,
    selectedText: string,
    button: HTMLButtonElement,
  ): Promise<void> => {
    let draft;
    try {
      draft = captureAnswer(host, selectedText);
    } catch {
      panel.notify(t('researchPackCaptureFailed'), 'error');
      return;
    }
    // The answer belongs to the page as it is at the click, whichever pack is on screen.
    let key: string;
    try {
      key = await keyForPage();
    } catch (error) {
      reportError(error);
      return;
    }
    const outcome = (await apply(key, { kind: 'add', draft }))?.outcome;
    if (!outcome || stopped) return;
    panel.notify(t(ADD_OUTCOME_MESSAGES[outcome]), outcome === 'added' ? 'ok' : 'error');
    if (outcome === 'added') {
      button.dataset.state = 'added';
      const timer = setTimeout(() => {
        flashTimers.delete(timer);
        delete button.dataset.state;
      }, ADDED_FLASH_MS);
      flashTimers.add(timer);
    }
  };

  const addButtonOptions = {
    label: t('researchPackAdd'),
    onAdd: (host: HTMLElement, selectedText: string, button: HTMLButtonElement) =>
      void onAdd(host, selectedText, button),
  };

  const scan = (): void => {
    if (stopped) return;
    // In-app navigation can move the page to another /u/<index>/ account, and
    // the account email often shows up only after the page has loaded.
    checkScope();
    ensureAddButtons(document, addButtonOptions);
  };

  const observer = new MutationObserver((mutations) => {
    // Our own button insertions and panel re-renders need no rescan.
    const relevant = mutations.some(
      (mutation) =>
        !(mutation.target instanceof Element) ||
        !(
          mutation.target.closest('.gv-rp-root') ||
          mutation.target.classList.contains(ADD_BUTTON_CLASS)
        ),
    );
    if (!relevant) return;
    if (observerTimer !== null) clearTimeout(observerTimer);
    observerTimer = setTimeout(() => {
      observerTimer = null;
      scan();
    }, OBSERVER_DEBOUNCE_MS);
  });

  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    const shownKey = view.key;
    if (areaName === 'local' && shownKey !== null && shownKey in changes) {
      const { newValue } = changes[shownKey];
      if (newValue === undefined) {
        // Removed: a new generation starts, shown as the empty pack storage now
        // holds (revision 0), so its first write is accepted at any revision.
        const wasShown = view.revision !== null;
        generation += 1;
        view = { key: shownKey, revision: 0 };
        pack = createEmptyPack();
        panel.render(pack, markdown(), { replaceInstruction: !wasShown });
      } else {
        offer(shownKey, parsePack(newValue), generation);
      }
    }
    if (areaName === 'local' && StorageKeys.PROMPT_ITEMS in changes) {
      // Templates are edited, added and deleted in Prompt Manager too.
      panel.refreshTemplates();
    }
    if (isIsolationSettingChange(changes, areaName, pageUrl())) {
      isolationEpoch += 1;
      checkScope();
    }
  };
  const relabel = (): void => {
    addButtonOptions.label = t('researchPackAdd');
    updateAddButtonLabels(document, addButtonOptions.label);
    panel.relabel();
  };

  document.body.appendChild(panel.root);
  panel.render(pack, markdown(), { replaceInstruction: true, locked: true });
  scan();
  observer.observe(document.body, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener(onStorageChanged);
  // Relabel once the new language has loaded, not when storage changes.
  const stopFollowingLanguage = onCachedLanguageChange(relabel);
  continueIn.refresh();

  return () => {
    if (stopped) return;
    stopped = true;
    continueIn.destroy();
    observer.disconnect();
    if (observerTimer !== null) clearTimeout(observerTimer);
    observerTimer = null;
    for (const timer of flashTimers) clearTimeout(timer);
    flashTimers.clear();
    for (const [timer, url] of pendingDownloads) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    pendingDownloads.clear();
    try {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    } catch {
      // The extension may have been reloaded while the page stayed open.
    }
    stopFollowingLanguage();
    panel.destroy();
    removeAddButtons(document);
  };
}
