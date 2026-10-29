/**
 * The floating ball: one per page, shared by Prompt Manager and the panel shell.
 *
 * Whoever needs it first adds it to the page; it stays while anyone holds it.
 * It owns where it sits (next to Gemini's own button by default, wherever the
 * user dragged it otherwise, always inside the viewport), whether it shows,
 * and the release-notes announcement it can carry. It follows the hide, logo
 * and announcement settings itself, so every holder sees one state.
 *
 * Visibility follows one rule: the ball is hidden only when the user hid it
 * and there is no announcement to show. A click opens the announced release
 * notes; otherwise it goes to Prompt Manager while Prompt Manager holds the
 * ball (ignored until its panel is built), else to the panel shell.
 */
import browser from 'webextension-polyfill';

import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { isUserEvent } from '@/core/utils/userEvent';
import type { PromptTriggerSpot } from '@/features/prompt/PromptSiteAdapter';

import { hasUnreadChangelog, showChangelogModalDirect } from '../changelog/index';
import { readPromptPref, writePromptPref } from './promptPrefs';
import { PROMPT_TRIGGER_ELEMENT_ID } from './triggerClearance';
import { applyTriggerLogoFromStorageChange, createTriggerLogoImage } from './triggerLogo';

const ATTENTION_CLASS = 'gv-pm-trigger-new';
/** On the ball while a press on it moves it, so its decoration can step aside. */
export const BALL_DRAGGING_CLASS = 'gv-pm-trigger--dragging';
/** Pointer travel, in px, past which a press on the ball is a drag rather than a click. */
const DRAG_THRESHOLD = 5;

type StorageChanges = Record<string, { newValue?: unknown }>;

export type BallHolderId = 'prompt-manager' | 'panel-shell';

/** What the holder that adds the ball knows; later holders join the ball as it is. */
export interface BallStartup {
  /** Accessible name until a holder relabels the ball. */
  label: string;
  mascotLogo: boolean;
  hiddenByUser: boolean;
  attention: boolean;
  /** Where the ball sits until the user drags it; null keeps the stylesheet's corner. */
  defaultSpot: (ballHeight: number) => PromptTriggerSpot | null;
}

export interface BallHolder {
  readonly id: BallHolderId;
  /** The ball was hidden or shown by the user's hide setting. */
  readonly onHiddenChange?: (hidden: boolean) => void;
  /** Mirrors the announcement onto the holder's own surfaces. */
  readonly onAttentionChange?: (active: boolean) => void;
}

/** How the ball leaves and returns when the hide setting changes; the panel shell provides it. */
export interface BallMotion {
  /** Resolves once the ball may leave the layout; null hides it at once. */
  leave(ball: HTMLElement): Promise<void> | null;
  enter(ball: HTMLElement): void;
}

export interface BallLease {
  readonly element: HTMLButtonElement;
  readonly hasAttention: boolean;
  /**
   * Answer clicks and drags for this holder (null: inert again). `open` opens
   * the holder's surface without toggling it, for commands outside the ball.
   */
  setActivate(activate: (() => void) | null, open?: () => void): void;
  /**
   * Drops the announcement and opens the release notes it announced.
   * Resolves to whether they opened; rejects when opening threw. Either way
   * the visibility rule is applied once opening has settled.
   */
  consumeAttention(): Promise<boolean>;
  /** Pulls the ball back inside a viewport that shrank. */
  constrain(): void;
  /** Records the hide setting; `animate` plays the motion. Returns true when the ball is now hidden. */
  setHiddenByUser(hidden: boolean, animate?: boolean): boolean;
  /** Follows logo and release-notes notification changes, as the ball's own listener does. */
  applyStorageChange(area: string, changes: StorageChanges): void;
  /** Idempotent; the last holder to leave removes the ball. */
  release(): void;
}

export interface BallView {
  readonly element: HTMLButtonElement;
  readonly hidden: boolean;
  readonly holders: readonly BallHolderId[];
  /** Whose click the ball answers now; null while it is inert. */
  readonly answers: BallHolderId | null;
}

interface LeaseRecord {
  readonly holder: BallHolder;
  activate: (() => void) | null;
  open: (() => void) | null;
}

interface Ball {
  readonly element: HTMLButtonElement;
  readonly ready: Promise<void>;
  readonly records: Set<LeaseRecord>;
  hasAttention(): boolean;
  hidden(): boolean;
  answering(): LeaseRecord | null;
  consumeAttention(): Promise<boolean>;
  constrain(): void;
  setHiddenByUser(hidden: boolean, animate: boolean): boolean;
  applyStorageChange(area: string, changes: StorageChanges): void;
  destroy(): void;
}

let current: Ball | null = null;
let motion: BallMotion | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of Array.from(listeners)) listener();
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

function createBall(startup: BallStartup): Ball {
  let hiddenByUser = startup.hiddenByUser;
  let attention = startup.attention;
  let destroyed = false;
  const records = new Set<LeaseRecord>();

  const element = document.createElement('button');
  element.className = 'gv-pm-trigger';
  element.id = PROMPT_TRIGGER_ELEMENT_ID;
  element.setAttribute('aria-label', startup.label);
  const img = createTriggerLogoImage(element, startup.mascotLogo, getRuntimeUrl);
  if (attention) element.classList.add(ATTENTION_CLASS);
  let shownHidden = hiddenByUser && !attention;
  if (shownHidden) element.style.display = 'none';
  document.body.appendChild(element);

  function applyVisibility(animate = false): void {
    const hide = hiddenByUser && !attention;
    if (hide === shownHidden) return;
    shownHidden = hide;
    if (hide) {
      const leaving = animate ? (motion?.leave(element) ?? null) : null;
      const remove = () => {
        // A show that started meanwhile keeps the ball.
        if (shownHidden && !destroyed) element.style.display = 'none';
      };
      if (leaving) void leaving.then(remove, remove);
      else remove();
    } else {
      element.style.display = '';
      if (animate) motion?.enter(element);
    }
    tellHolders((holder) => holder.onHiddenChange?.(hide));
    notify();
  }

  function setAttention(active: boolean): void {
    attention = active;
    element.classList.toggle(ATTENTION_CLASS, active);
    tellHolders((holder) => holder.onAttentionChange?.(active));
  }

  /** One holder that throws (say, mid-startup) must not keep the news from the others. */
  function tellHolders(tell: (holder: BallHolder) => void): void {
    for (const record of Array.from(records)) {
      try {
        tell(record.holder);
      } catch (error) {
        logger.error('Floating ball holder failed', { error: String(error) });
      }
    }
  }

  function placeAtDefaultSpot(): void {
    const spot = startup.defaultSpot(element.getBoundingClientRect().height || 36);
    if (!spot) return;
    element.style.right = `${spot.right}px`;
    element.style.bottom = `${spot.bottom}px`;
  }

  // Constrain the ball to the viewport bounds
  function constrain(): void {
    try {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = element.getBoundingClientRect();
      const tw = rect.width || 44;
      const th = rect.height || 44;
      const minPad = 6;
      const currentRight = parseFloat(element.style.right || '18') || 18;
      const currentBottom = parseFloat(element.style.bottom || '18') || 18;
      const right = Math.max(minPad, Math.min(currentRight, vw - tw - minPad));
      const bottom = Math.max(minPad, Math.min(currentBottom, vh - th - minPad));
      element.style.right = `${Math.round(right)}px`;
      element.style.bottom = `${Math.round(bottom)}px`;
    } catch {}
  }

  // Deferred placement must not read the page after teardown or a sidebar remount.
  let placementFrame: number | null = null;
  let placementTimer: number | null = null;
  function cancelPlacement(): void {
    if (placementFrame !== null) cancelAnimationFrame(placementFrame);
    if (placementTimer !== null) window.clearTimeout(placementTimer);
    placementFrame = null;
    placementTimer = null;
  }

  // Restore the saved position; otherwise place next to the host button
  const ready = (async () => {
    try {
      const pos = await readPromptPref<PromptTriggerSpot | null>(
        StorageKeys.PROMPT_TRIGGER_POSITION,
        null,
      );
      if (destroyed) return;
      if (pos && Number.isFinite(pos.bottom) && Number.isFinite(pos.right)) {
        element.style.bottom = `${Math.max(6, Math.round(pos.bottom))}px`;
        element.style.right = `${Math.max(6, Math.round(pos.right))}px`;
        // Constrain position after restore to handle window resize/split screen
        placementFrame = requestAnimationFrame(constrain);
      } else {
        // defer a bit to wait for host DOM
        placeAtDefaultSpot();
        placementFrame = requestAnimationFrame(placeAtDefaultSpot);
        placementTimer = window.setTimeout(placeAtDefaultSpot, 350);
      }
    } catch {
      if (!destroyed) placeAtDefaultSpot();
    }
  })();

  async function consumeAttention(): Promise<boolean> {
    setAttention(false);
    try {
      return await showChangelogModalDirect();
    } finally {
      applyVisibility();
    }
  }

  function answering(): LeaseRecord | null {
    let shell: LeaseRecord | null = null;
    for (const record of records) {
      // Prompt Manager owns the click while it holds the ball, even before its panel is built.
      if (record.holder.id === 'prompt-manager') return record.activate ? record : null;
      if (record.activate) shell = record;
    }
    return shell;
  }

  let dragging = false;
  let dragStart: { x: number; y: number } | null = null;
  let wasDragged = false;
  const moved = (ev: PointerEvent): boolean =>
    !!dragStart &&
    (Math.abs(ev.clientX - dragStart.x) > DRAG_THRESHOLD ||
      Math.abs(ev.clientY - dragStart.y) > DRAG_THRESHOLD);

  const onPointerDown = (ev: PointerEvent): void => {
    if (!answering()) return;
    if (typeof ev.button === 'number' && ev.button !== 0) return;
    dragging = true;
    wasDragged = false;
    dragStart = { x: ev.clientX, y: ev.clientY };
    try {
      element.setPointerCapture?.(ev.pointerId);
    } catch {}
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (!dragging) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = element.getBoundingClientRect();
    const w = rect.width || 36;
    const h = rect.height || 36;
    const right = Math.max(6, Math.min(vw - 6 - w, vw - ev.clientX - w / 2));
    const bottom = Math.max(6, Math.min(vh - 6 - h, vh - ev.clientY - h / 2));
    element.style.right = `${Math.round(right)}px`;
    element.style.bottom = `${Math.round(bottom)}px`;
    if (moved(ev)) element.classList.add(BALL_DRAGGING_CLASS);
  };

  const onPointerUp = async (ev: PointerEvent): Promise<void> => {
    if (!dragging) return;
    dragging = false;
    element.classList.remove(BALL_DRAGGING_CLASS);
    // Only save if the ball actually moved
    if (moved(ev)) {
      wasDragged = true;
      const r = parseFloat((element.style.right || '').replace('px', '')) || 18;
      const b = parseFloat((element.style.bottom || '').replace('px', '')) || 18;
      await writePromptPref(StorageKeys.PROMPT_TRIGGER_POSITION, { right: r, bottom: b });
    }
    dragStart = null;
  };

  const onClick = async (event: MouseEvent): Promise<void> => {
    // A page script's click() must open no panel and spend no announcement (a storage write).
    // Enter and Space on the focused button click as the user does: trusted.
    if (!isUserEvent(event)) return;
    const record = answering();
    if (!record) return;
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
    record.activate?.();
  };

  function setHiddenByUser(hidden: boolean, animate: boolean): boolean {
    hiddenByUser = hidden;
    applyVisibility(animate);
    return hidden && !attention;
  }

  function applyStorageChange(area: string, changes: StorageChanges): void {
    applyTriggerLogoFromStorageChange(area, changes, element, img, getRuntimeUrl);
    if (
      area !== 'local' ||
      (!changes[StorageKeys.CHANGELOG_NOTIFY_MODE] &&
        !changes[StorageKeys.CHANGELOG_DISMISSED_VERSION])
    )
      return;
    void (async () => {
      try {
        const [modeRes, unread] = await Promise.all([
          browser.storage.local.get(StorageKeys.CHANGELOG_NOTIFY_MODE),
          hasUnreadChangelog(),
        ]);
        const shouldAnnounce = modeRes?.[StorageKeys.CHANGELOG_NOTIFY_MODE] === 'badge' && unread;
        if (!destroyed && shouldAnnounce !== attention) {
          setAttention(shouldAnnounce);
          applyVisibility();
        }
      } catch {
        // Ignore errors
      }
    })();
  }

  const onStorageChanged = (changes: StorageChanges, area: string): void => {
    if (destroyed) return;
    const hide = changes[StorageKeys.HIDE_PROMPT_MANAGER];
    if (area === 'sync' && hide) setHiddenByUser(hide.newValue === true, true);
    applyStorageChange(area, changes);
  };

  element.addEventListener('click', onClick);
  element.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('resize', constrain, { passive: true });
  chrome.storage?.onChanged?.addListener(onStorageChanged);

  return {
    element,
    ready,
    records,
    hasAttention: () => attention,
    hidden: () => shownHidden,
    answering,
    consumeAttention,
    constrain,
    setHiddenByUser,
    applyStorageChange,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelPlacement();
      element.removeEventListener('click', onClick);
      element.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('resize', constrain);
      chrome.storage?.onChanged?.removeListener(onStorageChanged);
      element.remove();
      records.clear();
    },
  };
}

function retire(ball: Ball): void {
  ball.destroy();
  if (current === ball) current = null;
  notify();
}

function leaseFor(ball: Ball, record: LeaseRecord): BallLease {
  return {
    element: ball.element,
    get hasAttention() {
      return ball.hasAttention();
    },
    setActivate(activate, open) {
      record.activate = activate;
      record.open = activate ? (open ?? activate) : null;
      notify();
    },
    consumeAttention: () => ball.consumeAttention(),
    constrain: () => ball.constrain(),
    setHiddenByUser: (hidden, animate = false) => ball.setHiddenByUser(hidden, animate),
    applyStorageChange: (area, changes) => ball.applyStorageChange(area, changes),
    release() {
      if (!ball.records.delete(record)) return;
      if (ball.records.size === 0) retire(ball);
      else notify();
    },
  };
}

export const promptBall = {
  /**
   * Hold the page's ball, adding it with `startup` when nobody holds one yet.
   * Resolves once it is placed; null when another script's ball is on the page.
   */
  async acquire(
    holder: BallHolder,
    startup: () => BallStartup | Promise<BallStartup>,
  ): Promise<BallLease | null> {
    // A ball whose page wiped it is gone for everyone; its holders' leases go inert.
    if (current && !current.element.isConnected) retire(current);
    if (!current) {
      if (document.getElementById(PROMPT_TRIGGER_ELEMENT_ID)) return null;
      const settings = await startup();
      if (!current) {
        if (!document.body || document.getElementById(PROMPT_TRIGGER_ELEMENT_ID)) return null;
        current = createBall(settings);
      }
    }
    const ball = current;
    const record: LeaseRecord = { holder, activate: null, open: null };
    ball.records.add(record);
    notify();
    await ball.ready;
    return leaseFor(ball, record);
  },

  view(): BallView | null {
    const ball = current;
    if (!ball || !ball.element.isConnected) return null;
    return {
      element: ball.element,
      hidden: ball.hidden(),
      holders: Array.from(ball.records, (record) => record.holder.id),
      answers: ball.answering()?.holder.id ?? null,
    };
  },

  /** Opens Prompt Manager's panel when it is ready and its ball shows; false otherwise. */
  openPromptManager(): boolean {
    const ball = current;
    if (!ball || ball.hidden()) return false;
    for (const record of ball.records) {
      if (record.holder.id === 'prompt-manager' && record.open) {
        record.open();
        return true;
      }
    }
    return false;
  },

  /** Runs on every change of the ball, its holders or its visibility. Returns the cleanup. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** The panel shell plays the hide and show; without it they are instant. Returns the cleanup. */
  provideMotion(next: BallMotion): () => void {
    motion = next;
    return () => {
      if (motion === next) motion = null;
    };
  },
};
