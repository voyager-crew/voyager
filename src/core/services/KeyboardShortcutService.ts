/**
 * KeyboardShortcutService - Manages keyboard shortcuts for timeline navigation
 *
 * Design Patterns:
 * - Singleton: Ensures single instance across application
 * - Strategy: Configurable shortcut matching strategies
 * - Observer: Event-based callback system
 *
 * Features:
 * - Configurable shortcuts with modifier keys
 * - Chrome storage integration for persistence
 * - Type-safe action handling
 * - Collision detection with browser shortcuts
 */
import { StorageKeys } from '@/core/types/common';
import type {
  KeyboardShortcut,
  KeyboardShortcutConfig,
  KeyboardShortcutStorage,
  ModifierKey,
  ShortcutAction,
  ShortcutMatch,
} from '@/core/types/keyboardShortcut';
import { isMac } from '@/core/utils/browser';
import { composedEventTarget, deepActiveElement } from '@/core/utils/composedTarget';

/**
 * Timeout for key sequence detection (e.g., gg, GG)
 */
const SEQUENCE_TIMEOUT_MS = 500;

/**
 * Default keyboard shortcuts configuration
 * Using vim-style j/k (convenient, no modifiers needed)
 */
const DEFAULT_SHORTCUTS: KeyboardShortcutConfig = {
  previous: {
    action: 'timeline:previous',
    modifiers: [],
    key: 'k',
  },
  next: {
    action: 'timeline:next',
    modifiers: [],
    key: 'j',
  },
  first: {
    action: 'timeline:first',
    modifiers: [],
    key: 'g',
    sequenceLength: 2,
  },
  last: {
    action: 'timeline:last',
    modifiers: ['Shift'],
    key: 'G',
    sequenceLength: 2,
  },
};

/**
 * Callback type for shortcut actions
 */
export type ShortcutCallback = (action: ShortcutAction, event: KeyboardEvent) => void;

/**
 * KeyboardShortcutService class
 * Singleton service for managing keyboard shortcuts
 */
export class KeyboardShortcutService {
  private static instance: KeyboardShortcutService | null = null;

  private config: KeyboardShortcutConfig;
  private enabled: boolean = true;
  private listeners: Set<ShortcutCallback> = new Set();
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private storageChangeHandler:
    | ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void)
    | null = null;

  /** Bumped by destroy() so an init() that was loading its config does not attach afterwards. */
  private generation = 0;

  // Key sequence tracking (for gg → first, GG → last)
  private lastSequenceSignature: string | null = null;
  private lastSequenceTime: number = 0;

  private constructor() {
    this.config = DEFAULT_SHORTCUTS;
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
   * Initialize service: load config and attach listeners
   */
  async init(): Promise<void> {
    const generation = this.generation;
    await this.loadConfig();
    // destroy() ran while the config loaded (the page tore its timeline down): attaching now would
    // leave a keydown handler swallowing shortcut keys with nothing left to remove it.
    if (generation !== this.generation) return;
    this.attachKeyboardListener();
    this.attachStorageListener();
  }

  /**
   * Load configuration from chrome storage
   */
  private async loadConfig(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        const result = (await chrome.storage.sync.get(StorageKeys.TIMELINE_SHORTCUTS)) ?? {};
        const stored = result[StorageKeys.TIMELINE_SHORTCUTS] as
          | KeyboardShortcutStorage
          | undefined;

        if (stored?.shortcuts) {
          const normalized = this.normalizeConfig(stored.shortcuts);
          this.config = this.validateConfig(normalized) ? normalized : DEFAULT_SHORTCUTS;
          this.enabled = stored.enabled ?? true;
        }
      } else {
        // Fallback to localStorage
        const stored = localStorage.getItem(StorageKeys.TIMELINE_SHORTCUTS);
        if (stored) {
          const parsed = JSON.parse(stored) as KeyboardShortcutStorage;
          const normalized = this.normalizeConfig(parsed.shortcuts);
          this.config = this.validateConfig(normalized) ? normalized : DEFAULT_SHORTCUTS;
          this.enabled = parsed.enabled ?? true;
        }
      }
    } catch (error) {
      console.warn('[KeyboardShortcut] Failed to load config, using defaults:', error);
      this.config = DEFAULT_SHORTCUTS;
      this.enabled = true;
    }
  }

  /**
   * Save configuration to chrome storage
   */
  async saveConfig(config: KeyboardShortcutConfig, enabled: boolean = this.enabled): Promise<void> {
    const normalized = this.normalizeConfig(config);

    if (!this.validateConfig(normalized)) {
      throw new Error('Invalid shortcut configuration');
    }

    this.config = normalized;
    this.enabled = enabled;

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
   * Merge partial or legacy shortcut config with defaults
   */
  private normalizeConfig(
    config: Partial<KeyboardShortcutConfig> | null | undefined,
  ): KeyboardShortcutConfig {
    return {
      previous: this.normalizeShortcut(config?.previous, DEFAULT_SHORTCUTS.previous),
      next: this.normalizeShortcut(config?.next, DEFAULT_SHORTCUTS.next),
      first: this.normalizeShortcut(config?.first, DEFAULT_SHORTCUTS.first),
      last: this.normalizeShortcut(config?.last, DEFAULT_SHORTCUTS.last),
    };
  }

  /**
   * Normalize individual shortcut with safe defaults
   */
  private normalizeShortcut(
    shortcut: Partial<KeyboardShortcut> | undefined,
    fallback: KeyboardShortcut,
  ): KeyboardShortcut {
    return {
      action: fallback.action,
      modifiers: Array.isArray(shortcut?.modifiers) ? shortcut.modifiers : fallback.modifiers,
      key:
        typeof shortcut?.key === 'string' && shortcut.key.length > 0 ? shortcut.key : fallback.key,
      sequenceLength:
        typeof shortcut?.sequenceLength === 'number' && Number.isInteger(shortcut.sequenceLength)
          ? shortcut.sequenceLength
          : (fallback.sequenceLength ?? 1),
    };
  }

  /**
   * Validate shortcut configuration
   */
  private validateConfig(config: KeyboardShortcutConfig): boolean {
    try {
      return !!(
        config.previous &&
        config.next &&
        config.first &&
        config.last &&
        this.isValidShortcut(config.previous) &&
        this.isValidShortcut(config.next) &&
        this.isValidShortcut(config.first) &&
        this.isValidShortcut(config.last)
      );
    } catch {
      return false;
    }
  }

  /**
   * Validate individual shortcut
   */
  private isValidShortcut(shortcut: KeyboardShortcut): boolean {
    const validModifiers: ModifierKey[] = ['Alt', 'Ctrl', 'Shift', 'Meta'];

    return (
      Array.isArray(shortcut.modifiers) &&
      shortcut.modifiers.every((m) => validModifiers.includes(m)) &&
      typeof shortcut.key === 'string' &&
      shortcut.key.length > 0 &&
      Number.isInteger(shortcut.sequenceLength ?? 1) &&
      (shortcut.sequenceLength ?? 1) > 0
    );
  }

  /**
   * Attach keyboard event listener
   */
  private attachKeyboardListener(): void {
    if (this.keydownHandler) return;

    this.keydownHandler = (event: KeyboardEvent) => {
      if (!this.enabled) return;

      if (this.isImeComposing(event)) {
        this.resetSequence();
        return;
      }

      // Ignore shortcuts when user is typing in input fields
      if (this.isTypingInInputField(event)) {
        this.resetSequence();
        return;
      }

      // Check for key sequences first (gg → first, GG → last)
      const sequenceMatch = this.matchSequence(event);
      if (sequenceMatch) {
        event.preventDefault();
        event.stopPropagation();
        this.notifyListeners(sequenceMatch.action, event);
        return;
      }

      const match = this.matchShortcut(event);
      if (match) {
        event.preventDefault();
        event.stopPropagation();
        this.resetSequence();
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
    // Timeline remounts reuse this singleton; keep the one handler destroy() can remove.
    if (this.storageChangeHandler) return;

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      this.storageChangeHandler = (changes, areaName) => {
        if (areaName !== 'sync') return;
        if (changes[StorageKeys.TIMELINE_SHORTCUTS]) {
          const newValue = changes[StorageKeys.TIMELINE_SHORTCUTS].newValue as
            | KeyboardShortcutStorage
            | undefined;
          if (newValue?.shortcuts) {
            const normalized = this.normalizeConfig(newValue.shortcuts);
            this.config = this.validateConfig(normalized) ? normalized : DEFAULT_SHORTCUTS;
            this.enabled = newValue.enabled ?? true;
          }
        }
      };

      chrome.storage.onChanged.addListener(this.storageChangeHandler);
    }
  }

  /**
   * Match keyboard event to shortcut (Strategy Pattern)
   */
  private matchShortcut(event: KeyboardEvent): ShortcutMatch | null {
    const shortcuts = [
      { action: 'timeline:previous' as const, config: this.config.previous },
      { action: 'timeline:next' as const, config: this.config.next },
      { action: 'timeline:first' as const, config: this.config.first },
      { action: 'timeline:last' as const, config: this.config.last },
    ];

    // Check if any shortcut matches
    for (const { action, config } of shortcuts) {
      if ((config.sequenceLength ?? 1) === 1 && this.isShortcutPressed(event, config)) {
        return { action, event };
      }
    }

    return null;
  }

  /**
   * Check if specific shortcut is pressed
   */
  private isShortcutPressed(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
    // Check key match
    if (event.key !== shortcut.key) return false;

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
  private matchSequence(event: KeyboardEvent): ShortcutMatch | null {
    // Don't process sequences on key repeat (held down)
    if (event.repeat) return null;

    const sequenceShortcuts = [
      { action: 'timeline:first' as const, config: this.config.first },
      { action: 'timeline:last' as const, config: this.config.last },
    ];
    const now = Date.now();

    for (const { action, config } of sequenceShortcuts) {
      if ((config.sequenceLength ?? 1) <= 1 || !this.isShortcutPressed(event, config)) {
        continue;
      }

      const signature = this.getShortcutSignature(config);
      if (
        this.lastSequenceSignature === signature &&
        now - this.lastSequenceTime < SEQUENCE_TIMEOUT_MS
      ) {
        this.resetSequence();
        return { action, event };
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
    return `${modifiers}|${shortcut.key}|${shortcut.sequenceLength ?? 1}`;
  }

  /**
   * Notify all registered listeners (Observer Pattern)
   */
  private notifyListeners(action: ShortcutAction, event: KeyboardEvent): void {
    this.listeners.forEach((callback) => {
      try {
        callback(action, event);
      } catch (error) {
        console.error('[KeyboardShortcut] Error in listener callback:', error);
      }
    });
  }

  /**
   * Register a shortcut callback
   */
  on(callback: ShortcutCallback): () => void {
    this.listeners.add(callback);
    // Return unsubscribe function
    return () => this.off(callback);
  }

  /**
   * Unregister a shortcut callback
   */
  off(callback: ShortcutCallback): void {
    this.listeners.delete(callback);
  }

  /**
   * Get current configuration
   */
  getConfig(): { config: KeyboardShortcutConfig; enabled: boolean } {
    return {
      config: {
        previous: { ...this.config.previous },
        next: { ...this.config.next },
        first: { ...this.config.first },
        last: { ...this.config.last },
      },
      enabled: this.enabled,
    };
  }

  /**
   * Reset to default shortcuts
   */
  async resetToDefaults(): Promise<void> {
    await this.saveConfig(DEFAULT_SHORTCUTS, true);
  }

  /**
   * Enable/disable shortcuts
   */
  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
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
      const parts = [...modifiers, key];
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
   * Cleanup service
   */
  destroy(): void {
    this.generation += 1;
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, { capture: true });
      this.keydownHandler = null;
    }

    if (this.storageChangeHandler && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(this.storageChangeHandler);
      this.storageChangeHandler = null;
    }

    this.listeners.clear();
  }
}

/**
 * Export singleton instance for convenience
 */
export const keyboardShortcutService = KeyboardShortcutService.getInstance();
