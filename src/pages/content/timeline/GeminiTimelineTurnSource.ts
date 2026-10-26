import {
  getBundledGeminiTurnView,
  getGeminiTurnView,
  resolveGeminiTurnOperation,
  type GeminiTurnView,
} from '@/core/gemini/selectors';
import { acceptsGeminiTurnView } from '@/core/gemini/turnIntegrity';
import {
  getGeminiTurnSelectors,
  getGeminiUserTurnObserverScope,
} from '@/core/gemini/turnSelectors';
import type { TimelineTurnSource, TimelineTurnSnapshot } from '@/features/timeline/TimelineAdapter';
import type { TimelineMarker } from '@/features/timeline/types';

import { nativeHealthReporter } from '../nativeHealth';
import { hasRenderedConversationContent } from '../nativeHealth/pageEvidence';
import { TimelineTurns } from './TimelineTurns';

interface TurnSelection {
  readonly view: GeminiTurnView;
  readonly selector: string;
  readonly root: HTMLElement;
}

export class GeminiTimelineTurnSource implements TimelineTurnSource {
  constructor(private readonly reportHealth = true) {}
  readonly navigation = 'mounted';
  readonly text = new TimelineTurns();
  private selection: TurnSelection | null = null;
  private userOverride = '';
  private autoDetected = '';
  private observer: MutationObserver | null = null;

  get root(): HTMLElement | null {
    return this.selection?.root ?? null;
  }
  get anchor(): HTMLElement | null {
    return this.selection
      ? document.querySelector<HTMLElement>(this.selection.selector) || this.root
      : this.root;
  }
  count(): number {
    if (!this.selection) return 0;
    const { value: selection } = resolveGeminiTurnOperation(
      (view) => this.select(view),
      (candidate) => this.acceptsSelection(candidate),
    );
    this.acceptSelection(selection);
    return document.querySelectorAll(selection.selector).length;
  }
  read(previous: TimelineMarker[]): TimelineTurnSnapshot {
    if (!this.selection) return { mountedCount: 0, markers: [] };
    const { value: accepted } = resolveGeminiTurnOperation(
      (view) => {
        const selection = this.select(view);
        return {
          selection,
          plan: this.text.plan(selection.root, selection.selector, previous, view),
        };
      },
      ({ selection, plan }) => plan.markers.length > 0 && this.acceptsSelection(selection),
    );
    this.acceptSelection(accepted.selection);
    const { mountedCount } = accepted.plan;
    if (this.reportHealth && mountedCount) nativeHealthReporter.reportFound('timeline');
    else if (this.reportHealth)
      nativeHealthReporter.reportMissing('timeline', {
        route: 'conversation',
        recheck: () => !!this.selection?.root.querySelector(this.selection.selector),
        expected: () => hasRenderedConversationContent(),
      });
    return { mountedCount, markers: this.text.commit(accepted.plan) };
  }
  refresh(): boolean {
    if (!this.selection) return false;
    const { value: selection } = resolveGeminiTurnOperation(
      (view) => this.select(view, true),
      (candidate) => this.acceptsSelection(candidate),
    );
    if (!document.querySelector(selection.selector)) return false;
    this.acceptSelection(selection);
    return true;
  }
  observe(callback: MutationCallback): MutationObserver {
    this.observer?.disconnect();
    this.observer = new MutationObserver(callback);
    if (this.root) this.observer.observe(this.root, { childList: true, subtree: true });
    return this.observer;
  }
  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.reportHealth) nativeHealthReporter.withdraw('timeline');
  }

  private conversationRoot(): HTMLElement {
    return document.querySelector<HTMLElement>('main') || document.body;
  }

  private candidates(view: GeminiTurnView): string[] {
    const defaults = getGeminiTurnSelectors('turn.user', view);
    if (this.userOverride) {
      return [this.userOverride, ...defaults.filter((selector) => selector !== this.userOverride)];
    }
    // Auto remains a bundled discovery hint; it cannot add an old node to an online profile.
    const remoteUser = getGeminiTurnView().remoteKeys.has('turn.user');
    return !remoteUser && this.autoDetected && !defaults.includes(this.autoDetected)
      ? [...defaults, this.autoDetected]
      : defaults;
  }

  private findFirst(view: GeminiTurnView): TurnSelection | null {
    for (const selector of this.candidates(view)) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const broad =
        // Online fallback can move outside the first turn's parent; keep the engine's root stable.
        getGeminiTurnView().remoteKeys.has('turn.user') ||
        selector === this.userOverride ||
        getGeminiUserTurnObserverScope(selector) === 'conversation';
      const root = broad ? this.conversationRoot() : element.parentElement;
      if (root) return { view, selector, root };
    }
    return null;
  }

  private emptySelection(view: GeminiTurnView): TurnSelection {
    return {
      view,
      selector: getGeminiTurnSelectors('turn.user', view).join(','),
      root: this.conversationRoot(),
    };
  }

  private select(view: GeminiTurnView, broad = false): TurnSelection {
    const current = this.selection;
    if (current && !getGeminiTurnView().remoteKeys.has('turn.user')) {
      // Bundled discovery latches its winner even while no matching turn is mounted.
      return { ...current, view, root: broad ? this.conversationRoot() : current.root };
    }
    // Keep the chosen first-hit selector, including the joined no-turn startup fallback.
    if (current?.view === view && document.querySelector(current.selector)) {
      return broad ? { ...current, root: this.conversationRoot() } : current;
    }
    const next = this.findFirst(view) ?? this.emptySelection(view);
    return {
      ...next,
      // Only refresh may replace the root cached by the engine's viewport/observer owners.
      root: broad ? this.conversationRoot() : (current?.root ?? next.root),
    };
  }

  private acceptsSelection(selection: TurnSelection): boolean {
    return (
      !!selection.root.querySelector(selection.selector) &&
      (selection.selector === this.userOverride ||
        acceptsGeminiTurnView(selection.view, document, [selection.selector]))
    );
  }

  private acceptSelection(selection: TurnSelection): void {
    const changedRoot = this.root !== selection.root;
    this.selection = selection;
    if (changedRoot && this.observer) {
      this.observer.disconnect();
      this.observer.observe(selection.root, { childList: true, subtree: true });
    }
  }

  private waitForTurn(signal: AbortSignal): Promise<TurnSelection | null> {
    const find = () =>
      resolveGeminiTurnOperation(
        (view) => this.findFirst(view),
        (selection) => selection !== null && this.acceptsSelection(selection),
      ).value;
    const found = find();
    if (found || signal.aborted) return Promise.resolve(found);
    return new Promise((resolve) => {
      const finish = (result: TurnSelection | null) => {
        observer.disconnect();
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const observer = new MutationObserver(() => {
        const result = find();
        if (result) finish(result);
      });
      const onAbort = () => finish(null);
      const timer = window.setTimeout(() => finish(null), 4000);
      observer.observe(document.body, { childList: true, subtree: true });
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  async initialize(signal: AbortSignal): Promise<boolean> {
    try {
      this.userOverride = localStorage.getItem('geminiTimelineUserTurnSelector') || '';
      this.autoDetected = localStorage.getItem('geminiTimelineUserTurnSelectorAuto') || '';
    } catch {}
    const found = await this.waitForTurn(signal);
    if (signal.aborted) return false;
    if (!found) {
      this.acceptSelection(this.emptySelection(getBundledGeminiTurnView()));
      return true;
    }
    this.acceptSelection(found);
    if (!this.userOverride && !found.view.remoteKeys.has('turn.user')) {
      try {
        localStorage.setItem('geminiTimelineUserTurnSelectorAuto', found.selector);
      } catch {}
    }
    if (this.userOverride && found.selector !== this.userOverride) {
      try {
        localStorage.removeItem('geminiTimelineUserTurnSelector');
      } catch {}
      this.userOverride = '';
    }
    return true;
  }
}
