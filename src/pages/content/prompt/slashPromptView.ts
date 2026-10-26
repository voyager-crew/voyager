import type { PromptScheme } from '@/features/prompt/PromptSiteAdapter';

import { type PromptQuery, createQueryRange } from './slashComposerText';
import { syncMarkerTypography } from './slashMarkers';
import { ghostSuffix } from './slashMatch';
export const GHOST_ID = 'gv-pm-slash-ghost';

function ghostElement(): HTMLElement {
  const existing = document.getElementById(GHOST_ID);
  if (existing) return existing;
  const ghost = document.createElement('span');
  ghost.id = GHOST_ID;
  ghost.className = GHOST_ID;
  ghost.setAttribute('aria-hidden', 'true');
  document.body.appendChild(ghost);
  return ghost;
}

export function hideGhost(): void {
  document.getElementById(GHOST_ID)?.classList.remove('gv-pm-slash-ghost-visible');
}

export function showGhost(query: PromptQuery, name: string, scheme: PromptScheme): void {
  const suffix = ghostSuffix(query.query, name);
  const range = createQueryRange(query);
  // A textarea has no range to measure against, and the query may be scrolled
  // out of view inside the composer.
  if (!suffix || !range || typeof range.getBoundingClientRect !== 'function') {
    hideGhost();
    return;
  }
  const rect = range.getBoundingClientRect();
  if (rect.height <= 0) {
    hideGhost();
    return;
  }
  const ghost = ghostElement();
  ghost.textContent = suffix;
  ghost.dataset.gvTheme = scheme;
  syncMarkerTypography(ghost, query.input, null);
  ghost.style.left = `${Math.round(rect.right)}px`;
  ghost.style.top = `${Math.round(rect.top)}px`;
  ghost.style.height = `${Math.round(rect.height)}px`;
  ghost.classList.add('gv-pm-slash-ghost-visible');
}
