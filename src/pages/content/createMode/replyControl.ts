/**
 * The control under one plugin code block in a Create chat: Voyager's mark and
 * name, then one button named for the action, or the block's state. Its UI
 * lives in a shadow root, so the reply's text, copy and export never read it,
 * and it paints from the page-level `--gv-ui-*` tokens in either scheme.
 */
import { GV_RTL_CLASS } from '@/core/utils/rtl';
import { isUserEvent } from '@/core/utils/userEvent';
import type { CreationCandidate } from '@/features/plugins/local/creation/types';
import { getTranslationSync } from '@/utils/i18n';
import type { TranslationKey } from '@/utils/translations';

export const REPLY_CONTROL_CLASS = 'gv-create-control';
const MARK = 'mascot-logo.png';

export type ReplyControlAction = 'preview' | 'problems';

type ControlView =
  | { readonly kind: 'action'; readonly action: ReplyControlAction; readonly label: TranslationKey }
  | { readonly kind: 'status'; readonly label: TranslationKey; readonly done: boolean };

/** What a block offers: only the latest block per plugin id acts. */
function controlView(candidate: CreationCandidate): ControlView {
  if (!candidate.latest) return { kind: 'status', label: 'createModeEarlierVersion', done: false };
  const { verdict } = candidate;
  if (verdict.kind === 'rejected')
    return { kind: 'action', action: 'problems', label: 'createModeSendProblems' };
  switch (verdict.install.kind) {
    case 'new':
      return { kind: 'action', action: 'preview', label: 'createModePreviewInstall' };
    case 'update':
      return { kind: 'action', action: 'preview', label: 'createModePreviewUpdate' };
    case 'installed':
      return { kind: 'status', label: 'createModeInstalledChip', done: true };
  }
}

/*
 * Hosts ship a `* { margin: 0 }` reset, and page rules beat `:host`, so the
 * gap from the code block is padding inside the shadow root, out of their reach.
 */
const SHADOW_CSS = `
:host { display: block; }
.bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px;
  padding-block: 14px 10px;
  color: var(--gv-ui-text, inherit);
  font: 400 14px/1.4 var(--gv-ui-font, system-ui, sans-serif);
}
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
.brand img {
  width: 22px; height: 22px; border-radius: 50%; flex: none;
  object-fit: cover; object-position: left bottom;
  background: var(--gv-ui-primary, oklch(0.601 0.1 140));
}
.state { display: inline-flex; align-items: center; gap: 6px; color: var(--gv-ui-text-muted, inherit); }
.state svg { width: 16px; height: 16px; flex: none; }
.state.done svg { color: var(--gv-ui-primary, currentColor); }
.state.problem svg { color: var(--gv-ui-warning, currentColor); }
button {
  box-sizing: border-box; height: 32px; margin: 0; padding: 0 14px;
  border: 1px solid transparent; border-radius: 9px;
  background: var(--gv-ui-primary, oklch(0.601 0.1 140));
  color: var(--gv-ui-primary-fg, #fff);
  font: 500 14px/1 var(--gv-ui-font, system-ui, sans-serif);
  white-space: nowrap; cursor: pointer;
  transition: transform 150ms ease-out, filter 150ms ease;
}
button.quiet { background: color-mix(in srgb, currentColor 10%, transparent); color: inherit; }
@media (hover: hover) { button:hover { filter: brightness(0.94); } }
button:active { transform: scale(0.96); }
button:focus-visible {
  outline: 2px solid var(--gv-ui-focus-ring, currentColor); outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) { button { transition: none; } }
`;

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  check: ['M20 6 9 17l-5-5'],
  alert: [
    'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
    'M12 9v4',
    'M12 17h.01',
  ],
};

/** Built node by node: Gemini enforces Trusted Types, so no markup strings. */
function icon(doc: Document, name: keyof typeof ICONS): SVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  const attributes = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  };
  for (const [key, value] of Object.entries(attributes)) svg.setAttribute(key, value);
  for (const d of ICONS[name]) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** The extension's copy of the mark, or nothing once the extension context is gone. */
function markUrl(): string | null {
  try {
    const url = chrome.runtime.getURL(MARK);
    return typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
}

function state(doc: Document, kind: 'done' | 'problem' | 'earlier', text: string): HTMLElement {
  const element = doc.createElement('span');
  element.className = `state ${kind}`;
  if (kind !== 'earlier') element.append(icon(doc, kind === 'done' ? 'check' : 'alert'));
  element.append(text);
  return element;
}

export interface ReplyControl {
  readonly host: HTMLElement;
  show(candidate: CreationCandidate): void;
  relabel(): void;
}

export function createReplyControl(
  doc: Document,
  onAction: (action: ReplyControlAction, candidate: CreationCandidate) => void,
): ReplyControl {
  const host = doc.createElement('div');
  host.className = REPLY_CONTROL_CLASS;
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = SHADOW_CSS;
  const bar = doc.createElement('div');
  bar.className = 'bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Voyager');
  const brand = doc.createElement('span');
  brand.className = 'brand';
  const url = markUrl();
  if (url) {
    const mark = doc.createElement('img');
    mark.src = url;
    mark.alt = '';
    mark.width = 22;
    mark.height = 22;
    mark.addEventListener('error', () => mark.remove());
    brand.append(mark);
  }
  const name = doc.createElement('span');
  name.textContent = 'Voyager';
  name.setAttribute('aria-hidden', 'true');
  brand.append(name);
  root.append(style, bar);
  let current: CreationCandidate | null = null;

  const render = (): void => {
    if (!current) return;
    const candidate = current;
    const view = controlView(candidate);
    // Voyager's language may read right to left on a page that does not.
    if (doc.body?.classList.contains(GV_RTL_CLASS)) bar.dir = 'rtl';
    else bar.removeAttribute('dir');
    const parts: HTMLElement[] = [brand];
    if (view.kind === 'status') {
      parts.push(state(doc, view.done ? 'done' : 'earlier', getTranslationSync(view.label)));
    } else {
      if (view.action === 'problems') {
        parts.push(state(doc, 'problem', getTranslationSync('createModeRejectedNote')));
      }
      const button = doc.createElement('button');
      button.type = 'button';
      if (view.action === 'problems') button.className = 'quiet';
      button.textContent = getTranslationSync(view.label);
      button.addEventListener('click', (event) => {
        // A page script's synthetic click must not open a review or write the composer.
        if (!isUserEvent(event)) return;
        onAction(view.action, candidate);
      });
      parts.push(button);
    }
    bar.replaceChildren(...parts);
  };

  return {
    host,
    show(candidate) {
      const same =
        current?.latest === candidate.latest &&
        current.text === candidate.text &&
        JSON.stringify(current.verdict) === JSON.stringify(candidate.verdict);
      current = candidate;
      if (!same) render();
    },
    relabel: render,
  };
}
