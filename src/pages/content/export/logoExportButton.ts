import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/export-entry-packaged.json';

/**
 * Export button in a hover dropdown under Gemini's logo (pre-lr26 layout).
 *
 * The logo is moved into a `gv-logo-dropdown-wrapper` next to the dropdown.
 * Gemini re-renders the header on resize and around `window.print()`, which
 * can destroy the wrapper; the button is re-created 800 ms after the last
 * `resize`, `afterprint` or `gv-print-cleanup` event if it left the document.
 */

const REINJECT_DEBOUNCE_MS = 800;
const LOGO_SELECTORS = packaged['exportEntry.logo'];
const SWALLOWED_PRESS_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup'];

type BindableButton = HTMLButtonElement & { _gvBound?: boolean };

export interface LogoExportButtonTexts {
  label: string;
  title: string;
}

export interface LogoExportButtonOptions {
  /** Texts for a newly created button, read on mount and on every re-creation. */
  texts: () => LogoExportButtonTexts;
  onClick: () => void;
}

export interface LogoExportButton {
  /**
   * Apply new texts to the button created at mount. A button re-created after
   * a header re-render reads `texts()` instead.
   */
  relabel: (texts: LogoExportButtonTexts) => void;
  /** Stop re-creating the button. The button itself stays in place. */
  stop: () => void;
  /** Stop, then remove the dropdown and put the logo back where it was. */
  remove: () => void;
}

function swallow(e: Event): void {
  try {
    e.preventDefault();
  } catch {}
  try {
    e.stopPropagation();
  } catch {}
}

function ensureDropdownInjected(logoElement: Element): HTMLButtonElement | null {
  // Check if already injected
  const existingWrapper = document.querySelector('.gv-logo-dropdown-wrapper');
  if (existingWrapper) {
    return existingWrapper.querySelector('.gv-export-dropdown-btn') as HTMLButtonElement | null;
  }

  const logo = logoElement as HTMLElement;
  const parent = logo.parentElement;
  if (!parent) return null;

  // Create wrapper that will contain both logo and dropdown
  const wrapper = document.createElement('div');
  wrapper.className = 'gv-logo-dropdown-wrapper';

  // Move logo into wrapper
  parent.insertBefore(wrapper, logo);
  wrapper.appendChild(logo);

  // Create dropdown container
  const dropdown = document.createElement('div');
  dropdown.className = 'gv-logo-dropdown';

  // Create export button inside dropdown
  const btn = document.createElement('button');
  btn.className = 'gv-export-dropdown-btn';
  btn.type = 'button';
  btn.title = 'Export chat history';
  btn.setAttribute('aria-label', 'Export chat history');

  // Export icon
  const iconSpan = document.createElement('span');
  iconSpan.className = 'gv-export-dropdown-icon';
  btn.appendChild(iconSpan);

  // Export text label
  const labelSpan = document.createElement('span');
  labelSpan.className = 'gv-export-dropdown-label';
  labelSpan.textContent = 'Export';
  btn.appendChild(labelSpan);

  dropdown.appendChild(btn);
  wrapper.appendChild(dropdown);

  return btn;
}

function applyTexts(btn: HTMLButtonElement, texts: LogoExportButtonTexts): void {
  btn.title = texts.title;
  btn.setAttribute('aria-label', texts.title);
  const labelEl = btn.querySelector('.gv-export-dropdown-label');
  if (labelEl) labelEl.textContent = texts.label;
}

/**
 * Inject (or adopt) the dropdown button and bind it once. The press events are
 * swallowed so the logo's own navigation to /app does not fire. Returns null
 * when the button cannot be injected or is already bound.
 */
function bindLogoButton(logo: Element, options: LogoExportButtonOptions): HTMLButtonElement | null {
  const btn = ensureDropdownInjected(logo) as BindableButton | null;
  if (!btn) return null;
  if (btn._gvBound) return null;
  btn._gvBound = true;

  // Capture low-level press events to avoid parent logo navigation, but do NOT capture 'click'
  SWALLOWED_PRESS_EVENTS.forEach((type) => {
    try {
      btn.addEventListener(type, swallow, true);
    } catch {}
  });
  applyTexts(btn, options.texts());

  btn.addEventListener('click', (ev) => {
    // Stop parent navigation, but allow this handler to run
    swallow(ev);
    try {
      options.onClick();
    } catch (err) {
      try {
        console.error('Gemini Voyager export failed', err);
      } catch {}
    }
  });
  return btn;
}

export function mountLogoExportButton(
  logo: Element,
  options: LogoExportButtonOptions,
): LogoExportButton | null {
  const btn = bindLogoButton(logo, options);
  if (!btn) return null;

  let currentBtn: HTMLButtonElement = btn;
  let reinjectTimer: ReturnType<typeof setTimeout> | null = null;

  const reinjectExportButtonIfNeeded = () => {
    // Debounce: Gemini fires many mutations during resize; wait until it
    // settles before we attempt re-injection.
    if (reinjectTimer !== null) clearTimeout(reinjectTimer);
    reinjectTimer = setTimeout(() => {
      reinjectTimer = null;
      try {
        // If the button is still in the document, nothing to do.
        if (document.body.contains(currentBtn)) return;

        // Remove stale wrapper if it somehow survived but lost the button.
        const staleWrapper = document.querySelector('.gv-logo-dropdown-wrapper');
        if (staleWrapper) staleWrapper.remove();

        // Re-find the logo element (Gemini may have created a fresh one).
        const newLogo =
          document.querySelector(LOGO_SELECTORS[0]) ?? document.querySelector(LOGO_SELECTORS[1]);
        if (!newLogo) return;

        const newBtn = bindLogoButton(newLogo, options);
        if (!newBtn) return;
        // Update our tracking reference so the next check uses the new element.
        currentBtn = newBtn;
      } catch (e) {
        try {
          console.debug('[Gemini Voyager] Export button re-injection failed:', e);
        } catch {}
      }
    }, REINJECT_DEBOUNCE_MS);
  };

  window.addEventListener('resize', reinjectExportButtonIfNeeded);
  window.addEventListener('gv-print-cleanup', reinjectExportButtonIfNeeded);
  window.addEventListener('afterprint', reinjectExportButtonIfNeeded);

  const stop = () => {
    if (reinjectTimer !== null) clearTimeout(reinjectTimer);
    reinjectTimer = null;
    window.removeEventListener('resize', reinjectExportButtonIfNeeded);
    window.removeEventListener('gv-print-cleanup', reinjectExportButtonIfNeeded);
    window.removeEventListener('afterprint', reinjectExportButtonIfNeeded);
  };
  return {
    relabel: (texts) => applyTexts(btn, texts),
    stop,
    remove: () => {
      stop();
      const wrapper = currentBtn.closest('.gv-logo-dropdown-wrapper');
      if (!wrapper) {
        currentBtn.remove();
        return;
      }
      // Everything but our dropdown is the logo we moved in; it goes back in place.
      for (const child of Array.from(wrapper.children)) {
        if (!child.classList.contains('gv-logo-dropdown')) wrapper.before(child);
      }
      wrapper.remove();
    },
  };
}
