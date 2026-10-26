import { remoteGeminiSidebarToggle } from '@/core/gemini/sidebar/actions';
import { GEMINI_PACKAGED_SIDEBAR_SELECTORS as SIDEBAR } from '@/core/gemini/sidebar/packaged';

// The 2026 layout keeps an invisible 0×0 toggle sibling around at all times, so visibility
// filtering happens in `findSidebarToggle`. The aria-label is localized: the icon's fonticon
// (i18n-stable) is the primary anchor and the English label a redundant safety net. The legacy
// `side-nav-menu-button` element keeps older Gemini layouts and AI-Studio-shaped tabs working.
const SIDEBAR_TOGGLE_MATCH_SELECTOR = `${SIDEBAR.toggleButton}, ${SIDEBAR.toggleHost}`;
// Stable icon ligature names Gemini uses for the toggle (independent of locale).
const TOGGLE_ICON_FONTICONS = ['side_nav', 'side_nav_expand'] as const;

export function findSidebarToggle(): HTMLButtonElement | null {
  const repaired = remoteGeminiSidebarToggle();
  if (repaired) return repaired;
  // Two buttons match at any moment in the 2026 layout; walk all of them and skip zero geometry.
  const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>(SIDEBAR.toggleButton));

  // Also pick up the new layout via icon-ligature so localized aria-labels can't shut us out.
  for (const icon of document.querySelectorAll(SIDEBAR.toggleIcon)) {
    const fonticon = icon.getAttribute('fonticon');
    if (!TOGGLE_ICON_FONTICONS.some((name) => name === fonticon)) continue;
    const button = icon.closest('button');
    if (button instanceof HTMLButtonElement && !candidates.includes(button))
      candidates.push(button);
  }

  const visible = candidates.find((button) => {
    const rect = button.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  if (visible) return visible;

  // Legacy fallback — return any match even if 0×0, since older Gemini
  // layouts render the button in odd lifecycles where geometry isn't ready.
  if (candidates[0]) return candidates[0];

  return document.querySelector(SIDEBAR.toggleLegacyHost)?.querySelector('button') ?? null;
}

/** The animation's host and both descendants, in that order. */
export function getSidebarAnimationElements(): HTMLElement[] {
  return [
    getSidenavElement(),
    document.querySelector<HTMLElement>(SIDEBAR.content),
    getSidebarContentContainer(),
  ].filter((element): element is HTMLElement => element !== null);
}

function getToggleCollapsedState(button: HTMLButtonElement | null): boolean | null {
  if (!button) return null;
  if (button === remoteGeminiSidebarToggle())
    return button.getAttribute('aria-expanded') === 'false';
  const fonticon = button.querySelector(SIDEBAR.toggleIcon)?.getAttribute('fonticon');
  if (fonticon === 'side_nav_expand') return true;
  if (fonticon === 'side_nav') return false;
  const label = (button.getAttribute('aria-label') ?? '').toLowerCase();
  if (label.includes('open sidebar')) return true;
  if (label.includes('close sidebar')) return false;
  return null;
}

function getSidebarContentContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SIDEBAR.contentInner);
}

function getStructuredSidebarCollapsedState(button: HTMLButtonElement | null): boolean | null {
  if (getSidenavElement()?.classList.contains('collapsed')) return true;
  if (getSidebarContentContainer()?.classList.contains('collapsed')) return true;
  const toggleState = getToggleCollapsedState(button);
  if (toggleState !== null) return toggleState;
  if (document.body.classList.contains('mat-sidenav-opened')) return false;
  return null;
}

function readSidebarCollapsed(button: HTMLButtonElement | null): boolean {
  const structuredState = getStructuredSidebarCollapsedState(button);
  if (structuredState !== null) return structuredState;
  const sidenav = getSidenavElement();
  return sidenav !== null && sidenav.getBoundingClientRect().width < 80;
}

export function isSidebarCollapsed(): boolean {
  return readSidebarCollapsed(findSidebarToggle());
}

/** Click owners read the control and its state together before the one native click. */
export function getSidebarToggleState(): { button: HTMLButtonElement | null; collapsed: boolean } {
  const button = findSidebarToggle();
  return { button, collapsed: readSidebarCollapsed(button) };
}

export function isSidebarVisible(): boolean {
  const sidenav = getSidenavElement();
  if (!sidenav) return false;
  const rect = sidenav.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function getSidenavElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SIDEBAR.sidenav);
}

export function isSidebarToggleTarget(target: HTMLElement): boolean {
  const remote = remoteGeminiSidebarToggle();
  return (
    (remote?.contains(target) ?? false) || target.closest(SIDEBAR_TOGGLE_MATCH_SELECTOR) !== null
  );
}
