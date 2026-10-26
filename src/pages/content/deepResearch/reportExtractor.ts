/**
 * Deep Research report extraction (canvas right-side report body)
 *
 * Goal: find the primary rendered report content while excluding Thinking panels.
 */
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/deep-research-packaged.json';

const GENERIC_TITLES = new Set([
  'Gemini',
  'Google Gemini',
  'Google AI Studio',
  'New chat',
  'Deep Research',
]);

function isMeaningfulTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (GENERIC_TITLES.has(t)) return false;
  if (t.startsWith('Gemini -') || t.startsWith('Google AI Studio -')) return false;
  return true;
}

function scoreCandidate(el: HTMLElement): number {
  const text = (el.textContent || '').trim();
  // Favor content length; short containers are usually menu labels or side UI.
  return text.length;
}

/**
 * Find the best report root element within the Deep Research immersive panel.
 *
 * Heuristic: choose the largest markdown-like container that is not inside `thinking-panel`.
 */
export function findDeepResearchReportRoot(): HTMLElement | null {
  const panel = document.querySelector(packaged['deepResearch.panel']);
  if (!panel) return null;

  const candidates = Array.from(
    panel.querySelectorAll<HTMLElement>(packaged['deepResearch.reportCandidates'].join(',')),
  ).filter((element) => !element.closest(packaged['deepResearch.thinkingPanels']));

  let best: { el: HTMLElement; score: number } | null = null;
  for (const el of candidates) {
    const score = scoreCandidate(el);
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { el, score };
    }
  }

  return best?.el ?? null;
}

/**
 * Extract a human-readable title for the report.
 */
export function extractDeepResearchReportTitle(reportRoot: HTMLElement): string {
  // Prefer the first heading in the report content.
  let heading: Element | null = null;
  for (const selector of packaged['deepResearch.reportHeadings']) {
    heading = reportRoot.querySelector(selector);
    if (heading) break;
  }

  const headingText = heading?.textContent?.trim() || '';
  if (isMeaningfulTitle(headingText)) return headingText;

  const docTitle = document.title || '';
  if (isMeaningfulTitle(docTitle)) return docTitle.trim();

  return 'Deep Research Report';
}
