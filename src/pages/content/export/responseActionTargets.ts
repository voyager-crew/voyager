import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';

const COPY_BUTTON_TEST_ID = 'copy-button';
const MORE_BUTTON_TEST_ID = 'more-menu-button';
export const COPY_IMAGE_BUTTON_TEST_ID = 'gv-copy-image-button';
const COPY_ICON_NAME = 'content_copy';
const COPY_BUTTON_ARIA_PATTERNS = [/^copy\b/i, /复制/];
const ACTION_BUTTON_SELECTOR = 'button, gem-icon-button, [role="button"]';
const COPY_ICON_SELECTOR =
  'mat-icon[fonticon="content_copy"], mat-icon[data-mat-icon-name="content_copy"]';
// The exact set of containers Gemini uses for the per-response action bar.
// We MUST scope copy-button searches to one of these — walking past it (e.g.,
// up to `document.body`) accidentally finds disabled template/hidden copy
// buttons that belong to a totally different button family (stock Material
// `mdc-icon-button` instead of Gemini's `gem-button-*`), producing a button
// that's the wrong size, mis-centered, and inherits `pointer-events: none`.
// Preferred clone sources when the action bar has no copy-button (e.g.,
// image-generation responses). Sibling buttons in the same bar share Gemini's
// `gem-button-*` sizing/centering, so the cloned button visually matches.
const SIBLING_CLONE_SOURCE_TEST_IDS = [
  'share-button',
  'thumb-up-button',
  'regenerate-button',
  'thumb-down-button',
];
const ACTION_ROOT_SELECTOR = [
  'message-actions',
  '.message-actions',
  '.actions-container-v2',
  '.buttons-container-v2',
  '[data-test-id="copy-button"]',
  '[data-test-id="more-menu-button"]',
  ACTION_BUTTON_SELECTOR,
  'mat-icon',
].join(', ');
const ASSISTANT_SCOPE_SELECTOR = [
  '[data-message-author-role="assistant"]',
  '[data-message-author-role="model"]',
  'article[data-author="assistant"]',
  'article[data-turn="assistant"]',
  'article[data-turn="model"]',
  '.model-response',
  'model-response',
  '.response-container',
  '.presented-response-container',
].join(', ');

function findButtonByTestId(container: HTMLElement, testId: string): HTMLElement | null {
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(testId) : testId;
  return (container.querySelector(`[data-test-id="${escaped}"]`) as HTMLElement | null) ?? null;
}

function findCopyButtonInContainer(container: HTMLElement): HTMLElement | null {
  // Legacy: test-id="copy-button"
  const byTestId = findButtonByTestId(container, COPY_BUTTON_TEST_ID);
  if (byTestId) return byTestId;

  // gem UI: button has no test-id, identify by mat-icon[fonticon="content_copy"]
  // and aria-label starting with "Copy" (English) / 含 "复制" (Chinese) — we still
  // try other locales by checking icon first and only filter aria as a sanity check.
  const iconCandidates = Array.from(container.querySelectorAll<HTMLElement>(COPY_ICON_SELECTOR));
  if (iconCandidates.length === 0) {
    iconCandidates.push(
      ...Array.from(container.querySelectorAll<HTMLElement>('mat-icon')).filter(
        (icon) => icon.textContent?.trim() === COPY_ICON_NAME,
      ),
    );
  }

  for (const icon of iconCandidates) {
    const el = icon.closest(ACTION_BUTTON_SELECTOR) as HTMLElement | null;
    if (!el || !container.contains(el)) continue;
    const aria = el.getAttribute('aria-label') || '';
    // Skip if aria-label looks unrelated (defensive — most copy buttons match the patterns)
    if (aria && !COPY_BUTTON_ARIA_PATTERNS.some((re) => re.test(aria))) continue;
    return el;
  }
  return null;
}

function isButtonUsable(el: HTMLElement): boolean {
  if (el instanceof HTMLButtonElement && el.disabled) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  // We deliberately don't gate on geometry — on-hover sibling buttons may be
  // size-0 between hovers, but their style classes (which is all we care
  // about) are still correct to clone.
  return true;
}

function findCloneSource(container: HTMLElement, moreButton: HTMLElement): HTMLElement {
  // Preferred: a real copy-button in the same bar (text-response path —
  // perfect style match).
  const copy = findCopyButtonInContainer(container);
  if (copy && isButtonUsable(copy)) return copy;

  // Fallback: any sibling action button. They all share the same
  // `gem-button-*` size/centering, so the cloned button stays visually
  // consistent with the bar.
  for (const testId of SIBLING_CLONE_SOURCE_TEST_IDS) {
    const el = findButtonByTestId(container, testId);
    if (el && el !== moreButton && isButtonUsable(el)) return el;
  }

  // Last resort: the more-button itself. Always present (we needed it to find
  // the container in the first place) but its tooltip wraps differently and
  // its icon container has slightly different padding — accept the cosmetic
  // mismatch over not injecting at all.
  return moreButton;
}

function isAssistantActionContainer(container: HTMLElement): boolean {
  return !!container.closest(ASSISTANT_SCOPE_SELECTOR);
}

function mayContainAssistantActionRoot(root: ParentNode): boolean {
  if (!(root instanceof HTMLElement)) return true;
  if (root.closest(ASSISTANT_SCOPE_SELECTOR)) return true;
  return !!root.querySelector(ASSISTANT_SCOPE_SELECTOR);
}

function shouldProbeDirectActionRoot(root: HTMLElement): boolean {
  if (!root.closest(ASSISTANT_SCOPE_SELECTOR)) return false;
  return !!(root.matches(ACTION_ROOT_SELECTOR) || root.closest(ACTION_ROOT_SELECTOR));
}

export interface ResponseActionTarget {
  readonly container: HTMLElement;
  readonly moreButton: HTMLElement;
  readonly cloneSource: HTMLElement | null;
}

function collectTargets(root: ParentNode, bars: string): ResponseActionTarget[] {
  if (!mayContainAssistantActionRoot(root)) return [];
  const moreButtons: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.getAttribute('data-test-id') === MORE_BUTTON_TEST_ID)
    moreButtons.push(root);
  moreButtons.push(
    ...root.querySelectorAll<HTMLElement>(`[data-test-id="${MORE_BUTTON_TEST_ID}"]`),
  );
  if (
    moreButtons.length === 0 &&
    root instanceof HTMLElement &&
    shouldProbeDirectActionRoot(root)
  ) {
    const container = root.closest<HTMLElement>(bars);
    const more = container && findButtonByTestId(container, MORE_BUTTON_TEST_ID);
    if (more) moreButtons.push(more);
  }
  const visited = new Set<HTMLElement>();
  const targets: ResponseActionTarget[] = [];
  for (const anchor of moreButtons) {
    if (!anchor.closest(ASSISTANT_SCOPE_SELECTOR)) continue;
    const container = anchor.closest<HTMLElement>(bars);
    if (!container || visited.has(container) || !isAssistantActionContainer(container)) continue;
    visited.add(container);
    const moreButton = findButtonByTestId(container, MORE_BUTTON_TEST_ID);
    if (!moreButton) continue;
    // Existing buttons only need updates; rescanning native icons on every mutation is wasted work.
    const cloneSource = findButtonByTestId(container, COPY_IMAGE_BUTTON_TEST_ID)
      ? null
      : findCloneSource(container, moreButton);
    targets.push({ container, moreButton, cloneSource });
  }
  return targets;
}

export function resolveResponseActionTargets(root: ParentNode): ResponseActionTarget[] {
  const view = getGeminiSelectorView();
  const bundle = getBundledGeminiSelectorView();
  const read = (candidate: GeminiSelectorView) =>
    collectTargets(root, candidate.profiles['responseActions.bars'].join(','));
  if (!view.remoteKeys.has('responseActions.bars')) return read(bundle);
  return resolveGeminiSelectorOperationInView(view, read, (targets) => {
    const reference = read(bundle);
    const anchors = Array.from(
      root.querySelectorAll<HTMLElement>(`[data-test-id="${MORE_BUTTON_TEST_ID}"]`),
    );
    if (root instanceof HTMLElement && root.getAttribute('data-test-id') === MORE_BUTTON_TEST_ID)
      anchors.unshift(root);
    if (anchors.length === 0 && root instanceof HTMLElement && shouldProbeDirectActionRoot(root)) {
      const owner = root.closest(ASSISTANT_SCOPE_SELECTOR);
      const siblings = owner
        ? Array.from(owner.querySelectorAll<HTMLElement>(`[data-test-id="${MORE_BUTTON_TEST_ID}"]`))
        : [];
      // Incremental scans start at a copy icon too; its sibling More is still the operation anchor.
      if (siblings.length === 1) anchors.push(siblings[0]);
    }
    const nativeAnchors = anchors.filter((anchor) => anchor.closest(ASSISTANT_SCOPE_SELECTOR));
    // A narrowed or oversized bar must never change the response or clone source.
    if (targets.length !== nativeAnchors.length || targets.length === 0) return false;
    return targets.every((target, index) => {
      const { container, moreButton, cloneSource } = target;
      if (moreButton !== nativeAnchors[index]) return false;
      const original = reference.find((item) => item.moreButton === moreButton);
      if (original) return container === original.container && cloneSource === original.cloneSource;
      const owner = moreButton.closest(ASSISTANT_SCOPE_SELECTOR);
      return (
        container !== owner &&
        container.closest(ASSISTANT_SCOPE_SELECTOR) === owner &&
        (!cloneSource ||
          (container.contains(cloneSource) &&
            cloneSource.closest(ASSISTANT_SCOPE_SELECTOR) === owner)) &&
        !Array.from(container.querySelectorAll(ASSISTANT_SCOPE_SELECTOR)).some(
          (child) => child !== owner,
        ) &&
        !container.querySelector(
          'message-content, .markdown, .markdown-main-panel, model-thoughts',
        ) &&
        container.querySelectorAll(`[data-test-id="${MORE_BUTTON_TEST_ID}"]`).length === 1
      );
    });
  }).value;
}
