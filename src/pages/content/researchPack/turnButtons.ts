/**
 * The per-answer "Add to pack" button.
 *
 * The button is Voyager's own element appended once to the end of Gemini's
 * action bar. It is never cloned from a native button (Gemini's icon font has
 * broken cloned icons before, see #711) and never repositioned on later
 * mutations, so it cannot fight the copy-as-image button, which keeps itself
 * right before the "more" button.
 */
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/research-pack-packaged.json';

import { resolveResearchActionBars } from './actionTargets';
import { RESPONSE_HOST_SELECTOR, readSelectionWithin, resolveAnswerElement } from './turnCapture';

export const ADD_BUTTON_CLASS = 'gv-rp-add-btn';

const DEEP_RESEARCH_PANEL_SELECTOR = packaged['researchPack.deepResearch'];

// Material Symbols "playlist_add" (viewBox 0 -960 960 960), inline so it never
// depends on the page's icon font.
const ADD_ICON_PATH =
  'M120-320v-80h280v80H120Zm0-160v-80h440v80H120Zm0-160v-80h440v80H120Zm520 480v-160H480v-80h160v-160h80v160h160v80H720v160h-80Z';

export interface AddButtonOptions {
  label: string;
  /** `selectedText` is the user's selection inside this answer, or ''. */
  onAdd: (host: HTMLElement, selectedText: string, button: HTMLButtonElement) => void;
}

function createAddButton(options: AddButtonOptions): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = ADD_BUTTON_CLASS;
  button.setAttribute('aria-label', options.label);
  button.title = options.label;

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 -960 960 960');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(svgNs, 'path');
  path.setAttribute('d', ADD_ICON_PATH);
  svg.appendChild(path);
  button.appendChild(svg);

  // Pressing a button can collapse the page selection before `click` fires.
  // Read it on press and keep the press from moving focus or the selection.
  let pressedSelection = '';
  button.addEventListener('mousedown', (event) => {
    const host = button.closest<HTMLElement>(RESPONSE_HOST_SELECTOR);
    pressedSelection = host
      ? readSelectionWithin(resolveAnswerElement(host), window.getSelection())
      : '';
    event.preventDefault();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const host = button.closest<HTMLElement>(RESPONSE_HOST_SELECTOR);
    if (!host) return;
    const selected =
      pressedSelection || readSelectionWithin(resolveAnswerElement(host), window.getSelection());
    pressedSelection = '';
    options.onAdd(host, selected, button);
  });
  return button;
}

/**
 * Give every finished answer under `root` one Add button. Answers still
 * streaming have no action bar yet and are picked up on a later pass.
 * Returns how many buttons were added.
 */
export function ensureAddButtons(root: ParentNode, options: AddButtonOptions): number {
  let added = 0;
  const hosts = Array.from(root.querySelectorAll<HTMLElement>(RESPONSE_HOST_SELECTOR)).filter(
    (host) =>
      !host.closest(DEEP_RESEARCH_PANEL_SELECTOR) && !host.querySelector(`.${ADD_BUTTON_CLASS}`),
  );
  const bars = resolveResearchActionBars(hosts);
  for (const bar of bars) {
    if (!bar) continue;
    bar.appendChild(createAddButton(options));
    added += 1;
  }
  return added;
}

export function updateAddButtonLabels(root: ParentNode, label: string): void {
  for (const button of Array.from(root.querySelectorAll<HTMLElement>(`.${ADD_BUTTON_CLASS}`))) {
    button.setAttribute('aria-label', label);
    button.title = label;
  }
}

export function removeAddButtons(root: ParentNode): void {
  root.querySelectorAll(`.${ADD_BUTTON_CLASS}`).forEach((button) => button.remove());
}
