import type { AccountTier } from '@/features/bridge/protocol';
/**
 * The Pro usage ring beside ChatGPT's chat-mode model picker, and the small
 * card that names the numbers on hover or focus.
 *
 * Measured on chatgpt.com (zh-CN, 2026-10-18): the picker trigger is a
 * `button[aria-haspopup=menu]` in the composer form whose `aria-label` is in
 * the site data's `modelPicker.triggerLabels`, and its visible text (without
 * the `aria-hidden` caption) is the selected effort, "Pro" for GPT-6 Pro.
 * Work mode has its own picker without a Pro step, so a trigger reading
 * Pro means chat mode with Pro selected.
 *
 * The ring is a sibling placed before the trigger, never a child: React owns
 * the button. The card hangs off `body` with fixed positioning, so no
 * composer `overflow` can clip it.
 */
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import type { ModelPickerSection } from '@/features/plugins/sites/sections/modelPickerData';
import type { SiteAdapter } from '@/features/plugins/types';
import { getCachedLocale, getTranslationSync } from '@/utils/i18n';

import { chatgptComposerRootOf } from '../chatgptComposerTargets';
import { findTrigger, mergedLabels, triggerText } from '../chatgptModelSelect/pickerDom';
import { type Allowance, TIER_NAMES } from './allowance';
import type { ProUsageSummary } from './usageStore';

export const PRO_USAGE_BADGE_ID = 'gv-chatgpt-pro-usage';
export const PRO_USAGE_CARD_ID = 'gv-chatgpt-pro-usage-card';
const RING_CLASS = 'gv-chatgpt-pro-usage';
const CARD_CLASS = 'gv-chatgpt-pro-usage-card';
/** The effort id the site data gives the Pro step. */
const PRO_EFFORT_ID = 'pro';
const SVG_NS = 'http://www.w3.org/2000/svg';
const RADIUS = 7;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** The shortest arc drawn for any use at all, so one send is visible. */
const MIN_ARC = 2.2;
const CARD_GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 8;

export interface RingView {
  readonly summary: ProUsageSummary;
  /** The denominator (see `resolveAllowance`); null draws no share. */
  readonly allowance: Allowance | null;
  readonly tier: AccountTier;
}

function pickerData(adapter: SiteAdapter | null): ModelPickerSection | null {
  return adapter?.modelPicker ?? chatgptAdapter.modelPicker ?? null;
}

function proLabels(data: ModelPickerSection): Set<string> {
  const table: Record<string, string[]> = {};
  for (const model of Object.values(data.models)) {
    for (const effort of model.efforts ?? []) {
      if (effort.id !== PRO_EFFORT_ID) continue;
      for (const [locale, labels] of Object.entries(effort.labels)) {
        table[locale] = [...(table[locale] ?? []), ...labels];
      }
    }
  }
  return mergedLabels(table);
}

/** The composer's picker trigger while it shows Pro, else null. */
export function findProTrigger(adapter: SiteAdapter | null): HTMLElement | null {
  const data = pickerData(adapter);
  if (!data) return null;
  const trigger = findTrigger(document, data);
  if (!trigger || !chatgptComposerRootOf(trigger, adapter)) return null;
  return proLabels(data).has(triggerText(trigger)) ? trigger : null;
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

function formatTime(ms: number): string {
  try {
    return new Intl.DateTimeFormat(getCachedLocale(), {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(ms);
  } catch {
    return new Date(ms).toLocaleString();
  }
}

/** What the ring draws and the card says. */
export function describeRing(view: RingView): {
  readonly ratio: number;
  readonly title: string;
  readonly detail: string;
} {
  const { summary, allowance } = view;
  const used = summary.usedThisWeek;
  let ratio = 0;
  let title: string;
  if (summary.blocked) {
    ratio = 1;
    title = getTranslationSync('chatgptProUsageNoneLeft');
  } else if (allowance) {
    ratio = Math.min(1, used / allowance.limit);
    title = fill(getTranslationSync('chatgptProUsageUsed'), { used, limit: allowance.limit });
  } else {
    title = fill(getTranslationSync('chatgptProUsageUsedCount'), { used });
  }
  const parts = [getTranslationSync('chatgptProUsageScope')];
  if (view.tier !== 'unknown') parts.unshift(TIER_NAMES[view.tier]);
  if (summary.resetsAt !== null) {
    parts.push(
      fill(getTranslationSync('chatgptProUsageResets'), { time: formatTime(summary.resetsAt) }),
    );
  }
  const detail = parts.join(' · ');
  return { ratio, title, detail };
}

export function isBadgeNode(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest(`#${PRO_USAGE_BADGE_ID}, #${PRO_USAGE_CARD_ID}`));
}

function svgElement(name: string, attributes: Record<string, string>): SVGElement {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function circle(className: string): SVGElement {
  return svgElement('circle', {
    class: className,
    cx: '9',
    cy: '9',
    r: String(RADIUS),
    fill: 'none',
    'stroke-width': '2',
  });
}

function hideCard(): void {
  document.getElementById(PRO_USAGE_CARD_ID)?.remove();
}

function showCard(ring: HTMLElement): void {
  let card = document.getElementById(PRO_USAGE_CARD_ID);
  if (!card) {
    card = document.createElement('div');
    card.id = PRO_USAGE_CARD_ID;
    card.className = CARD_CLASS;
    card.setAttribute('role', 'tooltip');
    const title = document.createElement('div');
    title.className = `${CARD_CLASS}-title`;
    const detail = document.createElement('div');
    detail.className = `${CARD_CLASS}-detail`;
    card.append(title, detail);
    document.body.append(card);
  }
  card.children[0].textContent = ring.dataset.gvTitle ?? '';
  card.children[1].textContent = ring.dataset.gvDetail ?? '';
  // Above the ring, right edges aligned, kept inside the viewport.
  const rect = ring.getBoundingClientRect();
  const width = card.offsetWidth;
  const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN_PX;
  card.style.left = `${Math.max(VIEWPORT_MARGIN_PX, Math.min(rect.right - width, maxLeft))}px`;
  card.style.bottom = `${window.innerHeight - rect.top + CARD_GAP_PX}px`;
}

function createRing(): HTMLElement {
  const ring = document.createElement('span');
  ring.id = PRO_USAGE_BADGE_ID;
  ring.className = RING_CLASS;
  ring.tabIndex = 0;
  ring.setAttribute('role', 'img');
  ring.setAttribute('aria-describedby', PRO_USAGE_CARD_ID);
  const svg = svgElement('svg', {
    width: '18',
    height: '18',
    viewBox: '0 0 18 18',
    'aria-hidden': 'true',
  });
  const arc = circle(`${RING_CLASS}-arc`);
  arc.setAttribute('stroke-linecap', 'round');
  // Start at 12 o'clock.
  arc.setAttribute('transform', 'rotate(-90 9 9)');
  svg.append(circle(`${RING_CLASS}-track`), arc);
  ring.append(svg);
  const show = (): void => showCard(ring);
  ring.addEventListener('mouseenter', show);
  ring.addEventListener('focus', show);
  ring.addEventListener('mouseleave', () => {
    if (document.activeElement !== ring) hideCard();
  });
  ring.addEventListener('blur', hideCard);
  return ring;
}

const ANCHOR_DEPTH = 6;

/**
 * The element the ring goes before: the trigger's ancestor that sits in a flex
 * row. ChatGPT wraps the trigger in a `display: contents` span inside a block
 * div (measured), so a ring placed beside the trigger itself lands on the line
 * above it.
 */
function ringAnchor(trigger: HTMLElement): HTMLElement {
  const root = chatgptComposerRootOf(trigger);
  let node: HTMLElement = trigger;
  for (let depth = 0; depth < ANCHOR_DEPTH; depth += 1) {
    const parent = node.parentElement;
    if (!parent || parent === root) break;
    const display = getComputedStyle(parent).display;
    if (display === 'flex' || display === 'inline-flex') return node;
    node = parent;
  }
  return trigger;
}

/** Show the ring right before `trigger`, or remove it (and its card) when there is none. */
export function renderBadge(trigger: HTMLElement | null, view: RingView | null): void {
  let ring = document.getElementById(PRO_USAGE_BADGE_ID);
  if (!trigger || !view) {
    ring?.remove();
    hideCard();
    return;
  }
  ring ??= createRing();
  const { ratio, title, detail } = describeRing(view);
  const arc = ring.querySelector(`.${RING_CLASS}-arc`);
  const length =
    ratio <= 0 ? 0 : Math.min(RING_CIRCUMFERENCE, Math.max(MIN_ARC, ratio * RING_CIRCUMFERENCE));
  const dash = `${length.toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`;
  if (arc && arc.getAttribute('stroke-dasharray') !== dash) {
    arc.setAttribute('stroke-dasharray', dash);
    // A zero-length dash with a round cap still paints a dot.
    arc.setAttribute('visibility', length > 0 ? 'visible' : 'hidden');
  }
  if (ring.getAttribute('aria-label') !== title) ring.setAttribute('aria-label', title);
  ring.dataset.gvTitle = title;
  ring.dataset.gvDetail = detail;
  if (document.getElementById(PRO_USAGE_CARD_ID)) showCard(ring);
  const anchor = ringAnchor(trigger);
  if (ring.nextElementSibling !== anchor) anchor.insertAdjacentElement('beforebegin', ring);
}
