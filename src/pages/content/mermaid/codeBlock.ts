import { logger } from '@/core/services/LoggerService';
import {
  DIAGRAM_TOOLBAR_BUTTON_CSS,
  getDiagramToolbarLabels,
  setDiagramToolbarButton,
} from '@/core/ui/diagramToolbar';

import { openFullscreen } from './fullscreen';
import { type MermaidRenderer, sanitizeMermaidSvg } from './renderer';
import { normalizeMermaidCode } from './source';

const MERMAID_LIGHT_EXPORT_TEMPLATE_CLASS = 'gv-mermaid-light-export';

/**
 * Create styles for mermaid components and fullscreen viewer
 */
export const createStyles = () => {
  if (document.getElementById('gv-mermaid-styles')) return;

  const style = document.createElement('style');
  style.id = 'gv-mermaid-styles';
  style.textContent = `
    .gv-mermaid-wrapper {
      position: relative;
    }

    .gv-mermaid-toggle {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 10;
      display: flex;
      align-items: center; /* Center items vertically */
      gap: 4px;
      background: var(--gemini-surface-container, rgba(0,0,0,0.05));
      border-radius: 8px;
      padding: 2px;
      border: 1px solid var(--gemini-outline-variant, rgba(0,0,0,0.1));
    }

    .gv-mermaid-toggle button {
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

    .gv-mermaid-toggle button:hover {
      background: var(--gemini-surface-container-high, rgba(0,0,0,0.08));
    }

    .gv-mermaid-toggle button.active {
      background: var(--gemini-primary, #1a73e8);
      color: white;
    }

    .gv-mermaid-diagram {
      position: relative;
      padding: 16px;
      text-align: center;
      overflow: auto;
      min-height: 100px;
      cursor: zoom-in;
      contain: paint;
      isolation: isolate;
    }

    .gv-mermaid-diagram svg {
      max-width: 100%;
      height: auto;
    }

    /* Fullscreen Modal */
    .gv-mermaid-modal {
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

    .gv-mermaid-modal.visible {
      opacity: 1;
    }

    .gv-mermaid-modal-toolbar {
      position: fixed;
      top: 16px;
      right: 16px;
      display: flex;
      gap: 8px;
      z-index: 1000000;
    }

    .gv-mermaid-modal-toolbar button {
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

    .gv-mermaid-modal-toolbar button:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.1);
    }

    .gv-mermaid-modal-content {
      position: relative;
      cursor: grab;
      user-select: none;
    }

    .gv-mermaid-modal-content.dragging {
      cursor: grabbing;
    }

    .gv-mermaid-modal-content svg {
      max-width: none;
      max-height: none;
    }

    .gv-mermaid-modal-hint {
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

/** The card shown in place of a diagram whose source does not parse. */
export function createMermaidErrorCard(errorMessage: string): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText =
    'padding: 24px; text-align: center; color: var(--gemini-on-surface-variant, #666);';

  const icon = document.createElement('div');
  icon.style.cssText = 'font-size: 32px; margin-bottom: 12px;';
  icon.textContent = '⚠️';

  const title = document.createElement('div');
  title.style.cssText = 'font-weight: 500; margin-bottom: 8px;';
  title.textContent = 'Mermaid Syntax Error';

  const details = document.createElement('div');
  details.style.cssText =
    'font-size: 12px; opacity: 0.7; font-family: monospace; max-width: 400px; margin: 0 auto; word-break: break-word;';
  details.textContent = errorMessage;

  const hint = document.createElement('div');
  hint.style.cssText = 'margin-top: 12px; font-size: 13px;';
  hint.append('Click ');
  const codeLabel = document.createElement('b');
  codeLabel.textContent = '"Code"';
  hint.append(codeLabel, ' to view source');

  card.append(icon, title, details, hint);
  return card;
}

function getOrCreateWrapper(codeBlockHost: HTMLElement): HTMLElement {
  let wrapper = codeBlockHost.parentElement;
  if (!wrapper?.classList.contains('gv-mermaid-wrapper')) {
    wrapper = document.createElement('div');
    wrapper.className = 'gv-mermaid-wrapper';
    codeBlockHost.parentElement?.insertBefore(wrapper, codeBlockHost);
    wrapper.appendChild(codeBlockHost);

    // Toggle buttons
    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'gv-mermaid-toggle';

    // Try to find and move the native copy button to our toolbar
    // This prevents overlap/covering issues and keeps the UI clean
    // We look for .buttons container (newer Gemini) or .copy-button class
    const parentElement = wrapper?.parentElement || codeBlockHost.parentElement;
    const nativeCopyBtn =
      parentElement?.querySelector('.buttons') || parentElement?.querySelector('.copy-button');

    // Only move if it looks like the right button (close to the code block)
    if (nativeCopyBtn) {
      // Reset positioning that might conflict
      (nativeCopyBtn as HTMLElement).style.position = 'static';
      (nativeCopyBtn as HTMLElement).style.top = 'auto';
      (nativeCopyBtn as HTMLElement).style.right = 'auto';
      (nativeCopyBtn as HTMLElement).style.marginTop = '0';
      toggleContainer.appendChild(nativeCopyBtn);
    }

    const labels = getDiagramToolbarLabels();
    const diagramBtn = document.createElement('button');
    setDiagramToolbarButton(diagramBtn, 'mermaid', labels.diagram);
    diagramBtn.className = 'active';
    diagramBtn.dataset.view = 'diagram';

    const codeBtn = document.createElement('button');
    setDiagramToolbarButton(codeBtn, 'code', labels.code);
    codeBtn.dataset.view = 'code';

    toggleContainer.appendChild(diagramBtn);
    toggleContainer.appendChild(codeBtn);
    wrapper.appendChild(toggleContainer);

    // Diagram container
    const diagramContainer = document.createElement('div');
    diagramContainer.className = 'gv-mermaid-diagram';
    wrapper.appendChild(diagramContainer);

    codeBlockHost.style.display = 'none';

    const updateView = (view: 'diagram' | 'code') => {
      if (view === 'diagram') {
        codeBlockHost.style.display = 'none';
        diagramContainer.style.display = 'block';
        diagramBtn.classList.add('active');
        codeBtn.classList.remove('active');
      } else {
        codeBlockHost.style.display = '';
        diagramContainer.style.display = 'none';
        diagramBtn.classList.remove('active');
        codeBtn.classList.add('active');
      }
    };

    diagramBtn.addEventListener('click', () => updateView('diagram'));
    codeBtn.addEventListener('click', () => updateView('code'));

    // Click diagram to fullscreen (only if it's a valid SVG, not error)
    diagramContainer.addEventListener('click', () => {
      const svgElement = diagramContainer.querySelector('svg');
      if (svgElement) {
        openFullscreen(diagramContainer.innerHTML);
      }
    });
  }

  return wrapper;
}

/**
 * Render Mermaid diagram for a code block
 */
export const renderMermaid = async (
  codeBlock: HTMLElement,
  code: string,
  renderer: MermaidRenderer,
) => {
  // Normalize common copy/paste and model-output issues before processing.
  const normalizedCode = normalizeMermaidCode(code);
  if (codeBlock.dataset.mermaidCode === normalizedCode) return;
  if (codeBlock.dataset.mermaidProcessing === 'true') return;

  codeBlock.dataset.mermaidProcessing = 'true';

  try {
    const codeBlockHost = codeBlock.closest('code-block') as HTMLElement;
    if (!codeBlockHost) {
      codeBlock.dataset.mermaidProcessing = 'false';
      return;
    }

    const diagram = await renderer.render(normalizedCode);
    if (!diagram) {
      codeBlock.dataset.mermaidProcessing = 'false';
      return;
    }
    const { id, svg, lightExportSvg, errorMessage, theme } = diagram;

    const wrapper = getOrCreateWrapper(codeBlockHost);

    if (theme) {
      wrapper.dataset.gvMermaidTheme = theme;
    }

    const existingLightExport = wrapper.querySelector<HTMLTemplateElement>(
      `template.${MERMAID_LIGHT_EXPORT_TEMPLATE_CLASS}`,
    );
    if (lightExportSvg) {
      const lightExport = existingLightExport ?? document.createElement('template');
      lightExport.className = MERMAID_LIGHT_EXPORT_TEMPLATE_CLASS;
      lightExport.innerHTML = await sanitizeMermaidSvg(lightExportSvg);
      if (!existingLightExport) wrapper.appendChild(lightExport);
    } else {
      existingLightExport?.remove();
    }

    const diagramContainer = wrapper.querySelector('.gv-mermaid-diagram') as HTMLElement;
    if (!diagramContainer) {
      codeBlock.dataset.mermaidProcessing = 'false';
      return;
    }

    if (errorMessage !== null) {
      diagramContainer.replaceChildren(createMermaidErrorCard(errorMessage));
    } else {
      diagramContainer.innerHTML = await sanitizeMermaidSvg(svg);
    }

    codeBlock.dataset.mermaidCode = normalizedCode;
    codeBlock.dataset.mermaidProcessing = 'false';
    logger.info('[Gemini Voyager] Mermaid diagram rendered:', { id });
  } catch {
    codeBlock.dataset.mermaidProcessing = 'false';

    const codeBlockHost = codeBlock.closest('code-block') as HTMLElement;
    if (codeBlockHost) {
      codeBlockHost.style.display = '';
    }
  }
};
