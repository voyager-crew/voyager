/**
 * Page-wide owner of the Gemini / AI Studio send keys.
 *
 * Registrants say which mode they want; the coordinator owns the listeners.
 * Rules, all from the legacy send behavior:
 *
 * - At most one main mode. Exclusivity is decided before registering (owner
 *   table, resource arbitration); a second main mode is a contract breach and
 *   throws instead of being silently dropped.
 * - The Safari Enter fallback acts only on Safari and only while no main mode
 *   is registered; it never changes `effectiveSendKey()`.
 * - With nothing in effect no DOM listener or observer exists.
 * - `stop()` is final: a late startup read, registration or dispose is a no-op.
 *
 * Catalog sites never create one; `sendShortcut` keeps its own listener there.
 */
import { findGeminiSendButton } from '@/core/gemini/composer/send';
import { LoggerService } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { isSafari as detectSafari } from '@/core/utils/browser';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';

import { findAIStudioSendButton } from './aistudioSendRead';
import { editableKindOf, insertNewline } from './sendKeyDom';
import { type SendKeyMode, type SendKeyRule, classifySendKey } from './sendKeyIntent';
import { SEND_SITE_POLICIES, type SendSiteId } from './sendSitePolicies';

/** The send key other features follow on Gemini: Voyager's Ctrl+Enter, or the host's own Enter. */
export type EffectiveSendKey = 'ctrlEnter' | 'host';

export interface MainModeRegistration {
  /** Who registered, for diagnostics and contract errors. */
  readonly source: string;
  readonly mode: SendKeyMode;
}

export interface SafariFallbackRegistration {
  readonly source: string;
}

export interface SendKeyCoordinator {
  readonly site: SendSiteId;
  /** Returns the dispose; throws when a main mode is already registered or the site has no such mode. */
  registerMainMode(registration: MainModeRegistration): () => void;
  /** Returns the dispose; throws on a site without the Safari fix. */
  registerSafariFallback(registration: SafariFallbackRegistration): () => void;
  /** Gemini only; null on AI Studio, whose readers keep their own legacy reads. */
  effectiveSendKey(): EffectiveSendKey | null;
  subscribeEffectiveSendKey(listener: (key: EffectiveSendKey) => void): () => void;
  /** Settles once the stored switch has been read (or the coordinator stopped), not once a mode registered. */
  whenReady(): Promise<void>;
  /** True once `stop()` ran: registrations are no-ops, and a registrant should not follow its switches. */
  isStopped(): boolean;
  stop(): void;
}

export interface SendKeyCoordinatorOptions {
  readonly doc?: Document;
  readonly isSafari?: () => boolean;
}

const OBSERVER_DEBOUNCE_MS = 100;
const logger = LoggerService.getInstance().createChild('SendKeyCoordinator');

type StorageListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void;

const noop = (): void => {};

export function createSendKeyCoordinator(
  site: SendSiteId,
  options: SendKeyCoordinatorOptions = {},
): SendKeyCoordinator {
  const policy = SEND_SITE_POLICIES[site];
  const doc = options.doc ?? document;
  const isSafari = options.isSafari ?? detectSafari;

  let stopped = false;
  let main: { readonly token: symbol; readonly source: string; readonly rule: SendKeyRule } | null =
    null;
  const fallbacks = new Set<symbol>();

  // ---- DOM listeners (only while a rule is in effect) ----

  let listening = false;
  let observer: MutationObserver | null = null;
  let observerDebounceTimer: number | null = null;
  const observerPendingNodes = new Set<HTMLElement>();
  const attached = new Map<HTMLElement, () => void>();

  function activeRule(): SendKeyRule | null {
    if (main) return main.rule;
    if (fallbacks.size > 0 && isSafari()) return policy.safariFallback;
    return null;
  }

  function handleKeyDown(event: KeyboardEvent): void {
    const rule = activeRule();
    if (!rule || event.defaultPrevented) return;
    const intent = classifySendKey(event, rule);
    if (intent === 'host') return;

    const target = event.target as HTMLElement;
    const kind = editableKindOf(target);
    if (!kind) return;

    if (intent === 'send') {
      const sendButton =
        site === 'gemini' ? findGeminiSendButton(target) : findAIStudioSendButton(target);
      if (!sendButton) return;
      // Element-level and stopPropagation only: document-capture readers have already run.
      event.preventDefault();
      event.stopPropagation();
      sendButton.click();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    insertNewline(target, kind);
  }

  function attachToInput(element: HTMLElement): void {
    if (attached.has(element)) return;
    element.addEventListener('keydown', handleKeyDown, { capture: true });
    attached.set(element, () =>
      element.removeEventListener('keydown', handleKeyDown, { capture: true }),
    );
  }

  function attachWithin(node: HTMLElement): void {
    if (
      node.isContentEditable ||
      node.getAttribute('role') === 'textbox' ||
      node.tagName === 'TEXTAREA'
    ) {
      attachToInput(node);
    }
    node.querySelectorAll<HTMLElement>(policy.editableSelector).forEach(attachToInput);
  }

  function startListening(): void {
    if (listening) return;
    listening = true;
    doc.querySelectorAll<HTMLElement>(policy.editableSelector).forEach(attachToInput);

    const view = doc.defaultView ?? window;
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) observerPendingNodes.add(node);
        }
      }
      if (observerPendingNodes.size === 0) return;
      if (observerDebounceTimer !== null) view.clearTimeout(observerDebounceTimer);
      observerDebounceTimer = view.setTimeout(() => {
        observerDebounceTimer = null;
        const pendingNodes = Array.from(observerPendingNodes);
        observerPendingNodes.clear();
        pendingNodes.forEach((node) => {
          if (node.isConnected) attachWithin(node);
        });
      }, OBSERVER_DEBOUNCE_MS);
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    logger.info('Listeners activated');
  }

  function stopListening(): void {
    if (!listening) return;
    listening = false;
    attached.forEach((detach) => detach());
    attached.clear();
    if (observerDebounceTimer !== null) {
      (doc.defaultView ?? window).clearTimeout(observerDebounceTimer);
      observerDebounceTimer = null;
    }
    observerPendingNodes.clear();
    observer?.disconnect();
    observer = null;
    logger.info('Listeners deactivated');
  }

  function reconcile(): void {
    if (activeRule()) startListening();
    else stopListening();
  }

  // ---- Effective send key (Gemini only) ----

  const tracksSendKey = site === 'gemini';
  let storedCtrlEnterSend = false;
  let storedRevision = 0;
  let lastPublished: EffectiveSendKey | null = null;
  const subscribers = new Set<(key: EffectiveSendKey) => void>();

  function effectiveSendKey(): EffectiveSendKey | null {
    if (!tracksSendKey) return null;
    if (main) return 'ctrlEnter';
    return storedCtrlEnterSend ? 'ctrlEnter' : 'host';
  }

  function publish(): void {
    const key = effectiveSendKey();
    if (key === null || key === lastPublished) return;
    lastPublished = key;
    subscribers.forEach((listener) => listener(key));
  }

  let resolveReady: () => void = noop;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  let storageListener: StorageListener | null = null;

  if (tracksSendKey) {
    storageListener = (changes, areaName) => {
      if (areaName !== 'sync' || !(StorageKeys.CTRL_ENTER_SEND in changes)) return;
      storedRevision += 1;
      storedCtrlEnterSend = changes[StorageKeys.CTRL_ENTER_SEND].newValue === true;
      publish();
    };
    try {
      chrome.storage?.onChanged?.addListener(storageListener);
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) {
        logger.warn('Failed to follow the send key setting', { error });
      }
    }

    const revisionAtRead = storedRevision;
    try {
      if (!chrome.storage?.sync?.get) {
        resolveReady();
      } else {
        chrome.storage.sync.get({ [StorageKeys.CTRL_ENTER_SEND]: false }, (result) => {
          // A change that arrived while the read was in flight is newer than the read.
          if (!stopped && storedRevision === revisionAtRead) {
            storedCtrlEnterSend = result?.[StorageKeys.CTRL_ENTER_SEND] === true;
            publish();
          }
          resolveReady();
        });
      }
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) {
        logger.warn('Failed to read the send key setting', { error });
      }
      resolveReady();
    }
  } else {
    resolveReady();
  }

  // ---- Public surface ----

  function registerMainMode(registration: MainModeRegistration): () => void {
    if (stopped) return noop;
    const rule = policy.mainModes[registration.mode];
    if (!rule) {
      throw new Error(`[SendKeyCoordinator] ${site} has no ${registration.mode} send mode`);
    }
    if (main) {
      throw new Error(
        `[SendKeyCoordinator] ${registration.source} registered a main send mode while ${main.source} holds it`,
      );
    }
    const token = Symbol(registration.source);
    main = { token, source: registration.source, rule };
    reconcile();
    publish();
    return () => {
      if (main?.token !== token) return;
      main = null;
      reconcile();
      publish();
    };
  }

  function registerSafariFallback(registration: SafariFallbackRegistration): () => void {
    if (stopped) return noop;
    if (!policy.safariFallback) {
      throw new Error(`[SendKeyCoordinator] ${site} has no Safari Enter fallback`);
    }
    const token = Symbol(registration.source);
    fallbacks.add(token);
    reconcile();
    return () => {
      if (!fallbacks.delete(token)) return;
      reconcile();
    };
  }

  function subscribeEffectiveSendKey(listener: (key: EffectiveSendKey) => void): () => void {
    if (stopped || !tracksSendKey) return noop;
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    main = null;
    fallbacks.clear();
    stopListening();
    subscribers.clear();
    if (storageListener) {
      try {
        chrome.storage?.onChanged?.removeListener(storageListener);
      } catch {
        // An orphaned content script cannot reach chrome.storage any more.
      }
      storageListener = null;
    }
    resolveReady();
  }

  return {
    site,
    registerMainMode,
    registerSafariFallback,
    effectiveSendKey,
    subscribeEffectiveSendKey,
    whenReady: () => ready,
    isStopped: () => stopped,
    stop,
  };
}

let pageCoordinator: SendKeyCoordinator | null = null;

/**
 * Create the page's coordinator, once per content script. It stays in place
 * after `stop()`, so a start still running in a retired copy gets a stopped
 * coordinator instead of reviving listeners.
 */
export function startSendKeyCoordinator(site: SendSiteId): SendKeyCoordinator {
  pageCoordinator ??= createSendKeyCoordinator(site);
  return pageCoordinator;
}

/** The page's coordinator for `site`, or null before the content script created one. */
export function getSendKeyCoordinator(site: SendSiteId): SendKeyCoordinator | null {
  return pageCoordinator?.site === site ? pageCoordinator : null;
}
