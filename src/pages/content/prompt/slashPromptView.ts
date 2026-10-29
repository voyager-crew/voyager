/**
 * The completion drawn past the caret: the rest of the selected prompt's name,
 * greyed, so the reader sees what Tab or Enter would complete to.
 */
import type { PromptScheme } from '@/features/prompt/PromptSiteAdapter';

import { type PromptQuery, createQueryRange, getQueryAnchorRect } from './slashComposerText';
import { syncMarkerTypography } from './slashMarkers';
import { ghostSuffix } from './slashMatch';

const GHOST_ID = 'gv-pm-slash-ghost';

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

export function removeGhost(): void {
  document.getElementById(GHOST_ID)?.remove();
}

/** The result list under the typed query, or above it when there is more room there. */
export function placeResultList(
  root: HTMLElement,
  list: HTMLElement,
  query: PromptQuery,
  input: HTMLElement,
): void {
  const rect = input.getBoundingClientRect();
  const anchorRect = getQueryAnchorRect(query, rect);
  const width = Math.max(120, Math.min(380, rect.width || 320, window.innerWidth - 16));
  root.style.width = `${Math.round(width)}px`;
  root.style.left = `${Math.round(
    Math.max(8, Math.min(anchorRect.left, window.innerWidth - width - 8)),
  )}px`;
  const listHeight = list.getBoundingClientRect().height || 240;
  const below = anchorRect.bottom + 6;
  const above = anchorRect.top - listHeight - 6;
  const spaceBelow = window.innerHeight - below - 8;
  const spaceAbove = anchorRect.top - 14;
  const preferredTop = spaceBelow >= listHeight || spaceBelow >= spaceAbove ? below : above;
  const maxTop = Math.max(8, window.innerHeight - listHeight - 8);
  root.style.top = `${Math.round(Math.max(8, Math.min(preferredTop, maxTop)))}px`;
}
