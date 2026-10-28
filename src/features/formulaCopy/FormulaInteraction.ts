import { GEMINI_FORMULA_PACKAGED } from '@/core/gemini/math/formula';
import { nativeStartPointSiteForHost } from '@/features/plugins/sites/hostPolicy';

import { isDisplayMode } from './formulaSource';

const IGNORED_INTERACTION_CLASS = 'gv-formula-copy-ignored';

function inlineSelector(doc: Document): string {
  return nativeStartPointSiteForHost(doc.location?.hostname ?? '') === 'gemini'
    ? GEMINI_FORMULA_PACKAGED['formula.inline']
    : '.math-inline';
}

function presentationSelector(doc: Document): string {
  return nativeStartPointSiteForHost(doc.location?.hostname ?? '') === 'gemini'
    ? GEMINI_FORMULA_PACKAGED['formula.presentation']
    : '.math-inline, .math-display, .math-block, ms-katex, .katex, .katex-display';
}

// Gemini renders prose arrows as inline data-math elements. Treat an
// arrow-only token as presentation, while formulas containing operands stay
// copyable. The surrounding checks keep this Gemini- and inline-specific.
const PRESENTATIONAL_INLINE_ARROW_COMMANDS = new Set([
  '\\leftarrow',
  '\\gets',
  '\\rightarrow',
  '\\to',
  '\\leftrightarrow',
  '\\Leftarrow',
  '\\Rightarrow',
  '\\Leftrightarrow',
  '\\longleftarrow',
  '\\longrightarrow',
  '\\longleftrightarrow',
  '\\Longleftarrow',
  '\\Longrightarrow',
  '\\Longleftrightarrow',
  '\\mapsto',
  '\\longmapsto',
  '\\hookleftarrow',
  '\\hookrightarrow',
  '\\leftharpoonup',
  '\\leftharpoondown',
  '\\rightharpoonup',
  '\\rightharpoondown',
  '\\rightleftharpoons',
  '\\leftrightharpoons',
  '\\uparrow',
  '\\downarrow',
  '\\updownarrow',
  '\\Uparrow',
  '\\Downarrow',
  '\\Updownarrow',
  '\\nearrow',
  '\\searrow',
  '\\swarrow',
  '\\nwarrow',
  '\\implies',
  '\\impliedby',
  '\\iff',
]);

const PRESENTATIONAL_INLINE_ARROW_GLYPH = /^[\u2190-\u21ff\u27f0-\u27ff\u2900-\u297f]$/u;

const PRESENTATIONAL_INLINE_EXTENSIBLE_ARROW =
  /^\\x(?:left|right|leftright)arrow(?:\[[^\]]*\])?\{(?:[^{}]|\{[^{}]*\})*\}$/;

/** Owns Gemini presentation-arrow markers and their observation lifecycle. */
export class FormulaInteraction {
  private observer: MutationObserver | null = null;

  constructor(private readonly observeGeminiArrows: boolean) {}

  public mark(element: HTMLElement, source: string): boolean {
    const ignored = this.isPresentationalInlineArrow(element, source);
    this.setInteractionIgnored(element, ignored);
    return ignored;
  }

  /**
   * Mark existing and newly-rendered Gemini arrows before the active CSS can
   * give them formula padding/cursor affordances. Mouseover remains a fallback
   * for host DOM that mutates in an unusual order.
   */
  public start(): void {
    if (!this.observeGeminiArrows) return;
    this.refreshArrowExclusions(document);
    if (this.observer || !document.documentElement) return;

    this.observer = new MutationObserver((records) => {
      const refreshRoots = new Set<ParentNode>();

      for (const record of records) {
        if (record.type === 'attributes') {
          if (record.target instanceof HTMLElement) {
            refreshRoots.add(
              record.target.closest<HTMLElement>(inlineSelector(record.target.ownerDocument)) ??
                record.target,
            );
          }
          continue;
        }

        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement || node instanceof DocumentFragment) {
            if (this.containsMathSource(node)) {
              refreshRoots.add(
                node instanceof HTMLElement
                  ? (node.closest<HTMLElement>(inlineSelector(node.ownerDocument)) ?? node)
                  : node,
              );
            }
          }
        }

        const inlineContainer =
          record.target instanceof HTMLElement
            ? record.target.closest<HTMLElement>(inlineSelector(record.target.ownerDocument))
            : null;
        if (inlineContainer) {
          const removedRelevantMath = Array.from(record.removedNodes).some(
            (node) =>
              this.containsMathSource(node) ||
              (node instanceof HTMLElement &&
                (node.classList.contains(IGNORED_INTERACTION_CLASS) ||
                  node.querySelector(`.${IGNORED_INTERACTION_CLASS}`) !== null)),
          );
          if (removedRelevantMath) refreshRoots.add(inlineContainer);
        }
      }

      for (const root of refreshRoots) this.refreshArrowExclusions(root);
    });
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-math'],
      childList: true,
      subtree: true,
    });
  }

  private containsMathSource(node: Node): boolean {
    if (!(node instanceof HTMLElement || node instanceof DocumentFragment)) return false;
    return (
      (node instanceof HTMLElement && node.matches('[data-math]')) ||
      node.querySelector('[data-math]') !== null
    );
  }

  /**
   * Stop observing. The arrow markers live in the page DOM, which a retiring
   * content script shares with its successor: pass `clearMarkers: false` when
   * a later instance has taken the page over, so a late stop never strips the
   * markers that instance placed (they would regain formula padding/cursor).
   */
  public stop({ clearMarkers = true }: { clearMarkers?: boolean } = {}): void {
    this.observer?.disconnect();
    this.observer = null;
    if (!clearMarkers) return;
    for (const element of document.querySelectorAll(`.${IGNORED_INTERACTION_CLASS}`)) {
      element.classList.remove(IGNORED_INTERACTION_CLASS);
    }
  }

  private refreshArrowExclusions(root: ParentNode): void {
    const inlineContainer =
      root instanceof HTMLElement
        ? root.closest<HTMLElement>(inlineSelector(root.ownerDocument))
        : null;
    const scanRoot: ParentNode = inlineContainer ?? root;

    if (scanRoot instanceof HTMLElement && scanRoot.classList.contains(IGNORED_INTERACTION_CLASS)) {
      scanRoot.classList.remove(IGNORED_INTERACTION_CLASS);
    }
    for (const ignored of scanRoot.querySelectorAll<HTMLElement>(`.${IGNORED_INTERACTION_CLASS}`)) {
      ignored.classList.remove(IGNORED_INTERACTION_CLASS);
    }

    const candidates: HTMLElement[] = [];
    if (scanRoot instanceof HTMLElement && scanRoot.matches('[data-math]')) {
      candidates.push(scanRoot);
    }
    candidates.push(...scanRoot.querySelectorAll<HTMLElement>('[data-math]'));

    for (const candidate of candidates) {
      const latexSource = candidate.getAttribute('data-math');
      if (!latexSource) continue;
      this.setInteractionIgnored(
        candidate,
        this.isPresentationalInlineArrow(candidate, latexSource),
      );
    }
  }

  private setInteractionIgnored(mathElement: HTMLElement, ignored: boolean): void {
    const exactElements = new Set<HTMLElement>([mathElement]);
    const presentationContainer = mathElement.closest(
      presentationSelector(mathElement.ownerDocument),
    );

    for (const katexElement of mathElement.querySelectorAll<HTMLElement>('.katex')) {
      exactElements.add(katexElement);
    }

    for (const element of exactElements) {
      element.classList.toggle(IGNORED_INTERACTION_CLASS, ignored);
    }

    if (presentationContainer instanceof HTMLElement) {
      const sources = presentationContainer.matches('[data-math]')
        ? [presentationContainer]
        : [...presentationContainer.querySelectorAll<HTMLElement>('[data-math]')];
      const containerIsOnlyPresentationalArrows =
        sources.length > 0 &&
        sources.every((source) => {
          const formula = source.getAttribute('data-math');
          return formula !== null && this.isPresentationalInlineArrow(source, formula);
        });
      presentationContainer.classList.toggle(
        IGNORED_INTERACTION_CLASS,
        containerIsOnlyPresentationalArrows,
      );
    }
  }

  private isPresentationalInlineArrow(element: HTMLElement, formula: string): boolean {
    if (
      !this.observeGeminiArrows ||
      !element.hasAttribute('data-math') ||
      element.closest(inlineSelector(element.ownerDocument)) === null ||
      isDisplayMode(element)
    )
      return false;
    // Explicit delimiters are evidence that this is an intentional formula,
    // even when its entire mathematical content is an arrow.
    const normalized = formula.trim();
    return (
      PRESENTATIONAL_INLINE_ARROW_COMMANDS.has(normalized) ||
      PRESENTATIONAL_INLINE_ARROW_GLYPH.test(normalized) ||
      PRESENTATIONAL_INLINE_EXTENSIBLE_ARROW.test(normalized)
    );
  }
}
