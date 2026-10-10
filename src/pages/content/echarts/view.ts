import {
  DIAGRAM_TOOLBAR_BUTTON_CSS,
  getDiagramToolbarLabels,
  setDiagramToolbarButton,
} from '@/core/ui/diagramToolbar';

import { provideEChartsDataUrl } from './exportBridge';
import type { createEChartsFullscreen } from './fullscreen';
import { CHART_HEIGHT, PANEL_BG, type createEChartsRenderer } from './renderer';

interface NativeControlPlacement {
  parent: Node | null;
  nextSibling: Node | null;
  styleAttribute: string | null;
}

const nativeControlPlacements = new WeakMap<HTMLElement, NativeControlPlacement>();

/**
 * Move Gemini's native code-block copy button into the toggle toolbar.
 * Keeping the native control in the renderer toolbar prevents duplicate copy
 * affordances while preserving Gemini's implementation and exact teardown.
 *
 * @returns the moved button, or null when no native copy button was found.
 * @internal Exported for testing.
 */
export const moveNativeCopyButton = (
  codeBlockHost: HTMLElement,
  target: HTMLElement,
): HTMLElement | null => {
  const nativeCopyBtn =
    codeBlockHost.querySelector('.buttons') || codeBlockHost.querySelector('.copy-button');
  if (!nativeCopyBtn) return null;
  const nativeCopyElement = nativeCopyBtn as HTMLElement;
  if (!nativeControlPlacements.has(nativeCopyElement)) {
    nativeControlPlacements.set(nativeCopyElement, {
      parent: nativeCopyElement.parentNode,
      nextSibling: nativeCopyElement.nextSibling,
      styleAttribute: nativeCopyElement.getAttribute('style'),
    });
  }
  // Reset positioning that might conflict with the toolbar layout.
  nativeCopyElement.style.position = 'static';
  nativeCopyElement.style.top = 'auto';
  nativeCopyElement.style.right = 'auto';
  nativeCopyElement.style.marginTop = '0';
  target.appendChild(nativeCopyElement);
  return nativeCopyElement;
};

const restoreNativeCopyButton = (nativeCopyElement: HTMLElement): boolean => {
  const placement = nativeControlPlacements.get(nativeCopyElement);
  if (!placement) return false;

  if (placement.styleAttribute === null) nativeCopyElement.removeAttribute('style');
  else nativeCopyElement.setAttribute('style', placement.styleAttribute);

  if (placement.parent) {
    const insertionPoint =
      placement.nextSibling?.parentNode === placement.parent ? placement.nextSibling : null;
    placement.parent.insertBefore(nativeCopyElement, insertionPoint);
  }
  nativeControlPlacements.delete(nativeCopyElement);
  return true;
};

export function createEChartsView(
  renderer: ReturnType<typeof createEChartsRenderer>,
  fullscreen: ReturnType<typeof createEChartsFullscreen>,
) {
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

    .gv-echarts-toggle {
      display: flex;
      align-items: center;
      gap: 4px;
      width: fit-content;
      margin: 8px 8px 4px auto;
      background: var(--gemini-surface-container, rgba(0,0,0,0.05));
      border-radius: 8px;
      padding: 2px;
      border: 1px solid var(--gemini-outline-variant, rgba(0,0,0,0.1));
    }

    .gv-echarts-toggle button {
      ${DIAGRAM_TOOLBAR_BUTTON_CSS}
      padding: 4px 10px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-family: 'Google Sans', sans-serif;
      transition: all 0.2s ease;
      background: transparent;
      color: var(--gemini-on-surface-variant, #666);
    }

    .gv-echarts-toggle button:hover {
      background: var(--gemini-surface-container-high, rgba(0,0,0,0.08));
    }

    .gv-echarts-toggle button.active {
      background: var(--gemini-primary, #1a73e8);
      color: white;
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
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .gv-echarts-modal-toolbar button:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.1);
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
      font-size: 14px;
      font-family: 'Google Sans', sans-serif;
      pointer-events: none;
    }
  `;
    document.head.appendChild(style);
  };

  function ensure(codeBlockHost: HTMLElement, onDiagramRequested: () => void) {
    // Build or reuse the wrapper.
    let wrapper = codeBlockHost.parentElement;
    if (!wrapper?.classList.contains('gv-echarts-wrapper')) {
      wrapper = document.createElement('div');
      wrapper.className = 'gv-echarts-wrapper';
      codeBlockHost.parentElement?.insertBefore(wrapper, codeBlockHost);
      wrapper.appendChild(codeBlockHost);

      const toggleContainer = document.createElement('div');
      toggleContainer.className = 'gv-echarts-toggle';

      // Move the native copy button into the toolbar so it is not covered by
      // the overlay in Code view (same fix as the WaveDrom renderer).
      moveNativeCopyButton(codeBlockHost, toggleContainer);

      const labels = getDiagramToolbarLabels();
      const diagramBtn = document.createElement('button');
      setDiagramToolbarButton(diagramBtn, 'echarts', labels.diagram);
      diagramBtn.className = 'active';
      diagramBtn.dataset.view = 'diagram';
      diagramBtn.setAttribute('aria-pressed', 'true');

      const codeBtn = document.createElement('button');
      setDiagramToolbarButton(codeBtn, 'code', labels.code);
      codeBtn.dataset.view = 'code';
      codeBtn.setAttribute('aria-pressed', 'false');

      const fullscreenBtn = document.createElement('button');
      setDiagramToolbarButton(fullscreenBtn, 'fullscreen', labels.fullscreen, { iconOnly: true });
      fullscreenBtn.dataset.action = 'fullscreen';

      toggleContainer.append(diagramBtn, codeBtn, fullscreenBtn);
      wrapper.insertBefore(toggleContainer, codeBlockHost);

      const diagramContainer = document.createElement('div');
      diagramContainer.className = 'gv-echarts-diagram';
      wrapper.appendChild(diagramContainer);
      provideEChartsDataUrl(diagramContainer, () => renderer.getDataUrl(diagramContainer), wrapper);

      codeBlockHost.style.display = 'none';

      const updateView = (view: 'diagram' | 'code') => {
        if (view === 'diagram') {
          codeBlockHost.style.display = 'none';
          diagramContainer.style.display = 'block';
          diagramBtn.classList.add('active');
          codeBtn.classList.remove('active');
          diagramBtn.setAttribute('aria-pressed', 'true');
          codeBtn.setAttribute('aria-pressed', 'false');
          fullscreenBtn.disabled = false;
          onDiagramRequested();
          // The canvas is sized 0 while hidden; resize after reveal.
          renderer.resize(diagramContainer);
        } else {
          codeBlockHost.style.display = '';
          diagramContainer.style.display = 'none';
          diagramBtn.classList.remove('active');
          codeBtn.classList.add('active');
          diagramBtn.setAttribute('aria-pressed', 'false');
          codeBtn.setAttribute('aria-pressed', 'true');
          fullscreenBtn.disabled = true;
        }
      };

      diagramBtn.addEventListener('click', () => updateView('diagram'));
      codeBtn.addEventListener('click', () => updateView('code'));

      fullscreenBtn.addEventListener('click', () => {
        fullscreen.open(diagramContainer);
      });

      renderer.observe(diagramContainer);
    }

    const diagramContainer = fullscreen.findContainer(wrapper);
    if (!diagramContainer) {
      teardownEchartsWrapper(wrapper);
      return null;
    }

    return diagramContainer;
  }
  function teardownEchartsWrapper(wrapper: HTMLElement): void {
    fullscreen.closeForWrapper(wrapper);

    const diagramContainer = wrapper.querySelector<HTMLElement>(':scope > .gv-echarts-diagram');
    if (diagramContainer) renderer.dispose(diagramContainer);

    const codeBlockHost = wrapper.querySelector<HTMLElement>(':scope > code-block');
    if (!codeBlockHost) {
      wrapper.remove();
      return;
    }

    const nativeCopyBtn =
      wrapper.querySelector<HTMLElement>('.gv-echarts-toggle .buttons') ??
      wrapper.querySelector<HTMLElement>('.gv-echarts-toggle .copy-button');
    if (nativeCopyBtn && !restoreNativeCopyButton(nativeCopyBtn)) {
      // A wrapper can survive an extension hot reload while the module-level
      // WeakMap cannot. Preserve the control in that recovery case even though
      // its pre-reload sibling position is no longer knowable.
      (codeBlockHost.querySelector('.code-block-decoration') ?? codeBlockHost).appendChild(
        nativeCopyBtn,
      );
    }

    codeBlockHost.style.display = '';
    codeBlockHost
      .querySelectorAll<HTMLElement>('code[data-test-id="code-content"]')
      .forEach((code) => {
        delete code.dataset.echartsCode;
        delete code.dataset.echartsTheme;
        delete code.dataset.echartsProcessing;
      });
    wrapper.parentElement?.insertBefore(codeBlockHost, wrapper);
    wrapper.remove();
  }

  const cleanupDetachedChartInstances = (): void => {
    fullscreen.closeDetached();
    for (const container of renderer.containers()) {
      if (!container.isConnected) {
        renderer.dispose(container);
        continue;
      }
      const wrapper = fullscreen.ownerOf(container);
      if (wrapper && !wrapper.querySelector(':scope > code-block')) {
        teardownEchartsWrapper(wrapper);
      }
    }
  };

  const teardownRenderedEcharts = () => {
    fullscreen.close();
    for (const container of renderer.containers()) {
      renderer.dispose(container);
    }
    document.querySelectorAll<HTMLElement>('.gv-echarts-wrapper').forEach((wrapper) => {
      teardownEchartsWrapper(wrapper);
    });
  };

  return {
    ensure,
    createStyles,
    teardown: teardownEchartsWrapper,
    cleanupDetached: cleanupDetachedChartInstances,
    clear() {
      teardownRenderedEcharts();
      document.getElementById(STYLES_ID)?.remove();
    },
  };
}
