/**
 * Sidebar section hider for legacy Gemini Gems.
 *
 * Gemini keeps shipping new sidebar section shells for project-like content.
 * This module keeps the same hide/show affordance across those variants while
 * persisting state independently for each section.
 */
import { type StorageKey, StorageKeys } from '@/core/types/common';

import { getTranslationSync, onCachedLanguageChange } from '../../../utils/i18n';
import {
  type RemoveSidebarCollapseNudge,
  removeSidebarCollapseNudge,
  showSidebarCollapseNudgeOnce,
} from '../sidebarCollapseNudge';
import {
  ARROW_ICON_SELECTOR,
  HIDDEN_CLASS,
  PEEK_BAR_CLASS,
  STYLE_ID,
  TARGET_CLASS,
  TOGGLE_BTN_CLASS,
  injectStyles,
} from './styles';
import { hideTooltip, removeTooltip, showTooltip } from './tooltip';

const PROCESSED_ATTR = 'data-gv-sidebar-section-hider';
const SECTION_ID_ATTR = 'data-gv-sidebar-section-id';

type SectionId = 'gems';
type TranslationKey = Parameters<typeof getTranslationSync>[0];

interface HidableSectionConfig {
  id: SectionId;
  containerSelector: string;
  requiredDescendantSelector?: string;
  storageKey: StorageKey;
  hideTranslationKey: TranslationKey;
  showTranslationKey: TranslationKey;
  hideFallback: string;
  showFallback: string;
  toggleHostSelector?: string;
  /**
   * Where the hide-toggle button gets mounted.
   *
   * `'inline'` (default) inserts a real `<button>` into the toggle host element.
   *
   * `'absolute'` mounts a `<span role="button">` directly on the section
   * element and positions it via CSS in the top-right corner. Used for Gemini's
   * 2026 `<expandable-section>` shells, where the natural host
   * `.expandable-section-header` is itself a `<button>` — nested interactive
   * elements are invalid HTML and confuse keyboard navigation.
   */
  placement?: 'inline' | 'absolute';
}

const SECTION_CONFIGS: readonly HidableSectionConfig[] = [
  {
    // Gemini's 2026 redesign removed the Gems section from the sidebar. We
    // keep the config so older layouts still get the affordance; the new
    // selector never matches on current Gemini.
    id: 'gems',
    containerSelector: '.gems-list-container',
    storageKey: StorageKeys.GEMS_HIDDEN,
    hideTranslationKey: 'gemsHide',
    showTranslationKey: 'gemsShow',
    hideFallback: 'Hide Gems',
    showFallback: 'Show Gems',
  },
  // Notebooks intentionally omitted: the same top-right slot is now used by
  // the folder-anchor swap button (mounted from the folder manager). Keeping
  // both would crowd the corner and the swap action subsumes the value of
  // hiding the whole Notebooks section. The StorageKeys.NOTEBOOKS_HIDDEN key
  // is preserved so any pre-existing hidden state simply stops applying — the
  // section will naturally render again.
] as const;

let initialized = false;
let observer: MutationObserver | null = null;
let observerDebounceTimer: number | null = null;
const observerPendingNodes = new Set<HTMLElement>();
let stopFollowingLanguage: (() => void) | null = null;
// Bumped by every stop: storage continuations from an earlier run must not touch the page.
let hiderRun = 0;
let pendingInitTimer: number | null = null;
let pendingDomReadyInit: (() => void) | null = null;

/** What one section setup added to the host's DOM, so a stop reaches it even while detached. */
interface MountedSection {
  readonly sectionEl: HTMLElement;
  readonly sectionId: SectionId;
  readonly toggleBtn: HTMLElement;
  readonly peekBar: HTMLDivElement;
  readonly listeners: AbortController;
}
const mountedSections = new Set<MountedSection>();
/** Nudge cards this hider mounted; the host may detach one along with the sidebar. */
const mountedNudges = new Set<RemoveSidebarCollapseNudge>();

function getSectionText(section: HidableSectionConfig, kind: 'hide' | 'show'): string {
  const translationKey = kind === 'hide' ? section.hideTranslationKey : section.showTranslationKey;
  const fallback = kind === 'hide' ? section.hideFallback : section.showFallback;
  return getTranslationSync(translationKey) || fallback;
}

/**
 * Build the hide-toggle element.
 *
 * Inline mode returns a real `<button>`.
 *
 * Absolute mode returns a `<span role="button">` so the toggle can live inside
 * an element that is itself a `<button>` (Gemini's `.expandable-section-header`)
 * without producing invalid nested-button HTML. Keyboard support is added
 * separately in `setupSectionHider`.
 */
function createToggleButton(section: HidableSectionConfig): HTMLElement {
  const placement = section.placement ?? 'inline';
  const useSpan = placement === 'absolute';
  const btn = document.createElement(useSpan ? 'span' : 'button');
  btn.className = TOGGLE_BTN_CLASS;
  if (useSpan) {
    btn.classList.add(`${TOGGLE_BTN_CLASS}--absolute`);
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
  }
  btn.setAttribute(SECTION_ID_ATTR, section.id);

  const label = getSectionText(section, 'hide');
  btn.setAttribute('aria-label', label);
  btn.title = label;

  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor">
      <path d="m644-428-58-58q9-47-27-88t-93-32l-58-58q17-8 34.5-12t37.5-4q75 0 127.5 52.5T660-500q0 20-4 37.5T644-428Zm128 126-58-56q38-29 67.5-63.5T832-500q-50-101-143.5-160.5T480-720q-29 0-57 4t-55 12l-62-62q41-17 84-25.5t90-8.5q151 0 269 83.5T920-500q-23 59-60.5 109.5T772-302Zm20 246L624-222q-35 11-70.5 16.5T480-200q-151 0-269-83.5T40-500q21-53 53-98.5t73-81.5L56-792l56-56 736 736-56 56ZM222-624q-29 26-53 57t-41 67q50 101 143.5 160.5T480-280q20 0 39-2.5t39-5.5l-36-38q-11 3-21 4.5t-21 1.5q-75 0-127.5-52.5T300-500q0-11 1.5-21t4.5-21l-84-82Zm319 93Zm-151 75Z"/>
    </svg>
  `;

  return btn;
}

function createPeekBar(section: HidableSectionConfig): HTMLDivElement {
  const bar = document.createElement('div');
  bar.className = PEEK_BAR_CLASS;
  bar.setAttribute(SECTION_ID_ATTR, section.id);

  const label = getSectionText(section, 'show');
  bar.setAttribute('data-tooltip', label);
  bar.title = label;
  bar.setAttribute('role', 'button');
  bar.setAttribute('tabindex', '0');
  bar.setAttribute('aria-label', label);

  return bar;
}

function getSectionConfig(sectionId: string | null): HidableSectionConfig | undefined {
  return SECTION_CONFIGS.find((section) => section.id === sectionId);
}

async function getHiddenState(section: HidableSectionConfig): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage?.local?.get({ [section.storageKey]: false }, (result) => {
        // Check for chrome.runtime.lastError to avoid silent failures
        if (chrome.runtime?.lastError) {
          console.warn(
            `[Gemini Voyager] getHiddenState error for ${section.id}:`,
            chrome.runtime.lastError.message,
          );
          resolve(localStorage.getItem(section.storageKey) === 'true');
          return;
        }
        resolve(result?.[section.storageKey] === true);
      });
    } catch {
      resolve(localStorage.getItem(section.storageKey) === 'true');
    }
  });
}

async function setHiddenState(section: HidableSectionConfig, hidden: boolean): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage?.local?.set({ [section.storageKey]: hidden }, () => {
        if (chrome.runtime?.lastError) {
          console.warn(
            `[Gemini Voyager] setHiddenState error for ${section.id}:`,
            chrome.runtime.lastError.message,
          );
          localStorage.setItem(section.storageKey, String(hidden));
        }
        resolve();
      });
    } catch {
      localStorage.setItem(section.storageKey, String(hidden));
      resolve();
    }
  });
}

function applyState(sectionEl: HTMLElement, peekBar: HTMLDivElement, hidden: boolean): void {
  // Guard: if either element was removed from the DOM (e.g. Gemini re-rendered
  // the sidebar), skip applying state to avoid orphaned hidden elements.
  if (!sectionEl.isConnected || !peekBar.isConnected) {
    return;
  }

  if (hidden) {
    sectionEl.classList.add(HIDDEN_CLASS);
    peekBar.classList.add('gv-visible');
    return;
  }

  sectionEl.classList.remove(HIDDEN_CLASS);
  peekBar.classList.remove('gv-visible');
}

function isTargetSectionElement(element: HTMLElement, section: HidableSectionConfig): boolean {
  if (!element.matches(section.containerSelector)) {
    return false;
  }

  if (!section.requiredDescendantSelector) {
    return true;
  }

  return element.querySelector(section.requiredDescendantSelector) !== null;
}

function setupSectionCandidates(root: ParentNode): void {
  SECTION_CONFIGS.forEach((section) => {
    if (root instanceof HTMLElement && isTargetSectionElement(root, section)) {
      void setupSectionHider(root, section);
    }

    root.querySelectorAll<HTMLElement>(section.containerSelector).forEach((element) => {
      if (isTargetSectionElement(element, section)) {
        void setupSectionHider(element, section);
      }
    });
  });
}

async function setupSectionHider(
  sectionEl: HTMLElement,
  section: HidableSectionConfig,
): Promise<void> {
  if (sectionEl.getAttribute(PROCESSED_ATTR) === section.id) {
    return;
  }
  const run = hiderRun;
  const isCurrentRun = () => run === hiderRun;

  const placement = section.placement ?? 'inline';
  const parent = sectionEl.parentElement;
  if (!parent) {
    return;
  }

  // Inline mode needs an explicit host element to nest the button into.
  // Absolute mode mounts the button directly on the section, but we still
  // verify the requiredDescendantSelector matched (handled in caller) before
  // proceeding so we don't paint a toggle on the wrong element.
  let inlineHost: Element | null = null;
  if (placement === 'inline') {
    inlineHost = sectionEl.querySelector(section.toggleHostSelector ?? ARROW_ICON_SELECTOR);
    if (!inlineHost) return;
  }

  const toggleBtn = createToggleButton(section);
  const peekBar = createPeekBar(section);
  let hasUserInteraction = false;

  sectionEl.classList.add(TARGET_CLASS);
  sectionEl.setAttribute(PROCESSED_ATTR, section.id);
  // The host may detach the sidebar before a stop, out of reach of a document sweep.
  const listeners = new AbortController();
  const { signal } = listeners;
  mountedSections.add({ sectionEl, sectionId: section.id, toggleBtn, peekBar, listeners });

  if (placement === 'absolute') {
    // The button is `position: absolute` per CSS; mount it on the section
    // (which has `position: relative` via TARGET_CLASS). Appending — instead
    // of `insertBefore` on the header button — keeps it outside the native
    // header `<button>`, avoiding nested-button HTML.
    sectionEl.appendChild(toggleBtn);
  } else {
    inlineHost!.insertBefore(toggleBtn, inlineHost!.firstChild);
  }
  parent.insertBefore(peekBar, sectionEl.nextSibling);

  const handleHideRequest = async () => {
    hasUserInteraction = true;
    // The click's hidden state is an accepted write; after a stop it only stops touching the page.
    await setHiddenState(section, true);
    if (!isCurrentRun()) return;
    applyState(sectionEl, peekBar, true);
    void showSidebarCollapseNudgeOnce(peekBar, isCurrentRun).then((removeNudge) => {
      if (!removeNudge) return;
      if (isCurrentRun()) mountedNudges.add(removeNudge);
      else removeNudge();
    });
  };

  toggleBtn.addEventListener(
    'click',
    async (event) => {
      event.stopPropagation();
      event.preventDefault();
      await handleHideRequest();
    },
    { signal },
  );

  // Span-as-button (absolute mode) needs explicit keyboard handling — native
  // <button> Enter/Space activation isn't synthesized for span[role=button].
  // Also stop pointerdown/mousedown bubbling so the underlying section header
  // (which is itself a <button>) doesn't toggle expand/collapse on a stray
  // drag-click that lands on the toggle.
  if (placement === 'absolute') {
    toggleBtn.addEventListener(
      'keydown',
      async (event) => {
        const ke = event as KeyboardEvent;
        if (ke.key !== 'Enter' && ke.key !== ' ') return;
        event.stopPropagation();
        event.preventDefault();
        await handleHideRequest();
      },
      { signal },
    );
    toggleBtn.addEventListener('pointerdown', (e) => e.stopPropagation(), { signal });
    toggleBtn.addEventListener('mousedown', (e) => e.stopPropagation(), { signal });
  }

  const handleShowRequest = async () => {
    hasUserInteraction = true;
    hideTooltip();
    removeSidebarCollapseNudge();
    // Like a hide click: the write is accepted, but a stopped run leaves the page alone.
    await setHiddenState(section, false);
    if (!isCurrentRun()) return;
    applyState(sectionEl, peekBar, false);
  };

  peekBar.addEventListener('click', () => void handleShowRequest(), { signal });

  peekBar.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void handleShowRequest();
      }
    },
    { signal },
  );

  peekBar.addEventListener('mouseenter', () => showTooltip(peekBar), { signal });
  peekBar.addEventListener('mouseleave', () => hideTooltip(), { signal });
  peekBar.addEventListener('focus', () => showTooltip(peekBar), { signal });
  peekBar.addEventListener('blur', () => hideTooltip(), { signal });

  const isHidden = await getHiddenState(section);
  // A stop can miss a section the host had detached; the run check keeps it from re-hiding later.
  if (isCurrentRun() && !hasUserInteraction) {
    applyState(sectionEl, peekBar, isHidden);
  }
}

function updateLanguageText(): void {
  document.querySelectorAll<HTMLButtonElement>(`.${TOGGLE_BTN_CLASS}`).forEach((btn) => {
    const section = getSectionConfig(btn.getAttribute(SECTION_ID_ATTR));
    if (!section) {
      return;
    }

    const label = getSectionText(section, 'hide');
    btn.setAttribute('aria-label', label);
    btn.title = label;
  });

  document.querySelectorAll<HTMLDivElement>(`.${PEEK_BAR_CLASS}`).forEach((bar) => {
    const section = getSectionConfig(bar.getAttribute(SECTION_ID_ATTR));
    if (!section) {
      return;
    }

    const label = getSectionText(section, 'show');
    bar.setAttribute('data-tooltip', label);
    bar.title = label;
    bar.setAttribute('aria-label', label);
  });
}

function initGemsHider(): void {
  if (initialized) return;
  initialized = true;

  injectStyles();
  setupSectionCandidates(document);

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          observerPendingNodes.add(node);
        }
      }
    }

    if (observerDebounceTimer !== null) {
      window.clearTimeout(observerDebounceTimer);
    }
    observerDebounceTimer = window.setTimeout(() => {
      observerDebounceTimer = null;
      const pendingNodes = Array.from(observerPendingNodes);
      observerPendingNodes.clear();
      pendingNodes.forEach((node) => setupSectionCandidates(node));
    }, 100);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Relabel once the new language has loaded, not when storage changes.
  stopFollowingLanguage = onCachedLanguageChange(updateLanguageText);
}

function cleanup(): void {
  if (observerDebounceTimer !== null) {
    window.clearTimeout(observerDebounceTimer);
    observerDebounceTimer = null;
  }
  observerPendingNodes.clear();

  if (observer) {
    observer.disconnect();
    observer = null;
  }

  stopFollowingLanguage?.();
  stopFollowingLanguage = null;

  for (const mounted of mountedSections) {
    mounted.listeners.abort();
    mounted.toggleBtn.remove();
    mounted.peekBar.remove();
    mounted.sectionEl.classList.remove(HIDDEN_CLASS, TARGET_CLASS);
    if (mounted.sectionEl.getAttribute(PROCESSED_ATTR) === mounted.sectionId) {
      mounted.sectionEl.removeAttribute(PROCESSED_ATTR);
    }
  }
  mountedSections.clear();
  for (const removeNudge of mountedNudges) removeNudge();
  mountedNudges.clear();

  document.getElementById(STYLE_ID)?.remove();
  document.querySelectorAll(`.${TOGGLE_BTN_CLASS}`).forEach((element) => element.remove());
  document.querySelectorAll(`.${PEEK_BAR_CLASS}`).forEach((element) => element.remove());
  removeTooltip();
  removeSidebarCollapseNudge();
  document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((element) => {
    element.classList.remove(HIDDEN_CLASS);
  });
  document.querySelectorAll<HTMLElement>(`[${PROCESSED_ATTR}]`).forEach((element) => {
    element.classList.remove(TARGET_CLASS);
    element.removeAttribute(PROCESSED_ATTR);
  });

  initialized = false;
  hiderRun += 1;
}

function cancelPendingInit(): void {
  if (pendingInitTimer !== null) {
    window.clearTimeout(pendingInitTimer);
    pendingInitTimer = null;
  }
  if (pendingDomReadyInit) {
    document.removeEventListener('DOMContentLoaded', pendingDomReadyInit);
    pendingDomReadyInit = null;
  }
}

export function startGemsHider(): () => void {
  if (location.hostname !== 'gemini.google.com') {
    return () => {};
  }

  cancelPendingInit();
  if (document.readyState === 'loading') {
    pendingDomReadyInit = () => {
      pendingDomReadyInit = null;
      initGemsHider();
    };
    document.addEventListener('DOMContentLoaded', pendingDomReadyInit);
  } else {
    pendingInitTimer = window.setTimeout(() => {
      pendingInitTimer = null;
      initGemsHider();
    }, 500);
  }

  const run = hiderRun;
  return () => {
    // An earlier run's stop, called again, must not tear down a newer run.
    if (run !== hiderRun) return;
    cancelPendingInit();
    cleanup();
  };
}
