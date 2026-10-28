import type { Dispose, PluginScope } from '@/features/plugins/runtime/pluginScope';

export type SidebarListener = (sidebar: HTMLElement | null) => void;

/** Which sidebar to follow, and the attribute changes inside it that matter. */
export interface WatchedSidebar {
  find(doc: Document): HTMLElement | null;
  /**
   * Rows appear (pagination), are renamed in place (text or `href` changes), and
   * the whole sidebar can be remounted; besides those, only these attributes.
   */
  readonly attributes: readonly string[];
}

/**
 * Follows a site's sidebar and calls its listeners at most once per frame after
 * it changes. The page-wide observer only checks whether the sidebar it holds is
 * still connected, so streaming replies cost one property read per batch.
 */
export class SidebarWatcher {
  private sidebar: HTMLElement | null = null;
  private stopSidebar: Dispose | null = null;
  private pending = false;
  private readonly listeners: SidebarListener[] = [];
  private readonly options: MutationObserverInit;

  /** `label` names the plugin's effects, e.g. `chatgpt-folders`. */
  constructor(
    private readonly scope: PluginScope,
    private readonly watched: WatchedSidebar,
    private readonly label: string,
    private readonly doc: Document = document,
  ) {
    this.options = {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...watched.attributes],
    };
  }

  /** Listeners run in registration order on every pass. */
  onChange(listener: SidebarListener): void {
    this.listeners.push(listener);
  }

  start(): void {
    this.scope.observe(this.doc.body, { childList: true, subtree: true }, () => {
      if (!this.sidebar?.isConnected) this.schedule();
    });
    this.scope.effect(
      () => () => {
        this.sidebar = null;
        this.stopSidebar = null;
      },
      `${this.label}:sidebar-watcher`,
    );
    this.run();
  }

  /** Runs every listener on the next frame; repeated calls coalesce. */
  schedule(): void {
    if (this.pending || this.scope.isDisposed) return;
    this.pending = true;
    this.scope.frame(() => {
      this.pending = false;
      this.run();
    });
  }

  private run(): void {
    // A queued frame can fire while the scope's asynchronous teardown is still draining.
    if (this.scope.isDisposed) return;
    const sidebar = this.watched.find(this.doc);
    if (sidebar !== this.sidebar) {
      void this.stopSidebar?.();
      this.sidebar = sidebar;
      this.stopSidebar = sidebar
        ? this.scope.observe(sidebar, this.options, () => this.schedule())
        : null;
    }
    for (const listener of this.listeners) listener(sidebar);
  }
}
