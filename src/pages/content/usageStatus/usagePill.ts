import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import { type UsageDisplay, resolveUsageDisplay } from '@/core/utils/usageDisplayValues';
import { getTranslationSync } from '@/utils/i18n';
import type { TranslationKey } from '@/utils/translations';

import { USAGE_REFRESH_ICON } from './icons';
import { usageUrlForPathname } from './usageSnapshot';
import type { UsageMetric, UsageSnapshot } from './usageSnapshot';

type UsagePillMode = 'hidden' | 'empty' | 'ready';
const PILL_ID = 'gv-usage-pill';
const STAMP_REFRESH_MS = 30_000;
const t = (key: TranslationKey, fallback: string): string => {
  const value = getTranslationSync(key);
  return value === key ? fallback : value;
};

/** "updated X ago" stamp from a timestamp. Pure so it can be unit-tested. */
export function formatUpdatedAgo(updatedAt: number, now: number): string {
  const diffMs = Math.max(0, now - updatedAt);
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return t('usageStatusJustUpdated', 'Just updated');
  if (min < 60) return t('usageStatusMinutesAgo', 'Updated {n}m ago').replace('{n}', String(min));
  const hours = Math.floor(min / 60);
  if (hours < 24) return t('usageStatusHoursAgo', 'Updated {n}h ago').replace('{n}', String(hours));
  const days = Math.floor(hours / 24);
  return t('usageStatusDaysAgo', 'Updated {n}d ago').replace('{n}', String(days));
}

export function formatResetCountdown(epochSec: number | undefined, now: number): string {
  if (typeof epochSec !== 'number') return '';
  const diffMs = epochSec * 1000 - now;
  if (diffMs <= 0) return '';
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(mins / 60);
  const restMins = mins % 60;
  if (hours < 1) return `${mins}m`;
  if (hours < 24) return restMins > 0 ? `${hours}h${restMins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return `${days}d${rest}h`;
}

export function getUsagePillMode(
  isEnabled: boolean,
  hostname: string,
  currentSnapshot: UsageSnapshot | null,
): UsagePillMode {
  if (!isEnabled || hostname !== 'gemini.google.com') return 'hidden';
  return currentSnapshot?.daily || currentSnapshot?.weekly ? 'ready' : 'empty';
}

/** Owns the pill DOM, stored placement and interaction/timer cleanup. */
export function createUsagePill(onRefresh: () => void) {
  let snapshot: UsageSnapshot | null = null;
  let pill: HTMLElement | null = null;
  let stampTimer: number | null = null;
  let dragPos: { x: number; y: number } | null = null;
  let display: UsageDisplay = 'used';
  let dragging = false;
  let dragMoved = false;
  let dragOffset = { x: 0, y: 0 };
  let dragStart = { x: 0, y: 0 };
  let pillMoveHandler: ((ev: PointerEvent) => void) | null = null;
  const OPEN_ICON = `<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z"/></svg>`;

  /** Build a compact metric segment: label · thin bar · percent. */
  function buildMetric(kind: 'daily' | 'weekly'): HTMLElement {
    const seg = document.createElement('div');
    seg.className = 'gv-usage-metric';
    seg.dataset.kind = kind;

    const name = document.createElement('span');
    name.className = 'gv-usage-label';
    seg.appendChild(name);

    const track = document.createElement('span');
    track.className = 'gv-usage-track';
    const fill = document.createElement('span');
    fill.className = 'gv-usage-fill';
    track.appendChild(fill);
    seg.appendChild(track);

    const pct = document.createElement('span');
    pct.className = 'gv-usage-pct';
    seg.appendChild(pct);

    return seg;
  }

  /**
   * Build the pill skeleton once. Labels/titles are (re)applied on every render so
   * a late-initialised i18n language still lands correctly (no frozen English).
   */
  function ensurePill(): HTMLElement {
    const existing = document.getElementById(PILL_ID);
    if (existing) {
      pill = existing;
      return existing;
    }

    const el = document.createElement('div');
    el.id = PILL_ID;
    el.className = 'gv-usage-pill';
    el.setAttribute('role', 'group');

    const tier = document.createElement('span');
    tier.className = 'gv-usage-tier';
    el.appendChild(tier);

    const empty = document.createElement('a');
    empty.className = 'gv-usage-empty';
    empty.target = '_blank';
    empty.rel = 'noopener noreferrer';
    empty.addEventListener('click', (e) => e.stopPropagation());
    el.appendChild(empty);

    el.appendChild(buildMetric('daily'));
    el.appendChild(buildMetric('weekly'));

    // Refresh = force an immediate silent replay. Never navigates.
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'gv-usage-refresh';
    refresh.innerHTML = USAGE_REFRESH_ICON;
    refresh.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onRefresh();
    });
    el.appendChild(refresh);

    // The only affordance that opens the native /usage page — a real link, new tab.
    const open = document.createElement('a');
    open.className = 'gv-usage-open';
    open.href = usageUrlForPathname(location.pathname);
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.innerHTML = OPEN_ICON;
    open.addEventListener('click', (e) => e.stopPropagation());
    el.appendChild(open);

    // Draggable: grab anywhere on the bar to reposition; the spot is persisted.
    // The refresh/open controls opt out so they stay clickable.
    el.addEventListener('pointerdown', onPillPointerDown);

    document.body.appendChild(el);
    pill = el;
    return el;
  }

  function setMetric(el: HTMLElement, kind: 'daily' | 'weekly', metric: UsageMetric | null): void {
    const seg = el.querySelector<HTMLElement>(`.gv-usage-metric[data-kind="${kind}"]`);
    if (!seg) return;
    const label = seg.querySelector<HTMLElement>('.gv-usage-label');
    const fill = seg.querySelector<HTMLElement>('.gv-usage-fill');
    const pct = seg.querySelector<HTMLElement>('.gv-usage-pct');
    if (label) {
      label.textContent =
        kind === 'daily' ? t('usageStatusDaily', '5h') : t('usageStatusWeekly', 'Weekly');
    }
    if (metric) {
      seg.removeAttribute('hidden');
      const remaining = display === 'remaining';
      const shown = remaining ? Math.max(0, 100 - metric.percent) : metric.percent;
      if (fill) fill.style.width = `${shown}%`;
      if (pct) {
        const reset = formatResetCountdown(metric.resetEpoch, Date.now());
        pct.textContent = `${shown}%${reset ? ` (${reset})` : ''}`;
        // The number alone does not say which share it is; the label does.
        const spoken = remaining
          ? t('usageStatusRemaining', '{n}% left').replace('{n}', String(shown))
          : t('usageStatusUsed', '{n}% used').replace('{n}', String(shown));
        const label = reset ? `${spoken} (${reset})` : spoken;
        pct.title = label;
        pct.setAttribute('aria-label', label);
      }
      // Colour follows how much is used in either view: low remaining turns red.
      seg.classList.toggle('gv-usage-high', metric.percent >= 90);
      seg.classList.toggle('gv-usage-mid', metric.percent >= 70 && metric.percent < 90);
      // Reset time lives in the segment tooltip to keep the bar short.
      seg.title = metric.resetLabel
        ? `${t('usageStatusResets', 'Resets')} ${metric.resetLabel}`
        : '';
    } else {
      seg.setAttribute('hidden', '');
    }
  }

  function updatePillContent(el: HTMLElement, snap: UsageSnapshot | null): void {
    el.setAttribute('aria-label', t('usageStatusTitle', 'Gemini usage limits'));

    const hasData = Boolean(snap?.daily || snap?.weekly);
    const empty = el.querySelector<HTMLAnchorElement>('.gv-usage-empty');
    if (empty) {
      const label = t('usageStatusEmptyHint', 'Click to load usage');
      empty.textContent = label;
      empty.href = usageUrlForPathname(location.pathname);
      empty.toggleAttribute('hidden', hasData);
      empty.setAttribute('aria-label', label);
    }

    const tier = el.querySelector<HTMLElement>('.gv-usage-tier');
    if (tier) {
      tier.textContent = snap?.tier ?? '';
      tier.toggleAttribute('hidden', !snap?.tier);
    }
    const refresh = el.querySelector<HTMLElement>('.gv-usage-refresh');
    if (refresh) {
      const label = t('usageStatusRefresh', 'Refresh');
      refresh.setAttribute('aria-label', label);
      refresh.title = label;
      refresh.toggleAttribute('hidden', !hasData);
    }
    const open = el.querySelector<HTMLElement>('.gv-usage-open');
    if (open) {
      const label = t('usageStatusOpenHint', 'Open usage limits');
      open.setAttribute('aria-label', label);
      open.title = label;
      if (open instanceof HTMLAnchorElement) open.href = usageUrlForPathname(location.pathname);
      open.toggleAttribute('hidden', !hasData);
    }

    setMetric(el, 'daily', snap?.daily ?? null);
    setMetric(el, 'weekly', snap?.weekly ?? null);

    // Freshness lives in the pill's own tooltip (segment tooltips show resets).
    el.title = snap
      ? formatUpdatedAgo(snap.updatedAt, Date.now())
      : t('usageStatusEmptyHint', 'Click to load usage');
  }

  /** Clamp a top-left position so the pill stays fully on screen. */
  function clampPos(x: number, y: number): { x: number; y: number } {
    const w = pill?.offsetWidth ?? 240;
    const h = pill?.offsetHeight ?? 32;
    return {
      x: Math.max(8, Math.min(window.innerWidth - w - 8, x)),
      y: Math.max(8, Math.min(window.innerHeight - h - 8, y)),
    };
  }

  /** Position the bar: at the user-dragged spot if set, else bottom-centered. */
  function positionPill(el: HTMLElement): void {
    if (dragging) return;
    if (dragPos) {
      const { x, y } = clampPos(dragPos.x, dragPos.y);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.transform = 'none';
    } else {
      // Default: centered along the bottom edge, clear of the corner.
      el.style.left = '50%';
      el.style.top = 'auto';
      el.style.right = 'auto';
      el.style.bottom = '20px';
      el.style.transform = 'translateX(-50%)';
    }
  }

  function onPillPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0 || !pill) return;
    // Don't start a drag from the interactive controls.
    if (
      (ev.target as Element | null)?.closest('.gv-usage-empty, .gv-usage-refresh, .gv-usage-open')
    )
      return;
    dragging = true;
    dragMoved = false;
    const rect = pill.getBoundingClientRect();
    dragOffset = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    dragStart = { x: ev.clientX, y: ev.clientY };
    try {
      pill.setPointerCapture(ev.pointerId);
    } catch {
      // ignore
    }
    pill.classList.add('gv-usage-dragging');
    pillMoveHandler = onPillPointerMove;
    window.addEventListener('pointermove', pillMoveHandler);
    window.addEventListener('pointerup', onPillPointerUp, { once: true });
  }

  function onPillPointerMove(ev: PointerEvent): void {
    if (!dragging || !pill) return;
    if (Math.abs(ev.clientX - dragStart.x) + Math.abs(ev.clientY - dragStart.y) > 3)
      dragMoved = true;
    const { x, y } = clampPos(ev.clientX - dragOffset.x, ev.clientY - dragOffset.y);
    pill.style.left = `${x}px`;
    pill.style.top = `${y}px`;
    pill.style.right = 'auto';
    pill.style.bottom = 'auto';
    // Drop the centered-default transform so `left` maps 1:1 to the pointer.
    pill.style.transform = 'none';
  }

  /** End a drag: drop its window listeners and the dragging look. */
  function endDrag(): void {
    dragging = false;
    if (pillMoveHandler) {
      window.removeEventListener('pointermove', pillMoveHandler);
      pillMoveHandler = null;
    }
    window.removeEventListener('pointerup', onPillPointerUp);
    pill?.classList.remove('gv-usage-dragging');
  }

  function onPillPointerUp(): void {
    if (!dragging) return;
    endDrag();
    if (dragMoved && pill) {
      const rect = pill.getBoundingClientRect();
      dragPos = { x: Math.round(rect.left), y: Math.round(rect.top) };
      void saveDragPos(dragPos);
    }
  }

  async function loadPosition(): Promise<void> {
    try {
      const r = await browser.storage.local.get(StorageKeys.GV_USAGE_POS);
      const raw = (r as Record<string, unknown>)[StorageKeys.GV_USAGE_POS];
      if (raw && typeof raw === 'object') {
        const p = raw as { x?: unknown; y?: unknown };
        if (typeof p.x === 'number' && typeof p.y === 'number') dragPos = { x: p.x, y: p.y };
      }
    } catch {
      // ignore
    }
  }

  /** Count used or remaining, from the stored popup choice. */
  function adoptDisplay(raw: unknown): void {
    display = resolveUsageDisplay(raw);
    if (pill) updatePillContent(pill, snapshot);
  }

  async function saveDragPos(pos: { x: number; y: number }): Promise<void> {
    try {
      await browser.storage.local.set({ [StorageKeys.GV_USAGE_POS]: pos });
    } catch {
      // ignore
    }
  }

  function setSpinning(on: boolean): void {
    pill?.classList.toggle('gv-usage-loading', on);
  }

  function remove(): void {
    // A stop in the middle of a drag must not leave the drag's window listeners behind.
    endDrag();
    if (pill) {
      pill.remove();
      pill = null;
    }
    const stray = document.getElementById(PILL_ID);
    if (stray) stray.remove();
    if (stampTimer !== null) {
      clearInterval(stampTimer);
      stampTimer = null;
    }
    window.removeEventListener('resize', onResize);
  }

  function onResize(): void {
    if (pill) positionPill(pill);
  }

  function render(isEnabled: boolean, next: UsageSnapshot | null): void {
    snapshot = next;
    const mode = getUsagePillMode(isEnabled, location.hostname, snapshot);
    if (mode === 'hidden') {
      remove();
      return;
    }

    const el = ensurePill();
    updatePillContent(el, snapshot);
    positionPill(el);
    window.addEventListener('resize', onResize);

    if (stampTimer === null) {
      stampTimer = window.setInterval(() => {
        if (pill) updatePillContent(pill, snapshot);
      }, STAMP_REFRESH_MS);
    }
  }

  function adoptPosition(raw: unknown): void {
    const pos = raw as { x?: unknown; y?: unknown } | undefined;
    dragPos =
      pos && typeof pos.x === 'number' && typeof pos.y === 'number' ? { x: pos.x, y: pos.y } : null;
    if (pill) positionPill(pill);
  }

  return { loadPosition, adoptPosition, adoptDisplay, render, setSpinning, remove };
}
