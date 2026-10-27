import { DIAGRAM_TOOLBAR_BUTTON_CSS } from '@/core/ui/diagramToolbar';

import { CHART_HEIGHT, PANEL_BG } from './renderer';

/** Styles shared by the active diagram panels and their fullscreen viewer. */
export function createEChartsView() {
  const STYLES_ID = 'gv-echarts-styles';

  const createStyles = () => {
    const existing = document.getElementById(STYLES_ID);
    if (existing) return;

    const style = document.createElement('style');
    style.id = STYLES_ID;
    style.textContent = `
    .gv-echarts-wrapper {
      position: relative;
    }

    /* A segmented control like the folder settings' sort: a neutral selected face, never a brand fill. */
    .gv-echarts-toggle {
      display: flex;
      align-items: center;
      gap: 2px;
      width: fit-content;
      margin: 8px 8px 4px auto;
      padding: 2px;
      border-radius: 9px;
      background: color-mix(in srgb, var(--gv-ui-text, #1f1f1f) 6%, transparent);
    }

    .gv-echarts-toggle button {
      ${DIAGRAM_TOOLBAR_BUTTON_CSS}
      min-width: 28px;
      height: 24px;
      padding: 0 6px;
      border: none;
      border-radius: 7px;
      cursor: pointer;
      font: 500 12px/1 var(--gv-ui-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
      transition: background-color 160ms ease, color 160ms ease;
      background: transparent;
      color: var(--gv-ui-text-muted, #5f6368);
    }

    .gv-echarts-toggle button:hover:not(.active):not(:disabled) {
      background: var(--gv-ui-hover, rgba(0, 0, 0, 0.06));
    }

    .gv-echarts-toggle button:focus-visible {
      outline: 2px solid var(--gv-ui-focus-ring, var(--gv-pm-brand, var(--gv-pm-brand-default)));
      outline-offset: 1px;
    }

    .gv-echarts-toggle button.active {
      background: var(--gv-ui-surface, #fff);
      color: var(--gv-ui-text, #1f1f1f);
      box-shadow: 0 1px 3px oklch(0 0 0 / 0.12);
    }

    html[data-gv-scheme='dark'] .gv-echarts-toggle button.active {
      background: oklch(0.38 0.01 285);
    }

    @media (prefers-reduced-motion: reduce) {
      .gv-echarts-toggle button { transition: none; }
    }

    .gv-echarts-diagram {
      height: ${CHART_HEIGHT}px;
      padding: 16px;
      box-sizing: border-box;
      background-color: var(--gv-echarts-panel-bg, ${PANEL_BG.light});
      overflow: hidden;
    }

    .gv-echarts-toggle button:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    /* Fullscreen modal */
    .gv-echarts-modal {
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

    .gv-echarts-modal.visible {
      opacity: 1;
    }

    .gv-echarts-modal-toolbar {
      position: fixed;
      top: 16px;
      right: 16px;
      display: flex;
      gap: 8px;
      z-index: 1000000;
    }

    .gv-echarts-modal-toolbar button {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: rgba(255, 255, 255, 0.2);
      color: white;
      font-size: 18px;
      cursor: pointer;
      transition: background-color 160ms ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .gv-echarts-modal-toolbar button:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .gv-echarts-modal-toolbar button:focus-visible {
      outline: 2px solid rgba(255, 255, 255, 0.8);
      outline-offset: 2px;
    }

    .gv-echarts-modal-card {
      border-radius: 8px;
      padding: 12px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      width: min(calc(100vw - 96px), 1200px);
      height: calc(100vh - 120px);
    }

    /* The moved chart container fills the card; canvas resizes with it. */
    .gv-echarts-modal-card .gv-echarts-diagram {
      width: 100%;
      height: 100%;
      padding: 0;
    }

    .gv-echarts-modal-hint {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      color: rgba(255, 255, 255, 0.6);
      font: 14px/1.4 var(--gv-ui-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
      pointer-events: none;
    }
  `;
    document.head.appendChild(style);
  };

  return { createStyles };
}
