/**
 * Pin Toggle for native Gems management page.
 *
 * Injects a pin/unpin toggle button into each `bot-list-row` on the
 * Gemini /gems/view page. The button reads/writes the `GV_GEMS_PINNED`
 * list in chrome.storage.sync so the sidebar injector can render
 * pinned gems first, in pin order (the order they were pinned).
 *
 * Because the scraper (in pluginHandler.ts) also observes the same
 * `[data-test-id="your-gems-list"]` container, this module relies on
 * the scraper's existing MutationObserver — a separate re-injection
 * cycle is triggered after each scrape.
 */
import { StorageKeys } from '@/core/types/common';
import { getTranslationSync } from '@/utils/i18n';

import { readPinsForPage } from './pinRead';
import { readGemsList } from './selectorQueries';

const PIN_BTN_CLASS = 'gv-gem-pin-toggle';
const PIN_STYLE_ID = 'gv-gem-pin-style';

/** Each activation owns its pins; late reads cannot inject into a successor. */
export function createGemsPinControls(signal: AbortSignal) {
  const buttons = new Map<HTMLElement, () => void>();
  let styledInjected = false;
  let currentPinned: string[] = [];
  let stopped = false;
  const isStopped = () => stopped || signal.aborted;

  /**
   * Inject a small style sheet that sizes the pin toggle like Gemini's native
   * action buttons (Share, Edit, More). Inks follow `html[data-gv-scheme]`, light
   * first: the row sits on Gemini's light card too, where the old dark-only
   * white wash and pale blue were invisible. Pinned takes the Voyager accent.
   */
  function injectStyle(): void {
    if (styledInjected) return;
    const style = document.createElement('style');
    style.id = PIN_STYLE_ID;
    style.textContent = `
    .${PIN_BTN_CLASS} {
      --gv-gem-pin-ink: oklch(0.14 0.004 285 / 0.62);
      --gv-gem-pin-ink-hover: oklch(0.14 0.004 285 / 0.9);
      --gv-gem-pin-hover: oklch(0.14 0.004 285 / 0.08);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--gv-gem-pin-ink);
      cursor: pointer;
      transition: background-color 0.15s, color 0.15s;
      flex-shrink: 0;
    }
    html[data-gv-scheme='dark'] .${PIN_BTN_CLASS} {
      --gv-gem-pin-ink: oklch(0.92 0.004 250 / 0.66);
      --gv-gem-pin-ink-hover: oklch(0.92 0.004 250 / 0.95);
      --gv-gem-pin-hover: oklch(0.92 0.004 250 / 0.1);
    }
    .${PIN_BTN_CLASS}:hover {
      background: var(--gv-gem-pin-hover);
      color: var(--gv-gem-pin-ink-hover);
    }
    .${PIN_BTN_CLASS}:focus-visible {
      outline: 2px solid var(--gv-pm-brand, var(--gv-pm-brand-default));
      outline-offset: 1px;
    }
    .${PIN_BTN_CLASS}.gv-pinned,
    .${PIN_BTN_CLASS}.gv-pinned:hover {
      color: var(--gv-pm-brand, var(--gv-pm-brand-default));
    }
  `;
    document.head.appendChild(style);
    styledInjected = true;
  }

  /** Load pinned ids from chrome.storage.sync. */
  async function loadPinned(): Promise<string[]> {
    try {
      const result = await chrome.storage?.sync?.get({ [StorageKeys.GV_GEMS_PINNED]: [] });
      const raw = result?.[StorageKeys.GV_GEMS_PINNED];
      return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  /** Persist pinned ids to chrome.storage.sync. */
  async function savePinned(ids: string[]): Promise<void> {
    try {
      await chrome.storage?.sync?.set({ [StorageKeys.GV_GEMS_PINNED]: ids });
    } catch {
      // harmless
    }
  }

  const SVG_FILLED =
    '<path d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Z"/>';
  const SVG_OUTLINE =
    '<path d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Zm-286 80h252l-46-46v-314H400v314l-46 46Z"/>';
  const SVG_WRAP = (inner: string) =>
    `<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true" width="18" height="18">${inner}</svg>`;

  function toggleBtn(btn: HTMLElement, pinned: boolean): void {
    btn.classList.toggle('gv-pinned', pinned);
    btn.title = getTranslationSync(pinned ? 'gemsUnpinFromSidebar' : 'gemsPinToSidebar');
    btn.setAttribute('aria-label', getTranslationSync(pinned ? 'gemsUnpin' : 'gemsPin'));
    btn.innerHTML = SVG_WRAP(pinned ? SVG_FILLED : SVG_OUTLINE);
  }

  function createPinButton(id: string, isPinned: boolean): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = PIN_BTN_CLASS;
    btn.dataset.gemId = id;
    toggleBtn(btn, isPinned);

    const click = async (e: MouseEvent): Promise<void> => {
      e.stopPropagation();
      e.preventDefault();

      if (isStopped()) return;
      const wasPinned = btn.classList.contains('gv-pinned');
      let next = [...currentPinned];

      if (wasPinned) {
        next = next.filter((gid) => gid !== id);
      } else {
        // Append to the end — first pinned gem stays at the top.
        next = [...next.filter((gid) => gid !== id), id];
      }

      currentPinned = next;
      await savePinned(next);
      if (!isStopped()) toggleBtn(btn, !wasPinned);
    };
    btn.addEventListener('click', click);

    // Prevent Gemini's action-bar tooltip delegation from catching
    // hover events on our button (it would show "Share" or similar).
    const stopHover = (e: MouseEvent): void => e.stopImmediatePropagation();
    btn.addEventListener('mouseover', stopHover);
    btn.addEventListener('mouseout', stopHover);
    buttons.set(btn, () => {
      btn.removeEventListener('click', click);
      btn.removeEventListener('mouseover', stopHover);
      btn.removeEventListener('mouseout', stopHover);
      btn.remove();
    });

    return btn;
  }

  /**
   * Iterate every `bot-list-row` on the page and inject a pin toggle
   * button if one doesn't already exist. Idempotent — safe to call
   * repeatedly (e.g. after a DOM mutation).
   */
  async function injectPinButtons(): Promise<void> {
    if (isStopped()) return;
    return readPinsForPage(signal, loadPinned, applyPinButtons);
  }

  function applyPinButtons(pinned: string[]): void {
    // The sidebar stopped during the read: the style would stay behind with nothing to clean it.
    if (isStopped()) return;
    for (const [button, remove] of buttons) {
      if (!button.isConnected) {
        remove();
        buttons.delete(button);
      }
    }
    injectStyle();
    currentPinned = pinned;
    const pinnedSet = new Set(currentPinned);

    const read = readGemsList();
    for (const { row, anchor } of read.rows) {
      if (row.querySelector(`.${PIN_BTN_CLASS}`)) continue;

      const id = anchor.getAttribute('href')?.match(/\/gem\/([^/?#]+)/)?.[1];
      if (!id) continue;

      const btn = createPinButton(id, pinnedSet.has(id));

      // Insert the pin button as a sibling of the anchor, before the
      // native action bar.  The anchor is a flex container so the button
      // naturally aligns to the right when its parent is flex.
      if (anchor?.parentElement) {
        // Insert right after the anchor's own content wrapper
        anchor.parentElement.insertBefore(btn, anchor.nextElementSibling);
      } else {
        row.insertBefore(btn, row.firstChild);
      }
    }
  }

  /** Remove every pin toggle and its style; a pending injection is dropped. */
  function removePinButtons(): void {
    stopped = true;
    // Gemini may retain a detached list; document queries would leave its dead pins behind.
    for (const remove of buttons.values()) remove();
    buttons.clear();
    document.getElementById(PIN_STYLE_ID)?.remove();
    styledInjected = false;
  }

  type PinnedChangesListener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => void;

  let pinnedChangesListener: PinnedChangesListener | null = null;

  function onPinnedStorageChanged(
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void {
    if (isStopped() || areaName !== 'sync') return;
    if (!changes[StorageKeys.GV_GEMS_PINNED]) return;
    const raw = changes[StorageKeys.GV_GEMS_PINNED].newValue;
    currentPinned = Array.isArray(raw)
      ? raw.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    const pinnedSet = new Set(currentPinned);
    buttons.forEach((_remove, btn) => {
      const id = btn.dataset.gemId;
      if (!id) return;
      toggleBtn(btn, pinnedSet.has(id));
    });
  }

  /**
   * Listen for cross-tab changes to GV_GEMS_PINNED so the pin state
   * stays in sync if another window modifies it.
   *
   * Returns an unlisten function; the caller (gemsSidebar/pluginHandler.ts) invokes it
   * from its cleanup so the listener doesn't outlive the feature. Idempotent —
   * a second call replaces the previous registration instead of stacking.
   */
  function listenPinnedChanges(): () => void {
    if (pinnedChangesListener) {
      chrome.storage?.onChanged?.removeListener(pinnedChangesListener);
    }
    pinnedChangesListener = onPinnedStorageChanged;
    chrome.storage?.onChanged?.addListener(onPinnedStorageChanged);
    return () => {
      chrome.storage?.onChanged?.removeListener(onPinnedStorageChanged);
      if (pinnedChangesListener === onPinnedStorageChanged) {
        pinnedChangesListener = null;
      }
    };
  }

  return { inject: injectPinButtons, stop: removePinButtons, watch: listenPinnedChanges };
}
