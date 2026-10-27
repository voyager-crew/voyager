import { GEMINI_PACKAGED_CONTENT } from '@/core/gemini/content/packaged';
import { getGeminiTurnView, type GeminiTurnView } from '@/core/gemini/selectors';
import { getGeminiTurnSelectors } from '@/core/gemini/turnSelectors';
import type { TimelineMarker } from '@/features/timeline/types';

import { readServerTurnId } from '../fork/turnId';
import { planTimelineTurnIds, type TimelineTurnIdAssignment } from './timelineTurnIds';

interface TextSnapshot {
  readonly raw: string;
  readonly summary: string;
}

export interface TimelineTurnPlan {
  readonly mountedCount: number;
  readonly markers: TimelineMarker[];
  readonly ids: readonly TimelineTurnIdAssignment[];
  readonly userText: ReadonlyMap<HTMLElement, TextSnapshot>;
  readonly assistantText: ReadonlyMap<HTMLElement, TextSnapshot>;
}

/** Accessibility prefixes injected by Gemini's DOM that should be stripped from previews effectively globally. */
// Anchored to the start, so it only strips leading invisible characters and can
// never split an emoji sequence in the label body.
const TURN_LABEL_PREFIXES =
  // oxlint-disable-next-line no-misleading-character-class
  /^[\u200B\u200C\u200D\u200E\u200F\uFEFF]*(?:you said|you wrote|user message|your prompt|you asked)[:\s]*/i;
const VISUALLY_HIDDEN_CLASS_FRAGMENT = 'visually-hidden';
const INJECTED_UI_SELECTOR = '.gv-fork-btn, .gv-fork-indicator-group';
const ASSISTANT_PREVIEW_CONTENT_SELECTOR =
  GEMINI_PACKAGED_CONTENT['content.timelinePreview'].join(',');
const ASSISTANT_PREVIEW_EXCLUDED_SELECTOR =
  'model-thoughts, .thoughts-container, .thoughts-content, deep-research-immersive-panel';

/** Reads Gemini turn text and preserves identity across DOM remounts. */
export class TimelineTurns {
  private readonly turnIdByIndex = new Map<number, string>();

  plan(
    container: HTMLElement,
    selector: string,
    previousMarkers: readonly TimelineMarker[] = [],
    view: GeminiTurnView = getGeminiTurnView(),
  ): TimelineTurnPlan {
    const userText = new Map<HTMLElement, TextSnapshot>();
    const assistantText = new Map<HTMLElement, TextSnapshot>();
    const rawElements = Array.from(container.querySelectorAll(selector));
    const mountedCount = rawElements.length;
    let elements = this.filterTopLevel(rawElements);
    if (elements.length === 0) {
      return { mountedCount, markers: [], ids: [], userText, assistantText };
    }
    const readText = (element: HTMLElement): string => {
      const raw = element.textContent || '';
      const cached = userText.get(element) ?? this.turnTextCache.get(element);
      if (cached?.raw === raw) return cached.summary;
      const summary = this.extractTurnText(element);
      userText.set(element, { raw, summary });
      return summary;
    };
    // `offsetTop` is relative to each turn's own positioned wrapper, the same for every turn, so
    // repeated prompts ("continue") collapsed into one marker; measure within the conversation.
    const contentTop = container.getBoundingClientRect().top - container.scrollTop;
    const offsets = new Map(
      elements.map((element) => [element, element.getBoundingClientRect().top - contentTop]),
    );
    const offsetOf = (element: HTMLElement): number => offsets.get(element) ?? 0;
    const firstOffset = offsetOf(elements[0]);
    elements = this.dedupeByTextAndOffset(elements, firstOffset, offsetOf, readText);
    const span = Math.max(1, offsetOf(elements[elements.length - 1]) - firstOffset);
    const summaries = this.collectAssistantSummaries(elements, container, view, assistantText);
    const ids = planTimelineTurnIds(
      elements.map((element) => ({
        element,
        serverId: readServerTurnId(element),
        existingId: element.dataset?.turnId?.trim() || '',
        summary: readText(element),
      })),
      { turnIdByIndex: new Map(this.turnIdByIndex), previousMarkers },
    );
    const markers = elements.map((element, index) => ({
      id: ids[index].id,
      element,
      summary: readText(element),
      assistantSummary: summaries.get(element) ?? '',
      baseN: Math.max(0, Math.min(1, (offsetOf(element) - firstOffset) / span)),
      starred: false,
    }));
    return { mountedCount, markers, ids, userText, assistantText };
  }

  commit(plan: TimelineTurnPlan): TimelineMarker[] {
    plan.ids.forEach(({ element, index, id, writeDom }) => {
      if (writeDom) {
        try {
          if (element.dataset) element.dataset.turnId = id;
        } catch {}
      }
      this.turnIdByIndex.set(index, id);
    });
    plan.userText.forEach((text, element) => this.turnTextCache.set(element, text));
    plan.assistantText.forEach((text, element) => this.assistantTextCache.set(element, text));
    return plan.markers;
  }
  private normalizeText(text: string | null): string {
    try {
      if (!text) return '';
      // 1. Collapse whitespace
      const collapsed = String(text).replace(/\s+/g, ' ').trim();
      // 2. Strip prefixes (You said, etc.)
      return collapsed.replace(TURN_LABEL_PREFIXES, '');
    } catch {
      return '';
    }
  }

  private hasVisuallyHiddenClass(el: Element): boolean {
    if (!(el instanceof HTMLElement) || el.classList.length === 0) return false;
    for (const cls of el.classList) {
      if (cls.toLowerCase().includes(VISUALLY_HIDDEN_CLASS_FRAGMENT)) return true;
    }
    return false;
  }

  // extractTurnText deep-clones the turn subtree, so it must not run for
  // every turn on every debounced recalc — during streaming that meant
  // re-cloning the whole conversation every 200ms. Cache per element,
  // validated against the element's current raw textContent: any in-place
  // change (user edit, late LaTeX render, injected UI) alters the raw text
  // and recomputes. WeakMap entries die with their DOM nodes; nothing is
  // persisted to storage.
  private turnTextCache = new WeakMap<HTMLElement, { raw: string; summary: string }>();

  getTurnTextCached(element: HTMLElement | null): string {
    if (!element) return '';
    const raw = element.textContent || '';
    const cached = this.turnTextCache.get(element);
    if (cached && cached.raw === raw) return cached.summary;
    const summary = this.extractTurnText(element);
    this.turnTextCache.set(element, { raw, summary });
    return summary;
  }

  private extractTurnText(element: HTMLElement | null): string {
    if (!element) return '';
    try {
      const clone = element.cloneNode(true) as HTMLElement;
      if (this.hasVisuallyHiddenClass(clone)) return '';

      // Remove visually-hidden descendants
      const descendants = clone.getElementsByTagName('*');
      for (let i = descendants.length - 1; i >= 0; i--) {
        if (this.hasVisuallyHiddenClass(descendants[i])) {
          descendants[i].remove();
        }
      }

      // Remove extension-injected UI elements (e.g. fork button)
      clone.querySelectorAll(INJECTED_UI_SELECTOR).forEach((el) => el.remove());

      // Restore original text for LaTeX-rendered elements
      clone.querySelectorAll<HTMLElement>('[data-user-latex-original]').forEach((el) => {
        el.textContent = el.dataset.userLatexOriginal ?? '';
      });

      return this.normalizeText(clone.textContent || '');
    } catch {
      return this.normalizeText(element.textContent || '');
    }
  }

  private assistantTextCache = new WeakMap<HTMLElement, { raw: string; summary: string }>();

  private getAssistantTextCached(
    element: HTMLElement,
    pending: Map<HTMLElement, TextSnapshot>,
  ): string {
    const raw = element.textContent || '';
    const cached = pending.get(element) ?? this.assistantTextCache.get(element);
    if (cached && cached.raw === raw) return cached.summary;

    const summary = this.extractAssistantText(element);
    pending.set(element, { raw, summary });
    return summary;
  }

  private extractAssistantText(element: HTMLElement): string {
    try {
      const preferred = Array.from(
        element.querySelectorAll<HTMLElement>(ASSISTANT_PREVIEW_CONTENT_SELECTOR),
      ).find((candidate) => !candidate.closest(ASSISTANT_PREVIEW_EXCLUDED_SELECTOR));
      const clone = (preferred ?? element).cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll(
          `${ASSISTANT_PREVIEW_EXCLUDED_SELECTOR}, ${INJECTED_UI_SELECTOR}, button, [role="button"]`,
        )
        .forEach((node) => node.remove());
      clone.querySelectorAll('*').forEach((node) => {
        if (this.hasVisuallyHiddenClass(node)) node.remove();
      });
      return this.normalizeText(clone.textContent || '');
    } catch {
      return this.normalizeText(element.textContent || '');
    }
  }

  /** Pair each mounted user turn with the first model response before the next user turn. */
  private collectAssistantSummaries(
    userTurns: HTMLElement[],
    conversationContainer: HTMLElement,
    view: GeminiTurnView,
    pending: Map<HTMLElement, TextSnapshot>,
  ): Map<HTMLElement, string> {
    const summaries = new Map<HTMLElement, string>();
    if (!conversationContainer || userTurns.length === 0) return summaries;

    const assistantCandidates = Array.from(
      conversationContainer.querySelectorAll<HTMLElement>(
        getGeminiTurnSelectors('turn.assistant', view).join(','),
      ),
    ).filter(
      (candidate) =>
        !candidate.closest('deep-research-immersive-panel') &&
        !userTurns.some((userTurn) => userTurn.contains(candidate)),
    );
    const assistants = this.filterTopLevel(assistantCandidates);
    let assistantIndex = 0;

    const isBefore = (first: Node, second: Node): boolean =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

    for (let index = 0; index < userTurns.length; index++) {
      const userTurn = userTurns[index];
      const nextUserTurn = userTurns[index + 1] ?? null;

      while (
        assistantIndex < assistants.length &&
        !isBefore(userTurn, assistants[assistantIndex])
      ) {
        assistantIndex += 1;
      }

      const assistant = assistants[assistantIndex];
      if (!assistant) break;
      if (nextUserTurn && !isBefore(assistant, nextUserTurn)) continue;

      const summary = this.getAssistantTextCached(assistant, pending);
      if (summary) summaries.set(userTurn, summary);
      assistantIndex += 1;
    }
    return summaries;
  }

  /**
   * Remove selector matches nested inside another match while preserving the
   * original DOM/query order. Walking ancestors against a Set costs
   * O(matches × DOM depth), instead of comparing every pair with contains().
   */
  filterTopLevel(elements: Element[]): HTMLElement[] {
    const arr = elements.map((e) => e as HTMLElement);
    if (arr.length === 0) return arr;

    const candidates = new Set<HTMLElement>(arr);
    return arr.filter((element) => {
      let ancestor = element.parentElement;
      while (ancestor) {
        if (candidates.has(ancestor)) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    });
  }

  /**
   * Performance-optimized deduplication with cached text normalization
   */
  private dedupeByTextAndOffset(
    elements: HTMLElement[],
    firstTurnOffset: number,
    offsetOf: (element: HTMLElement) => number,
    readText: (element: HTMLElement) => string,
  ): HTMLElement[] {
    const seen = new Set<string>();
    const out: HTMLElement[] = [];

    for (const el of elements) {
      const normalizedText = readText(el);

      const offsetFromStart = offsetOf(el) - firstTurnOffset;
      const key = `${normalizedText}|${Math.round(offsetFromStart)}`;

      if (seen.has(key)) continue;
      seen.add(key);
      out.push(el);
    }
    return out;
  }
}
