import { StorageKeys } from '@/core/types/common';
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  type KeyboardShortcut,
  type KeyboardShortcutConfigInput,
  type KeyboardShortcutStorage,
  type ResolvedKeyboardShortcutConfig,
  type ShortcutAction,
  type ShortcutMatch,
  TIMELINE_SHORTCUT_ACTIONS,
  findKeyboardShortcutConflict,
  isRestorableKeyboardShortcutStorage,
  normalizeKeyboardShortcutConfig,
} from '@/core/types/keyboardShortcut';
import { isMac } from '@/core/utils/browser';
import { composedEventTarget, deepActiveElement } from '@/core/utils/composedTarget';

/**
 * Timeout for key sequence detection (e.g., gg, GG)
 */
const SEQUENCE_TIMEOUT_MS = 500;

/** Only these actions opt into editable targets, and only with a modifier and no sequence. */
const EDITABLE_MODIFIER_ACTIONS: ReadonlySet<ShortcutAction> = new Set(['panel:toggle']);

/**
 * For a modifier binding whose character is no ASCII letter or digit (a macOS
 * Option composition such as "∫" or "√"), the letter or digit its code names
 * ("B", "V"); null for any other binding, so other layouts keep their key's label.
 */
export function printedShortcutKey(
  shortcut: Pick<KeyboardShortcut, 'key' | 'code' | 'modifiers'>,
): string | null {
  if (shortcut.modifiers.length === 0 || /^[A-Za-z0-9]$/.test(shortcut.key)) return null;
  const printed = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(shortcut.code ?? '');
  return printed ? (printed[1] ?? printed[2]) : null;
}

/**
 * Callback type for shortcut actions
 */
export type ShortcutCallback = (action: ShortcutAction, event: KeyboardEvent) => void;

/** One holder's claim on the page's shortcut session; see `KeyboardShortcutService.acquire`. */
export interface ShortcutLease {
  /** Settles once this session's saved config is applied, or when the read is discarded. */
  readonly ready: Promise<void>;
  /** Idempotent; only the last outstanding lease ends the session. */
  release(): void;
}

interface LoadedShortcutConfig {
  config: ResolvedKeyboardShortcutConfig;
  enabled: boolean;
}

/**
 * KeyboardShortcutService class
 * Singleton service for managing keyboard shortcuts
 */
export class KeyboardShortcutService {
  private static instance: KeyboardShortcutService | null = null;

  private config: ResolvedKeyboardShortcutConfig;
  private enabled: boolean = true;
  private listeners = new Map<ShortcutCallback, readonly ShortcutAction[]>();
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private storageChangeHandler:
    | ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void)
    | null = null;

  /** A new session starts when the first lease is taken and ends with the last release. */
  private sessionEpoch = 0;
  /** Bumped by every live config change, so an initial read that began earlier cannot win. */
  private liveRevision = 0;
  private readonly leases = new Set<symbol>();
  private sessionReady: Promise<void> = Promise.resolve();
  /** The lease `init()` holds for callers that predate leases (the popup); destroy() ends it. */
  private initLease: ShortcutLease | null = null;

  // Key sequence tracking (for gg → first, GG → last)
  private lastSequenceSignature: string | null = null;
  private lastSequenceTime: number = 0;

  private constructor() {
    this.config = normalizeKeyboardShortcutConfig(undefined);
  }

  /**
   * Get singleton instance (Factory Pattern)
   */
  static getInstance(): KeyboardShortcutService {
    if (!KeyboardShortcutService.instance) {
      KeyboardShortcutService.instance = new KeyboardShortcutService();
    }
    return KeyboardShortcutService.instance;
  }

  /**
   * Initialize service: load config and attach listeners until destroy(). Content pages take a
   * lease with `acquire()` instead, so the last one to leave hands the keys back to the page.
   */
  async init(): Promise<void> {
    if (!this.initLease) this.initLease = this.acquire();
    await this.initLease.ready;
  }

  /**
   * Hold the shortcut session open. The first lease opens a session and reads the saved config;
   * the last release closes it. Keys are only claimed while a listener is registered (`on`).
   */
  acquire(): ShortcutLease {
    const token = Symbol('shortcut-lease');
    this.leases.add(token);
    if (this.leases.size === 1) this.openSession();
    return { ready: this.sessionReady, release: () => this.release(token) };
  }

  private release(token: symbol): void {
    if (!this.leases.delete(token) || this.leases.size > 0) return;
    this.closeSession();
  }

  private openSession(): void {
    const epoch = ++this.sessionEpoch;
    const revision = this.liveRevision;
    // Listen before reading: a change that lands during the read must be seen to outrank it.
    this.attachStorageListener();
    this.sessionReady = this.loadConfig().then((loaded) => {
      // A read from a closed session must not overwrite the config of the session after it.
      if (epoch !== this.sessionEpoch) return;
      if (loaded && revision === this.liveRevision) this.applyConfig(loaded);
      this.attachKeyboardListener();
    });
  }

  private closeSession(): void {
    this.sessionEpoch += 1;
    this.detachListeners();
    this.resetSequence();
  }

  private applyConfig({ config, enabled }: LoadedShortcutConfig): void {
    this.config = config;
    this.enabled = enabled;
  }

  /**
   * Read the saved configuration; the caller decides whether it may still be applied.
   * Resolves null when nothing is saved.
   */
  private async loadConfig(): Promise<LoadedShortcutConfig | null> {
    try {
      let stored: unknown;
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        const result: Record<string, unknown> =
          (await chrome.storage.sync.get(StorageKeys.TIMELINE_SHORTCUTS)) ?? {};
        stored = result[StorageKeys.TIMELINE_SHORTCUTS];
      } else {
        // Fallback to localStorage
        const raw = localStorage.getItem(StorageKeys.TIMELINE_SHORTCUTS);
        if (!raw) return null;
        stored = JSON.parse(raw) as unknown;
      }
      return this.readStoredConfig(stored);
    } catch (error) {
      console.warn('[KeyboardShortcut] Failed to load config, using defaults:', error);
      return { config: normalizeKeyboardShortcutConfig(undefined), enabled: true };
    }
  }

  private readStoredConfig(stored: unknown): LoadedShortcutConfig | null {
    if (typeof stored !== 'object' || stored === null || !('shortcuts' in stored)) return null;
    return {
      config: normalizeKeyboardShortcutConfig(stored.shortcuts),
      enabled:
        !('enabled' in stored) || typeof stored.enabled !== 'boolean' ? true : stored.enabled,
    };
  }

  /**
   * Save configuration to chrome storage
   */
  async saveConfig(
    config: KeyboardShortcutConfigInput,
    enabled: boolean = this.enabled,
  ): Promise<void> {
    if (!isRestorableKeyboardShortcutStorage({ shortcuts: config, enabled })) {
      throw new Error('Invalid shortcut configuration');
    }
    const normalized = normalizeKeyboardShortcutConfig(config, this.config.panelToggle);
    const conflict = findKeyboardShortcutConflict(normalized);
    // An ambiguous save must leave both the live bindings and the stored choice intact.
    if (conflict) throw new Error(`Conflicting shortcut bindings: ${conflict.join(', ')}`);

    this.liveRevision += 1;
    this.applyConfig({ config: normalized, enabled });

    const storage: KeyboardShortcutStorage = {
      shortcuts: normalized,
      enabled,
    };

    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        await chrome.storage.sync.set({ [StorageKeys.TIMELINE_SHORTCUTS]: storage });
      } else {
        localStorage.setItem(StorageKeys.TIMELINE_SHORTCUTS, JSON.stringify(storage));
      }
    } catch (error) {
      console.error('[KeyboardShortcut] Failed to save config:', error);
      throw error;
    }
  }

  /**
   * Attach keyboard event listener
   */
  private attachKeyboardListener(): void {
    if (this.keydownHandler) return;

    this.keydownHandler = (event: KeyboardEvent) => {
      // Nobody would act on a match, so the key belongs to the page.
      if (this.listeners.size === 0) return;

      if (this.isImeComposing(event)) {
        this.resetSequence();
        return;
      }

      const editing = this.isTypingInInputField(event);
      if (editing) this.resetSequence();
      const available = Object.values(this.config).filter(
        (shortcut) =>
          (this.enabled || shortcut.action === 'panel:toggle') &&
          this.hasListener(shortcut.action) &&
          (!editing ||
            (EDITABLE_MODIFIER_ACTIONS.has(shortcut.action) &&
              shortcut.modifiers.length > 0 &&
              (shortcut.sequenceLength ?? 1) === 1)),
      );
      // Old backups may already contain conflicts. Keep the core panel reachable without
      // rewriting those choices; without a panel subscriber, timeline matching stays unchanged.
      const panel = available.find(
        (shortcut) => shortcut.action === 'panel:toggle' && this.isShortcutPressed(event, shortcut),
      );
      const shortcuts = panel ? [panel] : available;

      // Check for key sequences first (gg → first, GG → last)
      const sequenceMatch = editing ? null : this.matchSequence(event, shortcuts);
      if (sequenceMatch) {
        event.preventDefault();
        event.stopPropagation();
        this.notifyListeners(sequenceMatch.action, event);
        return;
      }

      const match = this.matchShortcut(event, shortcuts);
      if (match) {
        event.preventDefault();
        event.stopPropagation();
        this.resetSequence();
        // Holding Option+V must neither toggle repeatedly nor start typing its layout character.
        if (match.action !== 'panel:toggle' || !event.repeat)
          this.notifyListeners(match.action, event);
      }
    };

    window.addEventListener('keydown', this.keydownHandler, { capture: true });
  }

  /**
   * Check if user is typing in an input field
   * Prevents shortcuts from interfering with text input
   */
  private isTypingInInputField(event: KeyboardEvent): boolean {
    return (
      this.isEditableElement(composedEventTarget(event)) ||
      this.isEditableElement(deepActiveElement())
    );
  }

  private isEditableElement(target: EventTarget | Element | null): boolean {
    if (!(target instanceof Element)) return false;

    const tagName = target.tagName.toLowerCase();
    const isInput = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    if (isInput) return true;

    return (
      (target instanceof HTMLElement && target.isContentEditable) ||
      Boolean(target.closest('[contenteditable="true"], [role="textbox"]'))
    );
  }

  private isImeComposing(event: KeyboardEvent): boolean {
    return event.isComposing || event.key === 'Process' || event.keyCode === 229;
  }

  /**
   * Attach storage change listener for cross-tab sync
   */
  private attachStorageListener(): void {
    // Timeline remounts reuse this singleton; keep the one handler closeSession() can remove.
    if (this.storageChangeHandler) return;

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      this.storageChangeHandler = (changes, areaName) => {
        if (areaName !== 'sync') return;
        const change = changes[StorageKeys.TIMELINE_SHORTCUTS];
        if (!change) return;
        this.liveRevision += 1;
        const loaded = this.readStoredConfig(change.newValue);
        if (loaded) this.applyConfig(loaded);
      };

      chrome.storage.onChanged.addListener(this.storageChangeHandler);
    }
  }

  /**
   * Match keyboard event to shortcut (Strategy Pattern)
   */
  private matchShortcut(
    event: KeyboardEvent,
    shortcuts: readonly KeyboardShortcut[],
  ): ShortcutMatch | null {
    for (const shortcut of shortcuts) {
      if ((shortcut.sequenceLength ?? 1) === 1 && this.isShortcutPressed(event, shortcut)) {
        return { action: shortcut.action, event };
      }
    }

    return null;
  }

  /**
   * Check if specific shortcut is pressed
   */
  private isShortcutPressed(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
    // Check key match
    if (shortcut.code ? event.code !== shortcut.code : event.key !== shortcut.key) return false;

    // Check modifier matches
    const hasAlt = shortcut.modifiers.includes('Alt');
    const hasCtrl = shortcut.modifiers.includes('Ctrl');
    const hasShift = shortcut.modifiers.includes('Shift');
    const hasMeta = shortcut.modifiers.includes('Meta');

    return (
      event.altKey === hasAlt &&
      event.ctrlKey === hasCtrl &&
      event.shiftKey === hasShift &&
      event.metaKey === hasMeta
    );
  }

  /**
   * Match key sequence (gg → timeline:first, GG → timeline:last)
   */
  private matchSequence(
    event: KeyboardEvent,
    shortcuts: readonly KeyboardShortcut[],
  ): ShortcutMatch | null {
    // Don't process sequences on key repeat (held down)
    if (event.repeat) return null;

    const now = Date.now();

    for (const config of shortcuts) {
      if ((config.sequenceLength ?? 1) <= 1 || !this.isShortcutPressed(event, config)) {
        continue;
      }

      const signature = this.getShortcutSignature(config);
      if (
        this.lastSequenceSignature === signature &&
        now - this.lastSequenceTime < SEQUENCE_TIMEOUT_MS
      ) {
        this.resetSequence();
        return { action: config.action, event };
      }

      this.lastSequenceSignature = signature;
      this.lastSequenceTime = now;
      return null;
    }

    // Any other key resets the sequence
    this.resetSequence();
    return null;
  }

  private resetSequence(): void {
    this.lastSequenceSignature = null;
    this.lastSequenceTime = 0;
  }

  private getShortcutSignature(shortcut: KeyboardShortcut): string {
    const modifiers = [...shortcut.modifiers].sort().join('+');
    return `${shortcut.action}|${modifiers}|${shortcut.code ?? shortcut.key}|${shortcut.sequenceLength ?? 1}`;
  }

  /**
   * Notify all registered listeners (Observer Pattern)
   */
  private notifyListeners(action: ShortcutAction, event: KeyboardEvent): void {
    this.listeners.forEach((actions, callback) => {
      if (!actions.includes(action)) return;
      try {
        callback(action, event);
      } catch (error) {
        console.error('[KeyboardShortcut] Error in listener callback:', error);
      }
    });
  }

  /** Existing callers receive timeline actions; the shell opts in with ['panel:toggle']. */
  on(
    callback: ShortcutCallback,
    actions: readonly ShortcutAction[] = TIMELINE_SHORTCUT_ACTIONS,
  ): () => void {
    this.listeners.set(callback, actions);
    // Return unsubscribe function
    return () => this.off(callback);
  }

  /**
   * Unregister a shortcut callback
   */
  off(callback: ShortcutCallback): void {
    this.listeners.delete(callback);
  }

  private hasListener(action: ShortcutAction): boolean {
    return [...this.listeners.values()].some((actions) => actions.includes(action));
  }

  /**
   * Get current configuration
   */
  getConfig(): { config: ResolvedKeyboardShortcutConfig; enabled: boolean } {
    return {
      config: structuredClone(this.config),
      enabled: this.enabled,
    };
  }

  /**
   * Reset to default shortcuts
   */
  async resetToDefaults(): Promise<void> {
    await this.saveConfig(DEFAULT_KEYBOARD_SHORTCUTS, true);
  }

  /**
   * Enable/disable shortcuts
   */
  async setEnabled(enabled: boolean): Promise<void> {
    await this.saveConfig(this.config, enabled);
  }

  /**
   * Format shortcut for display (e.g., "Alt + ↑" or "j")
   */
  formatShortcut(shortcut: KeyboardShortcut): string {
    // Map common keys to symbols for better display
    const keySymbols: Record<string, string> = {
      ArrowUp: '↑',
      ArrowDown: '↓',
      ArrowLeft: '←',
      ArrowRight: '→',
      ' ': 'Space',
      Enter: '⏎',
      Tab: '⇥',
      Backspace: '⌫',
      Delete: '⌦',
      Escape: 'Esc',
    };

    const formatSingleShortcut = (singleShortcut: KeyboardShortcut): string => {
      const key = keySymbols[singleShortcut.key] || singleShortcut.key;

      if (singleShortcut.modifiers.length === 0) {
        return key;
      }

      const mac = isMac();
      const modifierSymbols: Record<string, string> = mac
        ? { Meta: '⌘', Alt: '⌥', Ctrl: '⌃', Shift: '⇧' }
        : { Meta: 'Win', Alt: 'Alt', Ctrl: 'Ctrl', Shift: 'Shift' };

      const modifiers = singleShortcut.modifiers.map((m) => modifierSymbols[m] || m);
      const parts = [...modifiers, printedShortcutKey(singleShortcut) ?? key];
      return parts.join(mac ? '' : ' + ');
    };

    const sequenceLength = shortcut.sequenceLength ?? 1;
    if (sequenceLength <= 1) {
      return formatSingleShortcut(shortcut);
    }

    if (
      shortcut.key.length === 1 &&
      (shortcut.modifiers.length === 0 ||
        (shortcut.modifiers.length === 1 && shortcut.modifiers[0] === 'Shift'))
    ) {
      return shortcut.key.repeat(sequenceLength);
    }

    return Array.from({ length: sequenceLength }, () => formatSingleShortcut(shortcut)).join(' ');
  }

  /**
   * Page fallback: end the session whoever still holds a lease, and drop every listener.
   */
  destroy(): void {
    this.leases.clear();
    this.initLease = null;
    this.closeSession();
    this.listeners.clear();
  }

  private detachListeners(): void {
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, { capture: true });
      this.keydownHandler = null;
    }

    if (this.storageChangeHandler && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(this.storageChangeHandler);
      this.storageChangeHandler = null;
    }
  }
}

/**
 * Export singleton instance for convenience
 */
export const keyboardShortcutService = KeyboardShortcutService.getInstance();
