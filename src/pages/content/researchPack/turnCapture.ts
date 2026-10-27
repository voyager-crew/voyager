/**
 * Read one Gemini answer into a research-pack draft.
 *
 * Runs only when the user clicks "Add to pack" on that answer: nothing here
 * observes or reads responses on its own.
 */
import {
  acceptsGeminiContentCollection,
  resolveGeminiAnswerElement,
} from '@/core/gemini/content/reads';
import {
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import {
  type ContentExtractor,
  createContentExtractor,
} from '@/features/export/services/DOMContentExtractor';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/research-pack-packaged.json';
import type { ResearchPackDraftItem } from '@/features/researchPack/services/types';

import { buildGeminiAdapter } from '../export/adapter/platform/gemini';
import { resolveExportAdapter } from '../export/adapter/platformAdapters';
import { readResearchActionBar, resolveResearchActionBars } from './actionTargets';

export const RESPONSE_HOST_SELECTOR = packaged['researchPack.host'];
const THOUGHTS_SELECTOR = packaged['researchPack.thoughts'];
/** Action bars hold share/feedback links, never sources. */
const ACTION_BAR_LINK_SCOPE = packaged['researchPack.actionLinkScope'];

/** The answer root is resolved before extraction, with the operation host fixed. */
export function resolveAnswerElement(host: HTMLElement): HTMLElement {
  return resolveGeminiAnswerElement(host, undefined, checkedCaptureView(host));
}

/**
 * The text the user selected inside this answer, or '' when the selection is
 * empty or lies (even partly) outside it.
 */
export function readSelectionWithin(answer: HTMLElement, selection: Selection | null): string {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return '';
  const range = selection.getRangeAt(0);
  if (!answer.contains(range.commonAncestorContainer)) return '';
  return selection.toString().trim();
}

/**
 * Every outbound link in the answer, including Gemini's source chips and
 * source list, which the Markdown extractor deliberately drops. Links inside
 * thoughts and the action bar are skipped; normalization happens later.
 */
export function collectAnswerLinks(
  host: HTMLElement,
  view: GeminiSelectorView = getGeminiSelectorView(),
): Array<{ url: string; title: string }> {
  const links: Array<{ url: string; title: string }> = [];
  const repairedBar = view.remoteKeys.has('researchPack.actionBars')
    ? resolveResearchActionBars([host], view)[0]
    : null;
  for (const anchor of Array.from(host.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (
      anchor.closest(THOUGHTS_SELECTOR) ||
      anchor.closest(ACTION_BAR_LINK_SCOPE) ||
      repairedBar?.contains(anchor)
    )
      continue;
    const href = anchor.getAttribute('href') ?? '';
    if (!href || href.startsWith('#')) continue;
    const title =
      anchor.getAttribute('aria-label') || anchor.textContent || anchor.getAttribute('title') || '';
    links.push({ url: anchor.href || href, title });
  }
  return links;
}

function readPrompt(
  userQuery: HTMLElement | null | undefined,
  extractor: ContentExtractor,
): string {
  if (!userQuery) return '';
  try {
    const text = extractor.extractUserContent(userQuery).text;
    if (text.trim()) return text;
  } catch {
    // Fall through to the visible text.
  }
  return userQuery.textContent ?? '';
}

function readAnswerMarkdown(answer: HTMLElement, extractor: ContentExtractor): string {
  try {
    const text = extractor.extractAssistantContent(answer).text;
    if (text.trim()) return text;
  } catch {
    // Fall through to the visible text.
  }
  return answer.innerText || answer.textContent || '';
}

function checkedCaptureView(host: HTMLElement, userQuery?: HTMLElement | null): GeminiSelectorView {
  const current = getGeminiSelectorView();
  if (
    !(['content.answer', 'content.userLines', 'researchPack.actionBars'] as const).some((key) =>
      current.remoteKeys.has(key),
    )
  )
    return current;
  const prompt =
    userQuery ??
    host
      .closest(packaged['researchPack.conversation'])
      ?.querySelector<HTMLElement>(packaged['researchPack.user']);
  // One rejected prompt/answer locator must not leave the paired draft on a mixed profile.
  return resolveGeminiSelectorOperationInView(
    current,
    (candidate) => candidate,
    (candidate) =>
      acceptsGeminiContentCollection(prompt ? [prompt] : [], [host], candidate) &&
      (!candidate.remoteKeys.has('researchPack.actionBars') ||
        readResearchActionBar(host, candidate) === resolveResearchActionBars([host], candidate)[0]),
  ).value;
}

/**
 * Build the draft for one answer. `selectedText`, when non-empty, replaces the
 * whole answer so the user can add only the part that matters.
 */
export function captureAnswer(host: HTMLElement, selectedText: string): ResearchPackDraftItem {
  const originalAdapter = resolveExportAdapter();
  const container = host.closest(packaged['researchPack.conversation']);
  const userQuery = container?.querySelector<HTMLElement>(packaged['researchPack.user']);
  const view = checkedCaptureView(host, userQuery);
  const adapter =
    originalAdapter.site.id === 'gemini'
      ? buildGeminiAdapter(originalAdapter.site, view)
      : originalAdapter;
  const extractor = createContentExtractor(adapter);

  const answer = resolveGeminiAnswerElement(host, undefined, view);
  const excerpt = selectedText.length > 0;
  return {
    text: excerpt ? selectedText : readAnswerMarkdown(answer, extractor),
    excerpt,
    prompt: readPrompt(userQuery, extractor),
    sourceTitle: adapter.extractConversationTitle(),
    sourceUrl: window.location.href,
    platform: adapter.site.id,
    citations: collectAnswerLinks(host, view),
  };
}
