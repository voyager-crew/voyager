/**
 * Incremental collapse state, measurement and teardown shared by code blocks
 * and generic plugin targets. Callers supply eligibility and toggle presentation.
 */
import { addClass, removeClasses } from './classes';

const SCAN_DEBOUNCE_MS = 120;

export interface CollapseSite {
  /** Element observed for new and changing blocks. */
  root(): HTMLElement;
  /** One host element carrying the collapsed state. */
  readonly hostSelector: string;
  /** One accepted locator view for an entire scan or observer flush. */
  resolveHosts?(ownerRoot: ParentNode): CollapseReadSession;
  /** Whether a matched block is one this site collapses (scope, diagrams, …). */
  accepts(host: HTMLElement): boolean;
  /**
   * Attributes whose change on a block, or inside it, can flip `accepts`. The
   * engine rescans that block when one changes; other attribute changes are
   * not watched.
   */
  readonly acceptsAttributes?: readonly string[];
  /** The content measured for length. */
  content(host: HTMLElement): HTMLElement | null;
  /** Whether the measured content exceeds this caller's collapse threshold. */
  isLong(content: HTMLElement): boolean;
  /** Where the toggle goes; null leaves the host alone. */
  actions(host: HTMLElement): HTMLElement | null;
  /** The element to mark with the clip class, when the site's CSS clips by class. */
  clip?(host: HTMLElement, content: HTMLElement): HTMLElement | null;
  /** Collapse a block when it first turns long, until the user expands it. */
  readonly collapseByDefault?: boolean;
  /** Runs after a pass or a toggle may have changed which blocks are collapsible or collapsed. */
  onChange?(): void;
  /**
   * Take `host` before the first change to it; false when another engine holds
   * it. A site with this hook leaves a block it does not hold entirely alone,
   * and `release` frees a block it stops managing so another engine can take it.
   */
  claim?(host: HTMLElement): boolean;
  release?(host: HTMLElement): void;
}

export interface CollapseReadSession {
  readonly hosts: readonly HTMLElement[];
  closest(element: Element): HTMLElement | null;
  matches(element: Element): boolean;
  accepts(host: HTMLElement): boolean;
  content(host: HTMLElement): HTMLElement | null;
  actions(host: HTMLElement): HTMLElement | null;
  clip?(host: HTMLElement, content: HTMLElement): HTMLElement | null;
}

export interface CollapseEngine {
  start(): void;
  enhance(host: HTMLElement): void;
  process(root?: ParentNode): void;
  /** Collapsible blocks, in no particular order. */
  blocks(): HTMLElement[];
  /** Collapses or expands every collapsible block, and every block that turns long later. */
  setAllCollapsed(collapsed: boolean): void;
  /** Re-reads the toggle labels after the Voyager language changes. */
  relabel(): void;
  stop(): void;
}

export interface CollapsePresentation {
  readonly collapsibleClass: string;
  readonly collapsedClass: string;
  readonly clipClass: string;
  createToggle(doc: Document, onToggle: () => void): HTMLButtonElement;
  updateToggle(host: HTMLElement, button: HTMLButtonElement): void;
}

interface ManagedBlock {
  button: HTMLButtonElement | null;
  clip: HTMLElement | null;
}

interface Measurement {
  host: HTMLElement;
  content: HTMLElement | null;
  actions: HTMLElement | null;
  clip: HTMLElement | null;
  shouldEnhance: boolean;
}

export function createCollapseEngine(
  site: CollapseSite,
  presentation: CollapsePresentation,
): CollapseEngine {
  const managed = new Map<HTMLElement, ManagedBlock>();
  // The user's choice outlives the block's eligibility, so a block that turns
  // short and long again (threshold, re-render) comes back as they left it.
  const decisions = new WeakMap<HTMLElement, boolean>();
  const observed = new Set<HTMLElement>();
  const pending = new Set<HTMLElement>();
  const pendingMutations: MutationRecord[] = [];
  let defaultCollapsed = site.collapseByDefault ?? false;
  let observer: MutationObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let scanTimer: number | null = null;
  let generation = 0;

  const setCollapsed = (host: HTMLElement, collapsed: boolean): void => {
    decisions.set(host, collapsed);
    if (collapsed) addClass(host, presentation.collapsedClass);
    else removeClasses(host, presentation.collapsedClass);
    const button = managed.get(host)?.button;
    if (button) presentation.updateToggle(host, button);
  };

  const removeEnhancement = (host: HTMLElement): void => {
    const block = managed.get(host);
    block?.button?.remove();
    if (block?.clip) removeClasses(block.clip, presentation.clipClass);
    managed.delete(host);
    removeClasses(host, presentation.collapsibleClass, presentation.collapsedClass);
    site.release?.(host);
  };

  const observeBlock = (host: HTMLElement): void => {
    if (!resizeObserver || observed.has(host)) return;
    resizeObserver.observe(host);
    observed.add(host);
  };

  const readSession = (ownerRoot: ParentNode): CollapseReadSession =>
    site.resolveHosts?.(ownerRoot) ?? {
      // Bundled mutation/resize reads only need local matches, not a full-page scan.
      get hosts() {
        return Array.from(ownerRoot.querySelectorAll<HTMLElement>(site.hostSelector));
      },
      closest: (element) => element.closest<HTMLElement>(site.hostSelector),
      matches: (element) => element.matches(site.hostSelector),
      accepts: (host) => site.accepts(host),
      content: (host) => site.content(host),
      actions: (host) => site.actions(host),
      clip: site.clip ? (host, content) => site.clip!(host, content) : undefined,
    };

  const measure = (host: HTMLElement, read: CollapseReadSession): Measurement => {
    observeBlock(host);
    const content = read.content(host);
    const actions = content ? read.actions(host) : null;
    return {
      host,
      content,
      actions,
      clip: site.resolveHosts && content ? (read.clip?.(host, content) ?? null) : null,
      shouldEnhance: Boolean(content && actions && read.accepts(host) && site.isLong(content)),
    };
  };

  const apply = ({
    host,
    content,
    actions,
    clip: measuredClip,
    shouldEnhance,
  }: Measurement): void => {
    if (!shouldEnhance || !actions || !content) {
      // With ownership, the shared classes on a block this engine never took are another engine's.
      if (!site.claim || managed.has(host)) removeEnhancement(host);
      return;
    }

    let block = managed.get(host);
    if (!block) {
      if (site.claim && !site.claim(host)) return;
      block = { button: null, clip: null };
      managed.set(host, block);
      if (decisions.get(host) ?? defaultCollapsed) addClass(host, presentation.collapsedClass);
    }
    addClass(host, presentation.collapsibleClass);

    let button = block.button;
    if (!button || !button.isConnected || button.parentElement !== actions) {
      button?.remove();
      button = presentation.createToggle(host.ownerDocument, () => {
        setCollapsed(host, !host.classList.contains(presentation.collapsedClass));
        site.onChange?.();
      });
      actions.appendChild(button);
      block.button = button;
    }

    const clip = site.resolveHosts ? measuredClip : (site.clip?.(host, content) ?? null);
    if (block.clip !== clip) {
      if (block.clip) removeClasses(block.clip, presentation.clipClass);
      if (clip) addClass(clip, presentation.clipClass);
      block.clip = clip;
    }

    presentation.updateToggle(host, button);
  };

  const cleanupDisconnectedBlocks = (): void => {
    // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot: the loop body mutates the collection
    for (const host of [...observed]) {
      if (host.isConnected) continue;
      resizeObserver?.unobserve(host);
      observed.delete(host);
    }
    for (const host of Array.from(managed.keys())) {
      if (!host.isConnected) removeEnhancement(host);
    }
  };

  const enhance = (host: HTMLElement): void => {
    const read = readSession(site.root());
    if (site.resolveHosts && !read.hosts.includes(host)) {
      if (managed.has(host)) removeEnhancement(host);
      return;
    }
    apply(measure(host, read));
  };

  const releaseRejectedHosts = (read: CollapseReadSession, ownerRoot: ParentNode): void => {
    if (!site.resolveHosts) return;
    for (const host of managed.keys()) {
      if (
        ownerRoot instanceof Node &&
        ownerRoot !== host &&
        ownerRoot.contains(host) &&
        !read.hosts.includes(host)
      )
        removeEnhancement(host);
    }
  };

  const process = (root: ParentNode = site.root()): void => {
    const read = readSession(root);
    read.hosts.forEach((host) => apply(measure(host, read)));
    releaseRejectedHosts(read, root);
    cleanupDisconnectedBlocks();
    site.onChange?.();
  };

  const flushPending = (): void => {
    const read = readSession(site.root());
    for (const record of pendingMutations.splice(0)) {
      collectContaining(record.target, read);
      record.addedNodes.forEach((node) => collectAdded(node, read));
    }
    const measurements = [...pending]
      .filter((host) => host.isConnected && (!site.resolveHosts || read.matches(host)))
      .map((host) => measure(host, read));
    pending.clear();

    // Finish every layout read before adding/removing buttons and classes. This
    // prevents one block's DOM write from forcing the next block's measurement.
    measurements.forEach(apply);
    releaseRejectedHosts(read, site.root());
    cleanupDisconnectedBlocks();
    site.onChange?.();
  };

  const schedulePendingFlush = (): void => {
    const currentGeneration = generation;
    if (scanTimer !== null) window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      if (currentGeneration !== generation) return;
      scanTimer = null;
      flushPending();
    }, SCAN_DEBOUNCE_MS);
  };

  const collectContaining = (node: Node, read: CollapseReadSession): void => {
    const element = node instanceof Element ? node : node.parentElement;
    const host = element ? read.closest(element) : null;
    if (host) pending.add(host);
  };

  const collectAdded = (node: Node, read: CollapseReadSession): void => {
    if (!(node instanceof Element)) return;
    if (read.matches(node)) pending.add(node as HTMLElement);
    if (site.resolveHosts)
      read.hosts.filter((host) => node.contains(host)).forEach((host) => pending.add(host));
    else node.querySelectorAll<HTMLElement>(site.hostSelector).forEach((host) => pending.add(host));
  };

  const onMutations = (records: MutationRecord[]): void => {
    // Resolve after the whole mutation burst, so a rejected tier never leaves queued hosts behind.
    if (site.resolveHosts) pendingMutations.push(...records);
    else {
      const read = readSession(site.root());
      for (const record of records) {
        collectContaining(record.target, read);
        record.addedNodes.forEach((node) => collectAdded(node, read));
      }
    }
    schedulePendingFlush();
  };

  const stop = (): void => {
    // Disconnect cannot retract an already queued observer callback from a previous lifetime.
    generation += 1;
    observer?.disconnect();
    observer = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (scanTimer !== null) {
      window.clearTimeout(scanTimer);
      scanTimer = null;
    }
    pending.clear();
    pendingMutations.length = 0;
    observed.clear();
    for (const host of Array.from(managed.keys())) removeEnhancement(host);
  };

  return {
    start() {
      stop();
      const currentGeneration = generation;
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver((entries) => {
          if (currentGeneration !== generation) return;
          for (const entry of entries) {
            if (
              entry.target instanceof HTMLElement &&
              (site.resolveHosts || entry.target.matches(site.hostSelector))
            ) {
              pending.add(entry.target);
            }
          }
          if (pending.size > 0) schedulePendingFlush();
        });
      }
      const root = site.root();
      process(root);
      observer = new MutationObserver((records) => {
        if (currentGeneration !== generation) return;
        onMutations(records);
      });
      const attributeFilter = site.acceptsAttributes ?? [];
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        ...(attributeFilter.length > 0
          ? { attributes: true, attributeFilter: [...attributeFilter] }
          : {}),
      });
    },
    enhance,
    process,
    blocks: () => Array.from(managed.keys()),
    setAllCollapsed(collapsed) {
      defaultCollapsed = collapsed;
      for (const host of managed.keys()) setCollapsed(host, collapsed);
      site.onChange?.();
    },
    relabel() {
      for (const [host, block] of managed)
        if (block.button) presentation.updateToggle(host, block.button);
    },
    stop,
  };
}
