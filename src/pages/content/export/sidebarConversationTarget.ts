import { geminiTitleSelectors } from '@/core/gemini/sidebar/titleProof';

export type SidebarConversationTarget = {
  conversationId: string;
  url: string;
  title: string | null;
};

type ConversationCandidate = SidebarConversationTarget & {
  element: HTMLElement;
};

const SIDEBAR_CONVERSATION_SELECTOR = '[data-test-id="conversation"]';

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

function collectConversationCandidates(): ConversationCandidate[] {
  const scopes = Array.from(document.querySelectorAll<HTMLElement>(SIDEBAR_CONVERSATION_SELECTOR));
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

export function resolveSidebarConversationTarget(
  trigger: HTMLElement,
): SidebarConversationTarget | null {
  const directScope = trigger.closest(SIDEBAR_CONVERSATION_SELECTOR) as HTMLElement | null;
  if (directScope) {
    const direct = getCandidateFromScope(directScope);
    if (direct) {
      return {
        conversationId: direct.conversationId,
        url: direct.url,
        title: direct.title,
      };
    }
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
    if (picked) {
      return {
        conversationId: picked.conversationId,
        url: picked.url,
        title: picked.title,
      };
    }
  }

  const nearest = pickNearestByVerticalDistance(trigger, candidates);
  if (!nearest) return null;
  return {
    conversationId: nearest.conversationId,
    url: nearest.url,
    title: nearest.title,
  };
}
