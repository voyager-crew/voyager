import { gemsAnchorMayBeDisturbed, watchGemsAnchor } from './anchorGuard';
import { resolveGemHref, type GemMetadata } from './catalog';
import { findGemsSidebarLocation, type GemsSidebarLocation } from './location';
import {
  CHEVRON_SVG,
  createGemsSection,
  gemsSectionMayBeDisturbed,
  setGemsSectionExpanded,
} from './section';

const LIST_CLASS = 'gv-gems-inline-list';
const TOGGLE_CLASS = 'gv-gems-expand-toggle';
const HOST_CLASS = 'gv-gems-toggle-host';

/** Owns sidebar DOM and the anchor watch, placement RAF and mounting retry lifetime. */
export function createGemsSidebarView(
  getCount: () => number,
  getExpanded: () => boolean,
  visibleGems: () => GemMetadata[],
  toggleExpanded: () => Promise<void>,
) {
  let stopped = false;
  let stopAnchorWatch: (() => void) | null = null;
  let enforceRafId: number | null = null;
  let positionRetryTimer: number | null = null;
  let injectedList: HTMLElement | null = null;
  let injectedToggle: HTMLElement | null = null;
  let anchoredEntry: HTMLElement | null = null;
  // Without a native Gems entry the list lives in Voyager's own section after the top nav.
  let injectedSection: HTMLElement | null = null;
  let sectionNav: HTMLElement | null = null;

  /**
   * Build the inline list element. Returns `null` when there's nothing to show
   * (empty cache) — the caller treats null as "tear down any existing UI".
   */
  function buildGemsList(items: GemMetadata[]): HTMLElement | null {
    if (items.length === 0) return null;

    const list = document.createElement('div');
    list.className = LIST_CLASS;
    if (!getExpanded()) list.classList.add('gv-collapsed');
    // role=list keeps assistive tech happy since we're not using <ul>; nav
    // semantics already live on the parent mat-nav-list.
    list.setAttribute('role', 'list');

    items.forEach((gem) => list.appendChild(buildItem(gem)));
    return list;
  }

  /**
   * Build the chevron button that toggles the inline list open/closed. Lives
   * inside the native `gem-nav-list-item` (absolutely positioned at its right
   * edge) so it visually reads as part of Gemini's own entry. Click is
   * stopPropagation'd so it doesn't trigger the entry's navigation to
   * /gems/view — that's still triggered by clicking the entry's label.
   */
  function createExpandToggle(): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = TOGGLE_CLASS;
    btn.setAttribute('aria-expanded', getExpanded() ? 'true' : 'false');
    // Inline SVG (no font dependency). Path matches Material Symbols
    // `keyboard_arrow_right`; we rotate it to `down` when expanded via CSS.
    btn.innerHTML = CHEVRON_SVG;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      void toggleExpanded();
    });
    // Belt-and-suspenders — native gem-nav-list-item header is an `<a>`, and
    // pointerdown/mousedown can ripple through to it on some Angular versions.
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    if (getExpanded()) btn.classList.add('gv-expanded');
    return btn;
  }

  function refreshExpandedState(): void {
    if (injectedToggle) {
      injectedToggle.classList.toggle('gv-expanded', getExpanded());
      injectedToggle.setAttribute('aria-expanded', getExpanded() ? 'true' : 'false');
    }
    if (injectedList) {
      injectedList.classList.toggle('gv-collapsed', !getExpanded());
    }
    if (injectedSection) setGemsSectionExpanded(injectedSection, getExpanded());
  }

  /** Mount / re-mount the chevron on the current Gems nav entry. */
  function ensureExpandToggle(entry: HTMLElement): void {
    if (getCount() <= 0 || visibleGems().length === 0) {
      removeExpandToggle();
      return;
    }

    // Already attached to the *current* entry element? No-op.
    if (injectedToggle && injectedToggle.parentElement === entry) {
      refreshExpandedState();
      return;
    }

    // Either no toggle yet, or it's pinned to a stale (re-rendered) entry.
    if (injectedToggle && injectedToggle.isConnected) injectedToggle.remove();
    const btn = createExpandToggle();
    entry.classList.add(HOST_CLASS);
    entry.appendChild(btn);
    injectedToggle = btn;
  }

  function removeExpandToggle(): void {
    if (injectedToggle) {
      injectedToggle.remove();
      injectedToggle = null;
    }
    document.querySelectorAll(`.${HOST_CLASS}`).forEach((el) => el.classList.remove(HOST_CLASS));
  }

  function buildItem(gem: GemMetadata): HTMLElement {
    const item = document.createElement('a');
    item.className = 'gv-gems-item';
    item.setAttribute('role', 'listitem');
    item.href = resolveGemHref(gem.href);
    item.title = gem.description ? `${gem.name} — ${gem.description}` : gem.name;

    const icon = document.createElement('span');
    icon.className = 'gv-gems-item-icon';
    icon.textContent = (gem.iconLetter || gem.name.trim().charAt(0) || '?').toUpperCase();
    item.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'gv-gems-item-name';
    name.textContent = gem.name;
    item.appendChild(name);

    return item;
  }

  /** Insert / refresh / remove the list based on current state. */
  function renderSection(location: GemsSidebarLocation | null = findGemsSidebarLocation()): void {
    const gemsEntry = location?.entry ?? null;
    if (getCount() <= 0) {
      cleanupSection();
      return;
    }

    const nav = location?.nav ?? null;
    if (!gemsEntry?.parentElement && !nav) {
      // No anchor yet — try again on the next mutation.
      return;
    }

    const fresh = buildGemsList(visibleGems());
    if (!fresh) {
      cleanupSection();
      return;
    }

    // Also when detached: a section Gemini removed still holds the old list, and is reused.
    injectedList?.replaceWith(fresh);
    injectedList = fresh;
    if (gemsEntry?.parentElement) placeAfterEntry(gemsEntry, fresh);
    else if (nav) placeInSection(nav, fresh);
  }

  /** Legacy layout: the list reads as the native Gems entry's own expansion. */
  function placeAfterEntry(gemsEntry: HTMLElement, list: HTMLElement): void {
    if (gemsEntry.nextElementSibling !== list) gemsEntry.insertAdjacentElement('afterend', list);
    removeSectionShell();
    anchoredEntry = gemsEntry;
    ensureExpandToggle(gemsEntry);
  }

  /** Redesigned layout: Gems sit in the More popover, so Voyager adds its own section. */
  function placeInSection(nav: HTMLElement, list: HTMLElement): void {
    anchoredEntry = null;
    removeExpandToggle();
    injectedSection ??= createGemsSection(() => void toggleExpanded());
    if (list.parentElement !== injectedSection) injectedSection.appendChild(list);
    if (nav.nextElementSibling !== injectedSection) {
      nav.insertAdjacentElement('afterend', injectedSection);
    }
    sectionNav = nav;
    setGemsSectionExpanded(injectedSection, getExpanded());
  }

  function removeSectionShell(): void {
    injectedSection?.remove();
    injectedSection = null;
    sectionNav = null;
  }

  function cleanupSection(): void {
    if (injectedList) {
      injectedList.remove();
      injectedList = null;
    }
    removeSectionShell();
    anchoredEntry = null;
    removeExpandToggle();
  }

  function scheduleEnforce(): void {
    if (stopped || enforceRafId !== null) return;
    enforceRafId = window.requestAnimationFrame(() => {
      enforceRafId = null;
      enforcePosition();
    });
  }

  /**
   * Make sure our list sits immediately after the *current* Gems nav entry
   * (with the chevron on it), or else in its section after the top nav. Reads
   * layout to pick the visible entry, so the observer calls it only when the
   * anchor may have moved.
   */
  function enforcePosition(): void {
    if (stopped || getCount() <= 0) return;
    const location = findGemsSidebarLocation();
    const gemsEntry = location?.entry ?? null;
    const nav = location?.nav ?? null;
    if (!gemsEntry?.parentElement && !nav) return;

    if (!injectedList || !injectedList.isConnected) {
      renderSection(location);
      return;
    }
    if (gemsEntry?.parentElement) placeAfterEntry(gemsEntry, injectedList);
    else if (nav) placeInSection(nav, injectedList);
  }

  /** Whether a mutation batch can have moved the list from where it was placed. */
  function anchorMayBeDisturbed(mutations: readonly MutationRecord[]): boolean {
    if (injectedSection) {
      return gemsSectionMayBeDisturbed(mutations, { nav: sectionNav, section: injectedSection });
    }
    return gemsAnchorMayBeDisturbed(mutations, {
      entry: anchoredEntry,
      list: injectedList,
      toggle: injectedToggle,
    });
  }

  function setupPositionEnforcer(): void {
    if (stopped || getCount() <= 0) return;

    const overflow = findGemsSidebarLocation()?.overflow;
    if (!overflow) {
      if (positionRetryTimer === null) {
        positionRetryTimer = window.setTimeout(() => {
          positionRetryTimer = null;
          setupPositionEnforcer();
        }, 500);
      }
      return;
    }
    if (positionRetryTimer !== null) {
      clearTimeout(positionRetryTimer);
      positionRetryTimer = null;
    }
    stopAnchorWatch?.();
    // Gemini streams conversation rows into this subtree; only re-run the
    // layout-reading lookup when the anchor may have moved or swapped (#1040).
    stopAnchorWatch = watchGemsAnchor(overflow, anchorMayBeDisturbed, () => {
      if (!injectedList && visibleGems().length === 0) return;
      scheduleEnforce();
    });
    scheduleEnforce();
  }

  function teardownPositionEnforcer(): void {
    stopAnchorWatch?.();
    stopAnchorWatch = null;
    if (enforceRafId !== null) {
      cancelAnimationFrame(enforceRafId);
      enforceRafId = null;
    }
    if (positionRetryTimer !== null) {
      clearTimeout(positionRetryTimer);
      positionRetryTimer = null;
    }
  }

  function refreshInjector(): void {
    if (stopped) return;
    if (getCount() <= 0) {
      cleanupSection();
      teardownPositionEnforcer();
      return;
    }

    setupPositionEnforcer();
    renderSection();
  }

  return {
    refresh: refreshInjector,
    refreshExpanded: refreshExpandedState,
    stop() {
      stopped = true;
      teardownPositionEnforcer();
      cleanupSection();
    },
  };
}
