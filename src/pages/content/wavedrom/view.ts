import { DIAGRAM_TOOLBAR_BUTTON_CSS } from '@/core/ui/diagramToolbar';

/** Styles shared by the active diagram panels and their fullscreen viewer. */
export function createWaveDromView() {
  const STYLES_ID = 'gv-wavedrom-styles';

  const createStyles = (panelBg: string) => {
    const existing = document.getElementById(STYLES_ID);
    if (existing) return;

    const style = document.createElement('style');
    style.id = STYLES_ID;
    style.textContent = `
    .gv-wavedrom-wrapper {
      position: relative;
    }

    /* Sits above the diagram, not over it: a timing diagram has no top margin to float on. */
    .gv-wavedrom-toggle {
      display: flex;
      width: fit-content;
      margin: 8px 8px 4px auto;
      align-items: center;
      gap: 4px;
      background: var(--gemini-surface-container, rgba(0,0,0,0.05));
      border-radius: 8px;
      padding: 2px;
      border: 1px solid var(--gemini-outline-variant, rgba(0,0,0,0.1));
    }

    .gv-wavedrom-toggle button {
      ${DIAGRAM_TOOLBAR_BUTTON_CSS}
      padding: 5px 7px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-family: 'Google Sans', sans-serif;
      transition: all 0.2s ease;
      background: transparent;
      color: var(--gemini-on-surface-variant, #666);
    }

    .gv-wavedrom-toggle button:hover {
      background: var(--gemini-surface-container-high, rgba(0,0,0,0.08));
    }

    .gv-wavedrom-toggle button.active {
      background: var(--gemini-primary, #1a73e8);
      color: white;
    }

    .gv-wavedrom-diagram {
      padding: 16px;
      overflow-x: auto;
      background-color: ${panelBg};
      cursor: zoom-in;
    }

    .gv-wavedrom-diagram svg {
      max-width: 100%;
      height: auto;
    }

    /* Fullscreen modal */
    .gv-wavedrom-modal {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.9);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .gv-wavedrom-modal.visible {
      opacity: 1;
    }

    .gv-wavedrom-modal-toolbar {
      position: fixed;
      top: 16px;
      right: 16px;
      display: flex;
      gap: 8px;
      z-index: 1000000;
    }

    .gv-wavedrom-modal-toolbar button {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: rgba(255, 255, 255, 0.2);
      color: white;
      font-size: 18px;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .gv-wavedrom-modal-toolbar button:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.1);
    }

    .gv-wavedrom-modal-content {
      position: relative;
      cursor: grab;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: center;
      max-width: calc(100vw - 80px);
      max-height: calc(100vh - 80px);
    }

    .gv-wavedrom-modal-content.dragging {
      cursor: grabbing;
    }

    /* SVG fills the overlay card (fix for fixed pixel width/height roots). */
    .gv-wavedrom-modal-content svg {
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
    }

    .gv-wavedrom-modal-hint {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      color: rgba(255, 255, 255, 0.6);
      font-size: 14px;
      font-family: 'Google Sans', sans-serif;
      pointer-events: none;
    }
  `;
    document.head.appendChild(style);
  };

  return { createStyles };
}
