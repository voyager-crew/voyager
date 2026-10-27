/**
 * The floating ball that opens the Prompt Manager.
 *
 * Owns where the ball sits (next to Gemini's own button by default, wherever
 * the user dragged it otherwise, always inside the viewport), whether it is
 * shown, and the release-notes announcement it can carry.
 *
 * Visibility follows one rule: the ball is hidden only when the user hid the
 * Prompt Manager and there is no announcement to show. While an announcement
 * is active, a click opens the release notes instead of the panel.
 */
import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import type { PromptTriggerSpot } from '@/features/prompt/PromptSiteAdapter';

import { hasUnreadChangelog, showChangelogModalDirect } from '../changelog/index';
import { readPromptPref, writePromptPref } from './promptPrefs';
import { PROMPT_TRIGGER_ELEMENT_ID } from './triggerClearance';
import { applyTriggerLogoFromStorageChange, createTriggerLogoImage } from './triggerLogo';

const ATTENTION_CLASS = 'gv-pm-trigger-new';
/** Pointer travel, in px, past which a press on the ball is a drag rather than a click. */
const DRAG_THRESHOLD = 5;

export interface PromptTrigger {
  readonly element: HTMLButtonElement;
  /** True while the ball announces unread release notes. */
  readonly hasAttention: boolean;
  /**
   * Starts answering clicks and drags. Until then the ball is visible but
   * inert, so it cannot open a panel that is still being built.
   */
  enable: (onActivate: () => void) => void;
  /**
   * Drops the announcement and opens the release notes it announced.
   * Resolves to whether they opened; rejects when opening threw. Either way
   * the visibility rule is applied once opening has settled.
   */
  consumeAttention: () => Promise<boolean>;
  /** Pulls the ball back inside a viewport that shrank. */
  constrain: () => void;
  /** Records the user's hide setting. Returns true when the ball is now hidden. */
  setHiddenByUser: (hidden: boolean) => boolean;
  /** Follows logo and release-notes notification changes from storage. */
  applyStorageChange: (
    area: string,
    changes: Record<string, browser.Storage.StorageChange>,
  ) => void;
  destroy: () => void;
}

export interface PromptTriggerOptions {
  mascotLogo: boolean;
  hiddenByUser: boolean;
  attention: boolean;
  /** Mirrors the announcement onto other surfaces (the panel's version badge). */
  onAttentionChange: (active: boolean) => void;
  /** Where the ball sits until the user drags it; null keeps the stylesheet's corner. */
  defaultSpot: (ballHeight: number) => PromptTriggerSpot | null;
}

/** Adds the ball to the page and restores its position; resolves once it is placed. */
export async function mountPromptTrigger({
  mascotLogo,
  hiddenByUser: initiallyHidden,
  attention: initialAttention,
  onAttentionChange,
  defaultSpot,
}: PromptTriggerOptions): Promise<PromptTrigger> {
  let hiddenByUser = initiallyHidden;
  let attention = initialAttention;

  const trigger = document.createElement('button');
  trigger.className = 'gv-pm-trigger';
  trigger.id = PROMPT_TRIGGER_ELEMENT_ID;
  trigger.setAttribute('aria-label', 'Prompt Manager');
  const img = createTriggerLogoImage(trigger, mascotLogo, getRuntimeUrl);
  if (attention) {
    trigger.classList.add(ATTENTION_CLASS);
  }
  if (hiddenByUser && !attention) {
    trigger.style.display = 'none';
  }
  document.body.appendChild(trigger);

  function applyVisibility(): void {
    trigger.style.display = hiddenByUser && !attention ? 'none' : '';
  }

  function setAttention(active: boolean): void {
    attention = active;
    trigger.classList.toggle(ATTENTION_CLASS, active);
    onAttentionChange(active);
  }

  function placeAtDefaultSpot(): void {
    const spot = defaultSpot(trigger.getBoundingClientRect().height || 36);
    if (!spot) return;
    trigger.style.right = `${spot.right}px`;
    trigger.style.bottom = `${spot.bottom}px`;
  }

  // Constrain the ball to the viewport bounds
  function constrain(): void {
    try {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = trigger.getBoundingClientRect();
      const tw = rect.width || 44;
      const th = rect.height || 44;
      const minPad = 6;

      const currentRight = parseFloat(trigger.style.right || '18') || 18;
      const currentBottom = parseFloat(trigger.style.bottom || '18') || 18;

      // Ensure at least minPad from edges
      const maxRight = vw - tw - minPad;
      const maxBottom = vh - th - minPad;

      const right = Math.max(minPad, Math.min(currentRight, maxRight));
      const bottom = Math.max(minPad, Math.min(currentBottom, maxBottom));

      trigger.style.right = `${Math.round(right)}px`;
      trigger.style.bottom = `${Math.round(bottom)}px`;
    } catch {}
  }

  // Restore the saved position; otherwise place next to the host button
  let placementFrame: number | null = null;
  let placementTimer: number | null = null;
  // Deferred placement must not read the page after teardown or a sidebar remount.
  function cancelPlacement(): void {
    if (placementFrame !== null) cancelAnimationFrame(placementFrame);
    if (placementTimer !== null) window.clearTimeout(placementTimer);
    placementFrame = null;
    placementTimer = null;
  }

  try {
    const pos = await readPromptPref<PromptTriggerSpot | null>(
      StorageKeys.PROMPT_TRIGGER_POSITION,
      null,
    );
    if (pos && Number.isFinite(pos.bottom) && Number.isFinite(pos.right)) {
      trigger.style.bottom = `${Math.max(6, Math.round(pos.bottom))}px`;
      trigger.style.right = `${Math.max(6, Math.round(pos.right))}px`;
      // Constrain position after restore to handle window resize/split screen
      placementFrame = requestAnimationFrame(constrain);
    } else {
      // defer a bit to wait for host DOM
      placeAtDefaultSpot();
      placementFrame = requestAnimationFrame(placeAtDefaultSpot);
      placementTimer = window.setTimeout(placeAtDefaultSpot, 350);
    }
  } catch {
    placeAtDefaultSpot();
  }

  async function consumeAttention(): Promise<boolean> {
    setAttention(false);
    try {
      return await showChangelogModalDirect();
    } finally {
      applyVisibility();
    }
  }

  let dragging = false;
  let dragStart: { x: number; y: number } | null = null;
  let wasDragged = false;

  const onPointerMove = (ev: PointerEvent): void => {
    if (!dragging) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = trigger.getBoundingClientRect();
    const w = rect.width || 36;
    const h = rect.height || 36;
    const right = Math.max(6, Math.min(vw - 6 - w, vw - ev.clientX - w / 2));
    const bottom = Math.max(6, Math.min(vh - 6 - h, vh - ev.clientY - h / 2));
    trigger.style.right = `${Math.round(right)}px`;
    trigger.style.bottom = `${Math.round(bottom)}px`;
  };

  const onPointerUp = async (ev: PointerEvent): Promise<void> => {
    if (!dragging) return;
    dragging = false;
    // Only save if the ball actually moved
    if (dragStart) {
      const dx = Math.abs(ev.clientX - dragStart.x);
      const dy = Math.abs(ev.clientY - dragStart.y);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        wasDragged = true;
        const r = parseFloat((trigger.style.right || '').replace('px', '')) || 18;
        const b = parseFloat((trigger.style.bottom || '').replace('px', '')) || 18;
        await writePromptPref(StorageKeys.PROMPT_TRIGGER_POSITION, { right: r, bottom: b });
      }
    }
    dragStart = null;
  };

  let enabled = false;

  return {
    element: trigger,
    get hasAttention() {
      return attention;
    },
    enable: (onActivate) => {
      if (enabled) return;
      enabled = true;
      trigger.addEventListener('click', async () => {
        // Suppress the click that ends a drag
        if (wasDragged) {
          wasDragged = false;
          return;
        }
        // An announced release opens instead of the panel
        if (attention) {
          try {
            await consumeAttention();
          } catch {
            // Ignore errors
          }
          return;
        }
        onActivate();
      });
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      trigger.addEventListener('pointerdown', (ev: PointerEvent) => {
        if (typeof ev.button === 'number' && ev.button !== 0) return;
        dragging = true;
        wasDragged = false;
        dragStart = { x: ev.clientX, y: ev.clientY };
        try {
          trigger.setPointerCapture?.(ev.pointerId);
        } catch {}
      });
      window.addEventListener('pointerup', onPointerUp, { passive: true });
    },
    consumeAttention,
    constrain,
    setHiddenByUser: (hidden) => {
      hiddenByUser = hidden;
      applyVisibility();
      return hidden && !attention;
    },
    applyStorageChange: (area, changes) => {
      applyTriggerLogoFromStorageChange(area, changes, trigger, img, getRuntimeUrl);
      if (
        area === 'local' &&
        (changes[StorageKeys.CHANGELOG_NOTIFY_MODE] ||
          changes[StorageKeys.CHANGELOG_DISMISSED_VERSION])
      ) {
        void (async () => {
          try {
            const [modeRes, unread] = await Promise.all([
              browser.storage.local.get(StorageKeys.CHANGELOG_NOTIFY_MODE),
              hasUnreadChangelog(),
            ]);
            const mode = modeRes?.[StorageKeys.CHANGELOG_NOTIFY_MODE];
            const shouldAnnounce = mode === 'badge' && unread;
            if (shouldAnnounce !== attention) {
              setAttention(shouldAnnounce);
              applyVisibility();
            }
          } catch {
            // Ignore errors
          }
        })();
      }
    },
    destroy: () => {
      cancelPlacement();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      trigger.remove();
    },
  };
}

function getRuntimeUrl(path: string): string {
  // Try the standard Web Extensions API first (mainly for Firefox)
  try {
    return browser.runtime.getURL(path);
  } catch {
    const win = window as Window & { chrome?: { runtime?: { getURL?: (path: string) => string } } };
    return win.chrome?.runtime?.getURL?.(path) || path;
  }
}
