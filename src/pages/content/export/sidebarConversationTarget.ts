import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import {
  geminiSidebarSelector,
  resolveGeminiSidebarOperation,
} from '@/core/gemini/sidebar/queries';
import { geminiTitleSelectors } from '@/core/gemini/sidebar/titleProof';

import { isUsableSidebarObservationRow } from '../folder/sidebarConversationQueries';

export type SidebarConversationTarget = {
  conversationId: string;
  url: string;
  title: string | null;
};

type ConversationCandidate = SidebarConversationTarget & {
  element: HTMLElement;
};

const SIDEBAR_CONVERSATION_SELECTOR = '[data-test-id="conversation"]';
const FOREIGN_ROW_OWNER =
  'main, [role="main"], form, dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [contenteditable]:not([contenteditable="false"])';

function normalizeText(value: string | null | undefined): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeConversationId(value: string | null | undefined): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  return raw.replace(/^c_/i, '');
}

function extractConversationIdFromPath(pathname: string): string | null {
  const appMatch = pathname.match(/\/app\/([^/?#]+)/);
  if (appMatch?.[1]) return normalizeConversationId(appMatch[1]);
  const gemMatch = pathname.match(/\/gem\/[^/]+\/([^/?#]+)/);
  if (gemMatch?.[1]) return normalizeConversationId(gemMatch[1]);
  return null;
}

function extractConversationIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, window.location.origin);
    return extractConversationIdFromPath(url.pathname);
  } catch {
    return null;
  }
}

function extractConversationIdFromJslog(value: string | null | undefined): string | null {
  const raw = String(value || '');
  const match = raw.match(/\bc_([a-zA-Z0-9_-]+)/);
  return normalizeConversationId(match?.[1] || null);
}

function parseTitleHintFromAriaLabel(label: string | null | undefined): string | null {
  const raw = normalizeText(label);
  const match = raw.match(/^More options for\s+(.+)$/i);
  return match?.[1] ? normalizeText(match[1]) : null;
}

function readTitleFromConversationScope(scope: HTMLElement): string | null {
  // This title participates in picking a navigation target, so it is identity evidence.
  const bySelector = scope.querySelector(geminiTitleSelectors('title.export', scope).join(', '));
  const selectorTitle = normalizeText(bySelector?.textContent);
  if (selectorTitle) return selectorTitle;

  const link = scope.matches('a') ? (scope as HTMLAnchorElement) : scope.querySelector('a');
  const ariaLabel = normalizeText(link?.getAttribute('aria-label'));
  if (ariaLabel) return ariaLabel;
  const titleAttr = normalizeText(link?.getAttribute('title'));
  if (titleAttr) return titleAttr;

  const text = normalizeText(scope.textContent);
  return text || null;
}

function getCandidateFromScope(scope: HTMLElement): ConversationCandidate | null {
  const link = (
    scope.matches('a[href]') ? scope : scope.querySelector('a[href]')
  ) as HTMLAnchorElement | null;

  const href = link?.href || '';
  const idFromHref = extractConversationIdFromHref(href);
  const idFromJslog =
    extractConversationIdFromJslog(scope.getAttribute('jslog')) ||
    extractConversationIdFromJslog(link?.getAttribute('jslog'));
  const conversationId = idFromHref || idFromJslog;
  if (!conversationId) return null;

  const title = readTitleFromConversationScope(scope);
  const url = href || `${window.location.origin}/app/${conversationId}`;

  return {
    conversationId,
    url,
    title,
    element: scope,
  };
}

/** A renamed row must retain the native link, account and jslog identity protocol. */
function nativeLinkedConversationRow(
  link: HTMLAnchorElement,
  bundled: GeminiSelectorView,
): HTMLElement | null {
  if (hasVoyagerOwner(link) || link.closest(FOREIGN_ROW_OWNER)) return null;
  // Surviving native rows already have exact element identity; a nested alias cannot replace one.
  if (link.closest(geminiSidebarSelector('sidebar.row', bundled))) return null;
  let row: HTMLElement | null = link;
  // Generic click instrumentation on the anchor must not shadow its conversation's c_ID owner.
  while (row && !extractConversationIdFromJslog(row.getAttribute('jslog'))) row = row.parentElement;
  if (!row) return null;
  const sidebar = row.closest(
    `${geminiSidebarSelector('sidebar.host', bundled)}, nav, aside, [role="navigation"]`,
  );
  if (!sidebar || sidebar === row) return null;
  // Virtualized hidden rows must not win the nearest-title fallback for a visible menu.
  for (let owner: HTMLElement | null = link; owner; owner = owner.parentElement) {
    if (owner.hidden || owner.getAttribute('aria-hidden') === 'true') return null;
    const style = getComputedStyle(owner);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.contentVisibility === 'hidden'
    )
      return null;
  }

  let url: URL;
  try {
    url = new URL(link.href, window.location.href);
  } catch {
    return null;
  }
  const route = url.pathname.match(/^(\/u\/\d+)?\/(?:app|gem\/[^/]+)\/([^/?#]+)\/?$/);
  const account = window.location.pathname.match(/^\/u\/\d+(?=\/)/)?.[0] ?? '';
  if (
    url.origin !== window.location.origin ||
    !route ||
    (route[1] ?? '') !== account ||
    extractConversationIdFromJslog(row.getAttribute('jslog')) !== route[2]
  )
    return null;

  const links = row === link ? [link] : Array.from(row.querySelectorAll('a[href]'));
  return links.length === 1 && links[0] === link ? row : null;
}

function readConversationScopes(): HTMLElement[] {
  return (
    resolveGeminiSidebarOperation(
      (view) => {
        const scopes = Array.from(
          document.querySelectorAll<HTMLElement>(geminiSidebarSelector('sidebar.row', view)),
        );
        if (!view.remoteKeys.has('sidebar.row')) return scopes;

        const bundled = getBundledGeminiSelectorView();
        const expected = new Set(
          document.querySelectorAll<HTMLElement>(geminiSidebarSelector('sidebar.row', bundled)),
        );
        for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
          const row = nativeLinkedConversationRow(link, bundled);
          if (row) expected.add(row);
        }
        // A partial alias would make a nearby menu export a different conversation.
        return scopes.length === expected.size &&
          scopes.every((row) => expected.has(row) && isUsableSidebarObservationRow(row, view))
          ? scopes
          : null;
      },
      (scopes) => scopes !== null && scopes.length > 0,
    ).value ?? []
  );
}

function collectConversationCandidates(): ConversationCandidate[] {
  const scopes = readConversationScopes();
  const out: ConversationCandidate[] = [];

  scopes.forEach((scope) => {
    const candidate = getCandidateFromScope(scope);
    if (candidate) out.push(candidate);
  });

  return out;
}

function pickNearestByVerticalDistance(
  trigger: HTMLElement,
  candidates: ConversationCandidate[],
): ConversationCandidate | null {
  if (candidates.length === 0) return null;
  const triggerRect = trigger.getBoundingClientRect();
  const triggerCenterY = triggerRect.top + triggerRect.height / 2;

  let best: ConversationCandidate | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const rect = candidate.element.getBoundingClientRect();
    const candidateCenterY = rect.top + rect.height / 2;
    const distance = Math.abs(candidateCenterY - triggerCenterY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

function resolveConversationCandidate(trigger: HTMLElement): ConversationCandidate | null {
  const directScope = trigger.closest(SIDEBAR_CONVERSATION_SELECTOR) as HTMLElement | null;
  if (directScope) {
    const direct = getCandidateFromScope(directScope);
    if (direct) return direct;
  }

  const candidates = collectConversationCandidates();
  if (candidates.length === 0) return null;

  const titleHint = parseTitleHintFromAriaLabel(trigger.getAttribute('aria-label'));
  if (titleHint) {
    const normalizedHint = titleHint.toLocaleLowerCase();
    const titleMatched = candidates.filter((candidate) => {
      const title = normalizeText(candidate.title).toLocaleLowerCase();
      return title.length > 0 && title === normalizedHint;
    });
    const picked = pickNearestByVerticalDistance(trigger, titleMatched);
    if (picked) return picked;
  }

  return pickNearestByVerticalDistance(trigger, candidates);
}

export function resolveSidebarConversationTarget(
  trigger: HTMLElement,
): SidebarConversationTarget | null {
  const candidate = resolveConversationCandidate(trigger);
  return candidate
    ? { conversationId: candidate.conversationId, url: candidate.url, title: candidate.title }
    : null;
}

/** Use the proven row's native SPA link when a renamed row no longer matches the ID lookup. */
export function findRepairedSidebarConversationLink(
  trigger: HTMLElement,
  conversationId: string,
): HTMLAnchorElement | null {
  if (!getGeminiSelectorView().remoteKeys.has('sidebar.row')) return null;
  const candidate = resolveConversationCandidate(trigger);
  if (!candidate || candidate.conversationId !== conversationId) return null;
  return candidate.element instanceof HTMLAnchorElement
    ? candidate.element
    : candidate.element.querySelector<HTMLAnchorElement>('a[href]');
}
