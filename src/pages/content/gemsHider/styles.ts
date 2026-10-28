/** The section hider's class names and its injected stylesheet. */
export const STYLE_ID = 'gv-sidebar-section-hider-style';
export const HIDDEN_CLASS = 'gv-sidebar-section-hidden';
export const PEEK_BAR_CLASS = 'gv-sidebar-section-peek-bar';
export const TOGGLE_BTN_CLASS = 'gv-sidebar-section-toggle-btn';
export const TARGET_CLASS = 'gv-sidebar-section-hider-target';
export const TOOLTIP_ID = 'gv-sidebar-section-tooltip';
export const TOOLTIP_VISIBLE_CLASS = 'gv-visible';
export const ARROW_ICON_SELECTOR = '[data-test-id="arrow-icon"]';

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${TARGET_CLASS} {
      position: relative;
      transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .${TOGGLE_BTN_CLASS} {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: none;
      background: transparent;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transform: scale(0.8);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      color: var(--gm3-sys-color-on-surface-variant, #5f6368);
      vertical-align: middle;
      margin-right: 4px;
    }

    .${TOGGLE_BTN_CLASS}:hover {
      background: var(--gm3-sys-color-surface-container-highest, rgba(0, 0, 0, 0.12));
      transform: scale(1.1);
    }

    .${TOGGLE_BTN_CLASS}:active {
      transform: scale(0.95);
    }

    .${TOGGLE_BTN_CLASS} svg {
      width: 16px;
      height: 16px;
      transition: transform 0.2s ease;
    }

    ${ARROW_ICON_SELECTOR}:hover .${TOGGLE_BTN_CLASS},
    .gv-folder-header:hover .${TOGGLE_BTN_CLASS},
    .${TOGGLE_BTN_CLASS}:hover {
      opacity: 1;
      transform: scale(1);
    }

    /* Absolute-placement variant: mounted on the expandable-section itself
     * (e.g. Notebooks) instead of nested inside the header button. Reveals on
     * hover of the parent section. */
    .${TOGGLE_BTN_CLASS}--absolute {
      position: absolute;
      top: 4px;
      right: 8px;
      margin-right: 0;
      z-index: 2;
    }
    expandable-section:hover > .${TOGGLE_BTN_CLASS}--absolute,
    .${TOGGLE_BTN_CLASS}--absolute:hover,
    .${TOGGLE_BTN_CLASS}--absolute:focus-visible {
      opacity: 1;
      transform: scale(1);
    }

    .${HIDDEN_CLASS} {
      max-height: 0 !important;
      overflow: hidden !important;
      opacity: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      pointer-events: none !important;
    }

    .${PEEK_BAR_CLASS} {
      height: 6px;
      margin: 8px 16px;
      border-radius: 3px;
      background: linear-gradient(
        90deg,
        transparent 0%,
        var(--gm3-sys-color-outline-variant, rgba(0, 0, 0, 0.08)) 20%,
        var(--gm3-sys-color-outline-variant, rgba(0, 0, 0, 0.08)) 80%,
        transparent 100%
      );
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      display: none;
    }

    .${PEEK_BAR_CLASS}::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 40px;
      height: 4px;
      border-radius: 2px;
      background: var(--gm3-sys-color-primary, #1a73e8);
      opacity: 0;
      transition: all 0.2s ease;
    }

    .${PEEK_BAR_CLASS}:hover {
      height: 12px;
      background: linear-gradient(
        90deg,
        transparent 0%,
        var(--gm3-sys-color-primary-container, rgba(26, 115, 232, 0.12)) 15%,
        var(--gm3-sys-color-primary-container, rgba(26, 115, 232, 0.12)) 85%,
        transparent 100%
      );
    }

    .${PEEK_BAR_CLASS}:hover::after {
      opacity: 1;
      width: 60px;
    }

    #${TOOLTIP_ID} {
      position: fixed;
      left: 0;
      top: 0;
      padding: 6px 12px;
      background: var(--gm3-sys-color-inverse-surface, #303030);
      color: var(--gm3-sys-color-inverse-on-surface, #f5f5f5);
      font-family: 'Google Sans', Roboto, sans-serif;
      font-size: 12px;
      font-weight: 500;
      border-radius: 8px;
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 10000;
      transform: translate(-50%, calc(-100% - 8px));
    }

    #${TOOLTIP_ID}.${TOOLTIP_VISIBLE_CLASS} {
      opacity: 1;
    }

    .${PEEK_BAR_CLASS}.gv-visible {
      display: block;
    }

    @media (prefers-color-scheme: dark) {
      .${TOGGLE_BTN_CLASS} {
        background: rgba(255, 255, 255, 0.08);
        color: #e8eaed;
      }

      .${TOGGLE_BTN_CLASS}:hover {
        background: rgba(255, 255, 255, 0.14);
      }

      .${PEEK_BAR_CLASS} {
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(255, 255, 255, 0.06) 20%,
          rgba(255, 255, 255, 0.06) 80%,
          transparent 100%
        );
      }

      .${PEEK_BAR_CLASS}:hover {
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(138, 180, 248, 0.15) 15%,
          rgba(138, 180, 248, 0.15) 85%,
          transparent 100%
        );
      }

      .${PEEK_BAR_CLASS}::after {
        background: #8ab4f8;
      }
    }

    body[data-theme="dark"] .${TOGGLE_BTN_CLASS},
    body.dark-theme .${TOGGLE_BTN_CLASS} {
      background: rgba(255, 255, 255, 0.08);
      color: #e8eaed;
    }

    body[data-theme="dark"] .${TOGGLE_BTN_CLASS}:hover,
    body.dark-theme .${TOGGLE_BTN_CLASS}:hover {
      background: rgba(255, 255, 255, 0.14);
    }
  `;

  document.head.appendChild(style);
}
