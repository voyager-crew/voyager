import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';

import { nativeHealthReporter } from '../nativeHealth';
import type { NativeConversationMenus } from './NativeConversationMenus';
import type { NativeSidebarObserver } from './NativeSidebarObserver';
import { NotebooksAnchorToggle } from './notebooksAnchorToggle';
import {
  type FolderAnchor,
  type GeminiSidebarMount,
  findSidebar,
  findSidebarMount,
  findSidebarNotebooks,
  findSidebarVisibilityHost,
  isSidebarOpen,
  removeStrayFolderPanels,
} from './sidebarMountDom';
import { SidebarRecoveryWatchers } from './sidebarRecoveryWatchers';

export type { FolderAnchor } from './sidebarMountDom';
export type FolderMountMode = 'sidebar' | 'floating';

export interface FolderSidebarRuntimeOptions {
  createPanel: () => HTMLElement;
  onPanelMount: (panel: HTMLElement, sidebar: HTMLElement) => void;
  onPanelUnmount: (reason: 'remount' | 'stop') => void;
  nativeSidebar: NativeSidebarObserver;
  nativeMenus: NativeConversationMenus;
  floating: {
    isOpen: () => boolean;
    open: (openPanel: boolean) => Promise<void>;
    close: () => void;
  };
}

const SIDEBAR_WAIT_TIMEOUT_MS = 10_000;
const SIDEBAR_WAIT_POLL_MS = 500;
const ANCHOR_MISSING_GRACE_MS = 6000;
const HIDDEN_PANEL_GRACE_MS = 1500;

/** Owns the folder panel's place in Gemini, including temporary floating fallback episodes. */
export class FolderSidebarRuntime {
  private sidebarElement: HTMLElement | null = null;
  private panelElement: HTMLElement | null = null;
  private anchorPreference: FolderAnchor = 'above-recents';
  private running = false;
  private mode: FolderMountMode = 'sidebar';
  private generation = 0;
  private mountPromise: Promise<void> | null = null;
  private remounting = false;
  private sidebarWaits = new Set<() => void>();
  private positionObserver: MutationObserver | null = null;
  private positionRaf: number | null = null;
  private visibilityObserver: MutationObserver | null = null;
  private readonly anchorToggle = new NotebooksAnchorToggle({
    getPreference: () => this.anchorPreference,
    onToggle: () => {
      this.setAnchor(
        this.anchorPreference === 'above-notebooks' ? 'above-recents' : 'above-notebooks',
      );
      void browser.storage.local
        .set({ [StorageKeys.FOLDERS_ANCHOR]: this.anchorPreference })
        .catch((error) =>
          console.error('[FolderManager] Failed to persist folder anchor preference:', error),
        );
    },
  });
  private readonly recoveryWatchers = new SidebarRecoveryWatchers({
    onLayoutSettled: () => {
      if (!this.running || this.mode !== 'sidebar') return;
      if (!this.isMountedInCurrentSidebar() && isSidebarOpen()) void this.remount();
    },
    onPoll: () => void this.recover(),
  });
  private recoveryInFlight = false;
  private anchorMissingSince: number | null = null;
  private hiddenPanelSince: number | null = null;
  private fallbackActive = false;
  private floatingOpenPromise: Promise<void> | null = null;
  private floatingOpenPanel: boolean | null = null;

  constructor(private readonly options: FolderSidebarRuntimeOptions) {}

  get sidebar(): HTMLElement | null {
    return this.sidebarElement;
  }

  get panel(): HTMLElement | null {
    return this.panelElement;
  }

  get isFloatingMode(): boolean {
    return this.running && this.mode === 'floating';
  }

  get isFallbackActive(): boolean {
    return this.fallbackActive;
  }

  async loadAnchor(): Promise<void> {
    try {
      const raw = await browser.storage.local.get({
        [StorageKeys.FOLDERS_ANCHOR]: 'above-recents',
      });
      this.setAnchor(raw[StorageKeys.FOLDERS_ANCHOR]);
    } catch (error) {
      console.error('[FolderManager] Failed to load folder anchor preference:', error);
      this.setAnchor('above-recents');
    }
  }

  setAnchor(value: unknown): void {
    this.anchorPreference = value === 'above-notebooks' ? value : 'above-recents';
    this.refreshLanguage();
    this.enforcePosition();
  }

  async start(mode: FolderMountMode, openOnStart = true): Promise<void> {
    const wasRunning = this.running;
    const previousMode = this.mode;
    this.running = true;
    this.mode = mode;

    if (mode === 'floating') {
      if (wasRunning && previousMode === mode) return;
      nativeHealthReporter.withdraw('folders');
      this.invalidateMount();
      this.fallbackActive = false;
      this.anchorMissingSince = null;
      this.unmountPanel('remount');
      this.startNativeMenus();
      const generation = this.generation;
      void this.waitForSidebar().then((sidebar) => {
        if (!sidebar || !this.isCurrent(generation) || this.mode !== 'floating') return;
        this.bindNativeSidebar(sidebar);
      });
      if (!openOnStart && this.options.floating.isOpen()) this.options.floating.close();
      await this.openFloating(openOnStart);
      return;
    }

    if (wasRunning && previousMode === 'floating') {
      this.invalidateMount();
      this.fallbackActive = false;
      this.options.floating.close();
    }
    this.recoveryWatchers.ensure();
    if (this.isMountedInCurrentSidebar()) {
      this.updateVisibility();
      return;
    }
    await this.mountPanel(wasRunning);
  }

  /** Rebind transient DOM resources while keeping native deletion tracking and recovery alive. */
  remount(): Promise<void> {
    return this.mountPanel(true);
  }

  private mountPanel(remounting: boolean): Promise<void> {
    if (!this.running || this.mode !== 'sidebar') return Promise.resolve();
    if (this.mountPromise) return this.mountPromise;
    const generation = this.generation;
    this.remounting = remounting;
    this.unmountPanel('remount');
    this.recoveryWatchers.ensure();
    this.startNativeMenus();

    const operation = this.waitForSidebar()
      .then((sidebar) => {
        if (!sidebar || !this.isCurrent(generation) || this.mode !== 'sidebar') return;
        const mount = findSidebarMount(this.anchorPreference);
        if (!mount) return;
        const { sidebar: mountSidebar, anchor } = mount;
        const parent = anchor.parentElement;
        if (!parent) return;
        this.sidebarElement = mountSidebar;

        removeStrayFolderPanels(parent);
        const panel = this.options.createPanel();
        this.panelElement = panel;
        parent.insertBefore(panel, anchor);
        this.options.onPanelMount(panel, mountSidebar);
        this.bindNativeSidebar(mountSidebar);
        this.observePosition();
        this.ensureNotebooksButton();
        this.observeVisibility();
        this.updateVisibility();
      })
      .catch((error) => {
        console.error('[FolderManager] Failed to initialize folder sidebar:', error);
      })
      .finally(() => {
        if (this.mountPromise === operation) {
          this.mountPromise = null;
          this.remounting = false;
        }
      });
    this.mountPromise = operation;
    return operation;
  }

  /** Disable/destroy ends every mounted-runtime timer, observer and pending sidebar wait. */
  stop(): void {
    this.running = false;
    nativeHealthReporter.withdraw('folders');
    this.floatingOpenPanel = null;
    this.invalidateMount();
    this.recoveryWatchers.teardown();
    this.unmountPanel('stop');
    this.options.nativeSidebar.stop();
    this.options.nativeMenus.stop();
    this.fallbackActive = false;
    this.anchorMissingSince = null;
    this.hiddenPanelSince = null;
    this.recoveryInFlight = false;
    this.options.floating.close();
  }

  private isCurrent(generation: number): boolean {
    return this.running && this.generation === generation;
  }

  private invalidateMount(): void {
    this.generation += 1;
    this.sidebarWaits.forEach((cancel) => cancel());
    this.sidebarWaits.clear();
    this.mountPromise = null;
    this.remounting = false;
  }

  private startNativeMenus(): void {
    this.options.nativeMenus.startTracking();
    this.options.nativeMenus.observePanels();
  }

  private bindNativeSidebar(sidebar: HTMLElement): void {
    this.sidebarElement = sidebar;
    this.options.nativeSidebar.enqueueConversations(sidebar.isConnected ? sidebar : document);
    this.options.nativeSidebar.observe(sidebar);
  }

  private unmountPanel(reason: 'remount' | 'stop'): void {
    this.options.onPanelUnmount(reason);
    this.options.nativeSidebar.disconnect();
    this.options.nativeMenus.disconnectPanels();
    this.positionObserver?.disconnect();
    this.positionObserver = null;
    if (this.positionRaf !== null) window.cancelAnimationFrame(this.positionRaf);
    this.positionRaf = null;
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = null;
    this.anchorToggle.cleanup();
    this.panelElement?.remove();
    this.panelElement = null;
    this.sidebarElement = null;
  }

  private waitForSidebar(): Promise<HTMLElement | null> {
    try {
      if (localStorage.getItem('gv-force-folder-fail') === '1') return Promise.resolve(null);
    } catch {
      // Debug flag is optional when localStorage is unavailable.
    }
    return new Promise((resolve) => {
      const deadline = Date.now() + SIDEBAR_WAIT_TIMEOUT_MS;
      let timer: number | null = null;
      const finish = (sidebar: HTMLElement | null) => {
        if (timer !== null) window.clearTimeout(timer);
        this.sidebarWaits.delete(cancel);
        resolve(sidebar);
      };
      const cancel = () => finish(null);
      const check = () => {
        const sidebar = findSidebar();
        if (sidebar || Date.now() >= deadline || !this.running) {
          finish(sidebar);
        } else {
          timer = window.setTimeout(check, SIDEBAR_WAIT_POLL_MS);
        }
      };
      this.sidebarWaits.add(cancel);
      check();
    });
  }

  private isMountedInCurrentSidebar(
    mount: GeminiSidebarMount | null = findSidebarMount(this.anchorPreference),
  ): boolean {
    return !!(
      this.panelElement &&
      document.body.contains(this.panelElement) &&
      mount &&
      document.body.contains(mount.sidebar) &&
      mount.sidebar.contains(this.panelElement)
    );
  }

  private enforcePosition(): void {
    if (!this.running || this.mode !== 'sidebar' || !this.panelElement?.isConnected) return;
    const mount = findSidebarMount(this.anchorPreference);
    const anchor = mount?.sidebar === this.sidebarElement ? mount.anchor : null;
    const parent = anchor?.parentElement;
    if (!anchor || !parent) return;
    this.ensureNotebooksButton(mount);
    if (
      this.panelElement.parentElement !== parent ||
      this.panelElement.nextElementSibling !== anchor
    ) {
      parent.insertBefore(this.panelElement, anchor);
    }
  }

  private observePosition(): void {
    this.positionObserver?.disconnect();
    const mount = findSidebarMount(this.anchorPreference);
    const target =
      mount?.sidebar === this.sidebarElement ? (mount.anchor.parentElement ?? mount.sidebar) : null;
    if (!target) return;
    this.positionObserver = new MutationObserver(() => {
      if (this.positionRaf !== null) return;
      this.positionRaf = window.requestAnimationFrame(() => {
        this.positionRaf = null;
        this.enforcePosition();
      });
    });
    this.positionObserver.observe(target, { childList: true });
  }

  private isPanelUsable(): boolean {
    const panel = this.panelElement;
    if (!panel?.isConnected) return false;
    if (!isSidebarOpen() || panel.classList.contains('gv-sidebar-section-hidden')) return true;
    return panel.offsetParent !== null && panel.getBoundingClientRect().height > 0;
  }

  private observeVisibility(): void {
    this.visibilityObserver?.disconnect();
    const host = findSidebarVisibilityHost();
    if (!host) return;
    this.visibilityObserver = new MutationObserver(() => this.updateVisibility());
    this.visibilityObserver.observe(host, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  private updateVisibility(): void {
    if (!this.running || this.mode !== 'sidebar') return;
    if (!this.isMountedInCurrentSidebar()) {
      if (isSidebarOpen()) void this.remount();
      return;
    }
    if (this.panelElement) this.panelElement.style.display = isSidebarOpen() ? '' : 'none';
  }

  private async recover(): Promise<void> {
    if (!this.running || this.mode !== 'sidebar' || this.remounting || this.recoveryInFlight)
      return;
    const mount = findSidebarMount(this.anchorPreference);
    const sidebar = mount?.sidebar ?? null;
    const anchor = mount?.anchor ?? null;
    if (this.isMountedInCurrentSidebar(mount)) {
      this.anchorMissingSince = null;
      nativeHealthReporter.reportFound('folders');
      if (sidebar && this.sidebarElement !== sidebar) {
        this.bindNativeSidebar(sidebar);
        this.observePosition();
      }
      if (!this.isPanelUsable()) {
        const now = Date.now();
        this.hiddenPanelSince ??= now;
        if (now - this.hiddenPanelSince < HIDDEN_PANEL_GRACE_MS) return;
        this.hiddenPanelSince = null;
        this.panelElement?.style.removeProperty('display');
        this.updateVisibility();
        if (this.isPanelUsable()) return;
        await this.openFallback();
        return;
      }
      this.hiddenPanelSince = null;
      this.retireFallback();
      this.enforcePosition();
      return;
    }
    this.hiddenPanelSince = null;
    if (anchor) {
      this.anchorMissingSince = null;
      nativeHealthReporter.reportFound('folders');
      this.retireFallback();
      void this.remount();
      return;
    }
    const now = Date.now();
    // Gemini can remove the whole sidebar while rebuilding it; absence needs the same grace.
    this.anchorMissingSince ??= now;
    if (now - this.anchorMissingSince < ANCHOR_MISSING_GRACE_MS) return;
    this.reportMissingAnchor();
    await this.openFallback();
  }

  /**
   * Folders still work from the floating fallback, so a lost sidebar anchor is `degraded`. It
   * counts only while the user keeps the sidebar open in sidebar mode; a collapsed sidebar or an
   * explicit floating choice is not breakage.
   */
  private reportMissingAnchor(): void {
    nativeHealthReporter.reportMissing('folders', {
      route: 'any',
      status: 'degraded',
      recheck: () => findSidebarMount(this.anchorPreference) !== null,
      expected: () => this.running && this.mode === 'sidebar' && isSidebarOpen(),
    });
  }

  private async openFallback(): Promise<void> {
    if (this.fallbackActive || this.options.floating.isOpen()) return;
    this.fallbackActive = true;
    this.recoveryInFlight = true;
    try {
      await this.openFloating(true);
    } catch (error) {
      this.fallbackActive = false;
      console.error('[FolderManager] Failed to mount floating folder fallback:', error);
    } finally {
      this.recoveryInFlight = false;
    }
  }

  private openFloating(openPanel: boolean): Promise<void> {
    const previous = this.floatingOpenPromise;
    if (previous && this.floatingOpenPanel === openPanel) return previous;
    let operation: Promise<void>;
    const openAfterPrevious = () => {
      if (
        this.floatingOpenPromise !== operation ||
        this.floatingOpenPanel !== openPanel ||
        !this.running ||
        (this.mode === 'sidebar' && !this.fallbackActive)
      )
        return;
      // Retire the old request before opening its replacement, so a late
      // completion cannot close or overwrite the newly requested view.
      this.options.floating.close();
      return this.options.floating.open(openPanel);
    };
    operation = (
      previous
        ? previous.catch(() => {}).then(openAfterPrevious)
        : this.options.floating.open(openPanel)
    ).finally(() => {
      if (this.floatingOpenPromise === operation) {
        this.floatingOpenPromise = null;
        this.floatingOpenPanel = null;
      }
      if (!this.running || (this.mode === 'sidebar' && !this.fallbackActive)) {
        this.options.floating.close();
      }
    });
    this.floatingOpenPromise = operation;
    this.floatingOpenPanel = openPanel;
    return operation;
  }

  private retireFallback(): void {
    if (!this.fallbackActive) return;
    this.fallbackActive = false;
    this.anchorMissingSince = null;
    this.options.floating.close();
  }

  private ensureNotebooksButton(mount = findSidebarMount(this.anchorPreference)): void {
    if (!this.running || this.mode !== 'sidebar') {
      this.anchorToggle.cleanup();
      return;
    }
    const notebooks = mount ? findSidebarNotebooks(mount.view) : null;
    this.anchorToggle.ensure(
      notebooks?.sidebar === this.sidebarElement ? notebooks.notebooks : null,
    );
  }

  refreshLanguage(): void {
    this.anchorToggle.refreshLanguage();
  }
}
