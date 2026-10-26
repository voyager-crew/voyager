import composerPackaged from '@/features/plugins/catalog/sites/gemini/selector-data/composer-packaged.json';

import { getTranslationSync } from '../../../utils/i18n';

export const STYLE_ID = 'gemini-voyager-input-collapse';
export const COLLAPSED_CLASS = 'gv-input-collapsed';
export const PLACEHOLDER_CLASS = 'gv-collapse-placeholder';
export const TRANSITION_CLASS = 'element-to-collapse';
// Own marker: the old shared `gv-processed` let a stop strip other features' markers page-wide.
export const PROCESSED_CLASS = 'gv-input-collapse-processed';

/**
 * Checks if the current page is the homepage or a new conversation page.
 * These pages have the URL pattern /app or /u/<num>/app without a conversation ID.
 * Examples of homepage/new conversation:
 *   - /app
 *   - /u/0/app
 *   - /u/1/app
 * Examples of existing conversations (should NOT match):
 *   - /app/abc123def456
 *   - /u/0/app/abc123def456
 *   - /gem/xxx/abc123
 */
function isHomepageOrNewConversation(): boolean {
  const pathname = window.location.pathname;
  // Match /app or /u/<num>/app exactly (no conversation ID after /app)
  // Must NOT have anything after /app except optional trailing slash
  return /^\/(?:u\/\d+\/)?app\/?$/.test(pathname);
}

/**
 * Checks if the current page is a gems editor page (create or edit).
 * These pages should not have auto-collapse behavior.
 */
function isGemsEditorPage(): boolean {
  const pathname = window.location.pathname;
  // Match /gems/create, /gems/edit/*, or /u/<num>/gems/create, /u/<num>/gems/edit/*
  return /^\/(?:u\/\d+\/)?gems\/(?:create|edit)\/?/.test(pathname);
}

/**
 * Checks if auto-collapse should be disabled on the current page.
 */
export function shouldDisableAutoCollapse(): boolean {
  return isHomepageOrNewConversation() || isGemsEditorPage();
}

/**
 * Injects the CSS styles for the collapsed input state.
 */
export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* Transitions for the input container */
    .${TRANSITION_CLASS} {
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /*
     * Collapsed State Styles
     */
    .${COLLAPSED_CLASS} {
      /* Compact dimensions */
      height: 48px !important;
      min-height: 48px !important;
      max-height: 48px !important;

      /* Pill shape */
      border-radius: 24px !important;
      width: auto !important;
      min-width: 200px !important;
      max-width: 600px !important;
      margin-left: auto !important;
      margin-right: auto !important;
      padding: 0 24px !important;

      /* Hide overflow */
      overflow: hidden !important;

      /* Visual styling - Clean, no borders if possible to avoid "shadow edge" issues */
      background-color: var(--gm3-sys-color-surface-container, #f0f4f9) !important;
      /* Subtle shadow */
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08) !important;
      border: none !important;

      /* Center content */
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;

      /* Ensure it's clickable */
      cursor: pointer !important;
      position: relative !important;
      z-index: 999 !important;

      /* Reset layout */
      gap: 0 !important;
      transform: none !important;
    }

    /* Hiding Strategy:
       Target ALL descendants that are NOT our placeholder.
       Use opacity 0 to hide.
    */
    .${COLLAPSED_CLASS} > *:not(.${PLACEHOLDER_CLASS}) {
      visibility: hidden !important;
      opacity: 0 !important;
      width: 0 !important;
      height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      position: absolute !important;
      pointer-events: none !important;
    }

    /* Placeholder Styling - HIDDEN by default */
    .${PLACEHOLDER_CLASS} {
      /* Hidden by default when not collapsed */
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
    }

    /* Show placeholder ONLY when collapsed */
    .${COLLAPSED_CLASS} > .${PLACEHOLDER_CLASS} {
      /* Force visibility */
      visibility: visible !important;
      opacity: 1 !important;
      display: flex !important;
      position: relative !important;

      /* Typography - Brighter color */
      color: var(--gm3-sys-color-on-surface, #1f1f1f);
      font-family: Google Sans, Roboto, sans-serif;
      font-size: 15px;
      font-weight: 500;
      white-space: nowrap;

      align-items: center;
      gap: 10px;
      pointer-events: none;
    }

    /* Gemini's page scheme can differ from the system preference. */
    html[data-gv-scheme="dark"] .${COLLAPSED_CLASS} {
      background-color: var(--gm3-sys-color-surface-container-high, #2b2b2b) !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
    }
    html[data-gv-scheme="dark"] .${COLLAPSED_CLASS} > .${PLACEHOLDER_CLASS} {
      color: var(--gm3-sys-color-on-surface, #e8eaed);
    }
  `;
  document.head.appendChild(style);
}

/**
 * Finds the logical root of the input bar.
 * We need the container that holds the background color and the full width.
 */
export function getInputContainer(): HTMLElement | null {
  // Safety check for test environments and edge cases
  if (typeof document === 'undefined') return null;

  const textarea = document.querySelector('rich-textarea');
  if (!textarea) return null;

  let current = textarea.parentElement;
  let bestCandidate: HTMLElement | null = null;

  // Traverse up to 8 levels
  for (let i = 0; i < 8; i++) {
    if (!current) break;

    // Check computed style for background color to find the visual "island"
    const style = window.getComputedStyle(current);
    const hasBackground =
      style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
    const isFlex = style.display.includes('flex');

    // Check for specific Gemini/Material classes or roles
    // We prioritize the container that has a background color
    if (hasBackground) {
      bestCandidate = current as HTMLElement;
      // If we found a substantial container (flex + background), it's a strong candidate.
      if (isFlex) {
        // Continue one more level just in case there's a wrapper, but update bestCandidate
      }
    }

    // Stop if we hit the limit or dangerous nodes
    if (
      current.tagName === 'MAIN' ||
      current.tagName === 'BODY' ||
      current.classList.contains('content-wrapper')
    ) {
      break;
    }

    current = current.parentElement;
  }

  // If we found a candidate with a background, use it.
  // Otherwise fallback to heuristic parents.
  return bestCandidate || textarea.parentElement?.parentElement || textarea.parentElement;
}

/**
 * Checks if the input is effectively empty.
 */
export function isInputEmpty(container: HTMLElement): boolean {
  // Check the text content of the rich-textarea
  const textarea =
    container.querySelector('rich-textarea') ||
    container.querySelector('textarea') ||
    container.querySelector('[contenteditable="true"]');
  if (!textarea) return true;

  // Check for attachments. If attachments exist, the input is not considered empty.
  const attachmentsArea =
    container.querySelector(composerPackaged['composer.uploadPreview']) ||
    container.querySelector(composerPackaged['composer.uploadPreviewFallback']);
  if (attachmentsArea) return false;

  const text = textarea.textContent?.trim() || '';
  return text.length === 0;
}

/**
 * Adds the placeholder element to the container if it doesn't exist.
 */
export function ensurePlaceholder(container: HTMLElement) {
  if (container.querySelector(`.${PLACEHOLDER_CLASS}`)) return;

  const placeholder = document.createElement('div');
  placeholder.className = PLACEHOLDER_CLASS;

  // Use i18n for the placeholder text
  let text = getTranslationSync('inputCollapsePlaceholder') || 'Message Gemini';

  placeholder.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
        <path d="M240-400h320v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z"/>
      </svg>
      <span>${text}</span>
    `;

  container.appendChild(placeholder);
}

/**
 * Check if an element is part of input-related UI (menus, overlays, etc.)
 * This prevents collapse when clicking model selector, attachment button, etc.
 */
export function isInputRelatedElement(element: HTMLElement, container: HTMLElement): boolean {
  if (!element) return false;

  // Check if the element is or is inside known input-related containers
  const INPUT_RELATED_SELECTORS = [
    // Material/CDK overlays (menus, dialogs, autocomplete dropdowns)
    '.cdk-overlay-container',
    '.mat-mdc-menu-panel',
    '.mat-mdc-dialog-container',
    '.ng-trigger',
    // Model selector and related UI
    '[role="listbox"]',
    '[role="option"]',
    '[role="combobox"]',
    // Attachment and file-related UI
    '[data-test-id*="attachment"]',
    '[data-test-id*="upload"]',
    '[data-test-id*="file"]',
  ];

  // Combine selectors into a single string for better performance
  const combinedSelector = INPUT_RELATED_SELECTORS.join(', ');
  if (element.matches(combinedSelector) || element.closest(combinedSelector)) {
    return true;
  }

  // Additional heuristic: check if element is within a reasonable proximity
  // to the input container (within 5 levels up, but not the body/main)
  let parent = element.parentElement;
  let levels = 0;
  while (parent && levels < 5) {
    // If we reach body or main, we've gone too far
    if (parent.tagName === 'BODY' || parent.tagName === 'MAIN') {
      break;
    }
    // If we find the container, the element is input-related
    if (parent === container) {
      return true;
    }
    parent = parent.parentElement;
    levels++;
  }

  return false;
}

/**
 * Moves the cursor to the end of the content in a contenteditable element
 */
export function moveCursorToEndOfElement(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();

  const targetNode = element.lastChild || element;

  range.selectNodeContents(targetNode);
  range.collapse(false); // false = collapse to end

  selection.removeAllRanges();
  selection.addRange(range);
}
