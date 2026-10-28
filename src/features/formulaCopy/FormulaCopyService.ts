/**
 * Formula Copy Service
 * Handles copying LaTeX/MathJax formulas from Gemini chat conversations
 * Uses enterprise patterns: Singleton, Service Layer, Event Delegation
 */
import browser from 'webextension-polyfill';

import { logger } from '@/core';
import { StorageKeys } from '@/core/types/common';
import type { ILogger } from '@/core/types/common';
import { createToaster } from '@/core/ui/toast/toaster';
import { packagedSiteForUrl } from '@/features/plugins/sites/hostPolicy';
import { getTranslationSyncUnsafe } from '@/utils/i18n';

import { FormulaInteraction } from './FormulaInteraction';
import { copyFormulaToClipboard } from './formulaClipboard';
import { formatFormula } from './formulaCopyPayload';
import {
  extractLatexSource,
  findMathElement,
  isDisplayMode as isFormulaDisplayMode,
} from './formulaSource';

/**
 * Formula copy format options
 */
export type FormulaCopyFormat = 'latex' | 'unicodemath' | 'no-dollar' | 'notion';

/**
 * Configuration for the formula copy service
 */
export interface FormulaCopyConfig {
  toastDuration?: number;
  maxTraversalDepth?: number;
  format?: FormulaCopyFormat;
  /** Test/embedding override; production defaults to Gemini host detection. */
  observeGeminiArrows?: boolean;
}

/**
 * Service class for handling formula copy functionality
 * Implements Singleton pattern for single instance management
 */
export class FormulaCopyService {
  private static instance: FormulaCopyService | null = null;
  private static readonly ACTIVE_ROOT_CLASS = 'gv-formula-copy-enabled';
  /**
   * Which service instance set the root class. After an extension update the
   * retiring content script and its successor each have their own singleton,
   * and the page DOM is all they share.
   */
  private static readonly ROOT_OWNER_ATTRIBUTE = 'data-gv-formula-copy-owner';
  private readonly rootOwnerToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private readonly logger: ILogger;
  private readonly config: Required<Omit<FormulaCopyConfig, 'format'>>;
  private readonly interaction: FormulaInteraction;
  private currentFormat: FormulaCopyFormat = 'latex';

  // Storage change listener, extracted so it can be removed on destroy
  private readonly handleStorageChange: Parameters<
    typeof browser.storage.onChanged.addListener
  >[0] = (changes, areaName) => {
    if (areaName === 'sync' && changes[StorageKeys.FORMULA_COPY_FORMAT]) {
      const newFormat = changes[StorageKeys.FORMULA_COPY_FORMAT].newValue as FormulaCopyFormat;
      if (
        newFormat === 'latex' ||
        newFormat === 'unicodemath' ||
        newFormat === 'no-dollar' ||
        newFormat === 'notion'
      ) {
        this.formatPreferenceChangeVersion += 1;
        this.currentFormat = newFormat;
        this.logger.debug('Formula format changed', { format: newFormat });
      }
    }
  };

  private isInitialized = false;
  private isFormatChangeListenerAttached = false;
  private formatPreferenceLoadGeneration = 0;
  private formatPreferenceChangeVersion = 0;
  private lifecycleGeneration = 0;
  private readonly toaster = createToaster();
  private activeRootObserver: MutationObserver | null = null;

  private constructor(config: FormulaCopyConfig = {}) {
    this.logger = logger.createChild('FormulaCopy');
    this.config = {
      toastDuration: config.toastDuration ?? 2000,
      maxTraversalDepth: config.maxTraversalDepth ?? 10,
      observeGeminiArrows:
        config.observeGeminiArrows ?? packagedSiteForUrl(window.location.href) === 'gemini',
    };
    this.interaction = new FormulaInteraction(this.config.observeGeminiArrows);
    this.currentFormat = config.format ?? 'latex';
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: FormulaCopyConfig): FormulaCopyService {
    if (!FormulaCopyService.instance) {
      FormulaCopyService.instance = new FormulaCopyService(config);
    }
    return FormulaCopyService.instance;
  }

  /**
   * Resolve a toast message in the user's selected in-extension language.
   *
   * Uses the custom translation layer (getTranslationSyncUnsafe), NOT
   * browser.i18n.getMessage — the latter follows the BROWSER UI locale, so an
   * English-browser user who picked Chinese in the popup would see an English
   * toast while the rest of Voyager's UI is Chinese. Resolving here (at toast
   * time) also guarantees initI18n() has populated the cached language by the
   * time the user actually clicks a formula.
   */
  private toastMessage(key: 'formula_copied' | 'formula_copy_failed'): string {
    return getTranslationSyncUnsafe(key);
  }

  /**
   * Load format preference from storage
   */
  private async loadFormatPreference(
    loadGeneration: number,
    changeVersionAtStart: number,
  ): Promise<void> {
    try {
      const result = await browser.storage.sync.get(StorageKeys.FORMULA_COPY_FORMAT);
      if (
        loadGeneration !== this.formatPreferenceLoadGeneration ||
        changeVersionAtStart !== this.formatPreferenceChangeVersion
      )
        return;

      const format = result[StorageKeys.FORMULA_COPY_FORMAT] as FormulaCopyFormat | undefined;
      if (
        format === 'latex' ||
        format === 'unicodemath' ||
        format === 'no-dollar' ||
        format === 'notion'
      ) {
        this.currentFormat = format;
        this.logger.debug('Loaded formula format preference', { format });
      }
    } catch (error) {
      if (loadGeneration === this.formatPreferenceLoadGeneration) {
        this.logger.warn('Failed to load format preference, using default', { error });
      }
    }
  }

  private startFormatPreferenceSync(): Promise<void> {
    const loadGeneration = ++this.formatPreferenceLoadGeneration;
    if (!this.isFormatChangeListenerAttached) {
      try {
        browser.storage.onChanged.addListener(this.handleStorageChange);
        this.isFormatChangeListenerAttached = true;
      } catch (error) {
        this.logger.warn('Failed to listen for formula format changes', { error });
      }
    }

    return this.loadFormatPreference(loadGeneration, this.formatPreferenceChangeVersion);
  }

  private stopFormatPreferenceSync(): void {
    this.formatPreferenceLoadGeneration += 1;
    if (!this.isFormatChangeListenerAttached) return;

    try {
      browser.storage.onChanged.removeListener(this.handleStorageChange);
    } catch (error) {
      this.logger.warn('Failed to remove storage change listener', { error });
    } finally {
      this.isFormatChangeListenerAttached = false;
    }
  }

  /**
   * Resolve the current format before click handling becomes active. The
   * storage listener stays attached while the interaction feature is toggled
   * off, so an off -> on transition cannot briefly copy with a stale format.
   */
  public prepare(): Promise<void> {
    return this.startFormatPreferenceSync();
  }

  /**
   * Initialize the formula copy feature
   */
  public initialize(): void {
    if (this.isInitialized) {
      this.logger.warn('Service already initialized');
      return;
    }

    // Production entry points await prepare(); keep direct callers and older
    // integrations compatible while still subscribing synchronously here.
    if (!this.isFormatChangeListenerAttached) void this.prepare();

    this.interaction.start();
    document.addEventListener('click', this.handleClick, true);
    document.addEventListener('mouseover', this.handleMouseOver, true);
    this.isInitialized = true;
    this.lifecycleGeneration += 1;
    document.documentElement.setAttribute(
      FormulaCopyService.ROOT_OWNER_ATTRIBUTE,
      this.rootOwnerToken,
    );
    document.documentElement.classList.add(FormulaCopyService.ACTIVE_ROOT_CLASS);
    this.startActiveRootObserver();
    this.logger.info('Formula copy service initialized');
  }

  /**
   * Clean up the service (for extension unloading)
   */
  public destroy(): void {
    // Never initialized: the root class, if present, belongs to someone else
    // (a successor content script whose late predecessor is cleaning up).
    if (!this.isInitialized) return;

    // Decided before releaseRootClass() drops the owner mark it reads.
    const ownsPage = this.ownsRootClass();
    this.stopActiveRootObserver();
    this.releaseRootClass();
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('mouseover', this.handleMouseOver, true);
    // A successor that took the page over owns the shared arrow markers now.
    this.interaction.stop({ clearMarkers: ownsPage });
    this.toaster.clear();
    this.isInitialized = false;
    this.lifecycleGeneration += 1;
    this.logger.info('Formula copy service destroyed');
  }

  /** Fully release long-lived preference synchronization on page teardown. */
  public dispose(): void {
    this.destroy();
    this.stopFormatPreferenceSync();
  }

  /**
   * Handle click events using event delegation
   */
  private handleClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const mathElement = findMathElement(target);

    if (!mathElement) {
      return;
    }

    // Try to extract LaTeX: first from data-math (Gemini), then from annotation (AI Studio)
    const latexSource = extractLatexSource(mathElement);
    if (!latexSource) {
      this.logger.warn('Math element found but no LaTeX source available');
      return;
    }

    const isPresentationalArrow = this.interaction.mark(mathElement, latexSource);
    if (isPresentationalArrow) {
      this.logger.debug('Ignoring presentational inline arrow rendered as Gemini math', {
        latexSource,
      });
      return;
    }

    // Wrap formula with delimiters based on display type
    const isDisplayMode = isFormulaDisplayMode(mathElement);
    const { text, html } = formatFormula(
      latexSource,
      isDisplayMode,
      this.currentFormat,
      this.logger,
    );

    void this.copyFormula(text, html, this.lifecycleGeneration);
    event.stopPropagation();
  };

  /**
   * Mouseover fallback for host DOM that is assembled in an unusual order after
   * the initial scan/observer pass.
   */
  private handleMouseOver = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const mathElement = findMathElement(target);
    if (!mathElement) return;
    const latexSource = extractLatexSource(mathElement);
    if (!latexSource) return;

    this.interaction.mark(mathElement, latexSource);
  };

  /** False once a later instance has marked the page as its own. */
  private ownsRootClass(): boolean {
    const owner = document.documentElement.getAttribute(FormulaCopyService.ROOT_OWNER_ATTRIBUTE);
    return owner === null || owner === this.rootOwnerToken;
  }

  /** Remove the root class unless a later instance has taken it over. */
  private releaseRootClass(): void {
    if (!this.ownsRootClass()) return;
    const root = document.documentElement;
    root.removeAttribute(FormulaCopyService.ROOT_OWNER_ATTRIBUTE);
    root.classList.remove(FormulaCopyService.ACTIVE_ROOT_CLASS);
  }

  private startActiveRootObserver(): void {
    if (this.activeRootObserver) return;
    this.activeRootObserver = new MutationObserver(() => {
      if (
        this.isInitialized &&
        !document.documentElement.classList.contains(FormulaCopyService.ACTIVE_ROOT_CLASS)
      ) {
        document.documentElement.classList.add(FormulaCopyService.ACTIVE_ROOT_CLASS);
      }
    });
    this.activeRootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  private stopActiveRootObserver(): void {
    this.activeRootObserver?.disconnect();
    this.activeRootObserver = null;
  }

  /**
   * Copy formula to clipboard and show notification
   */
  private async copyFormula(
    text: string,
    html: string | undefined,
    lifecycleGeneration: number,
  ): Promise<void> {
    try {
      const success = await copyFormulaToClipboard(text, html, this.logger);
      if (!this.isInitialized || lifecycleGeneration !== this.lifecycleGeneration) return;

      if (success) {
        this.showToast(this.toastMessage('formula_copied'), true);
        this.logger.debug('Formula copied successfully', { length: text.length, hasHtml: !!html });
      } else {
        this.showToast(this.toastMessage('formula_copy_failed'), false);
        this.logger.error('Failed to copy formula');
      }
    } catch (error) {
      if (!this.isInitialized || lifecycleGeneration !== this.lifecycleGeneration) return;
      this.showToast(this.toastMessage('formula_copy_failed'), false);
      this.logger.error('Error copying formula', { error });
    }
  }

  /** One channel: a quick second copy replaces the first note instead of stacking. */
  private showToast(message: string, isSuccess: boolean): void {
    this.toaster.show({
      message,
      tone: isSuccess ? 'success' : 'error',
      channel: 'formula-copy',
      durationMs: this.config.toastDuration,
    });
  }

  /**
   * Check if service is initialized
   */
  public isServiceInitialized(): boolean {
    return this.isInitialized;
  }
}

// Export singleton instance getter
export const getFormulaCopyService = (config?: FormulaCopyConfig) =>
  FormulaCopyService.getInstance(config);
