import { DIAGRAM_TOOLBAR_BUTTON_CSS, setDiagramToolbarButton } from '@/core/ui/diagramToolbar';

import type { WaveDromFullscreen } from './fullscreen';

interface NativeControlPlacement {
  parent: Node | null;
  nextSibling: Node | null;
  styleAttribute: string | null;
}

const nativeControlPlacements = new WeakMap<HTMLElement, NativeControlPlacement>();

/**
 * Move Gemini's native code-block copy button into the toggle toolbar.
 * The toolbar overlays the code block in Code view, so a native copy button
 * left in place gets covered. Mirrors the Mermaid renderer's approach.
 *
 * @returns the moved button, or null when no native copy button was found.
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

/** Owns reversible host wrapping, native-copy placement, view controls and computed styles. */
export const createWaveDromView = (fullscreen: WaveDromFullscreen) => {
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

  // Invalid or reclassified source must use the same teardown as disable, or stale diagrams survive.
  function teardown(wrapper: HTMLElement): void {
    fullscreen.close();
    const codeBlockHost = wrapper.querySelector<HTMLElement>(':scope > code-block');
    if (!codeBlockHost) {
      wrapper.remove();
      return;
    }

    const nativeCopyBtn =
      wrapper.querySelector<HTMLElement>('.gv-wavedrom-toggle .buttons') ??
      wrapper.querySelector<HTMLElement>('.gv-wavedrom-toggle .copy-button');
    if (nativeCopyBtn && !restoreNativeCopyButton(nativeCopyBtn)) {
      // Hot reload can preserve the wrapper but lose its WeakMap placement;
      // keep the copy control even when its old position is unknown.
      (codeBlockHost.querySelector('.code-block-decoration') ?? codeBlockHost).appendChild(
        nativeCopyBtn,
      );
    }

    codeBlockHost.style.display = '';
    codeBlockHost
      .querySelectorAll<HTMLElement>('code[data-test-id="code-content"]')
      .forEach((code) => {
        delete code.dataset.wavedromCode;
        delete code.dataset.wavedromProcessing;
      });
    wrapper.parentElement?.insertBefore(codeBlockHost, wrapper);
    wrapper.remove();
  }

  function teardownForCode(codeEl: Element): void {
    const wrapper = codeEl.closest<HTMLElement>('.gv-wavedrom-wrapper');
    if (wrapper) teardown(wrapper);
  }

  const ensure = (codeBlockHost: HTMLElement, panelBg: string): HTMLElement | null => {
    // Build or reuse the wrapper.
    let wrapper = codeBlockHost.parentElement;
    if (!wrapper?.classList.contains('gv-wavedrom-wrapper')) {
      wrapper = document.createElement('div');
      wrapper.className = 'gv-wavedrom-wrapper';
      codeBlockHost.parentElement?.insertBefore(wrapper, codeBlockHost);
      wrapper.appendChild(codeBlockHost);

      const toggleContainer = document.createElement('div');
      toggleContainer.className = 'gv-wavedrom-toggle';

      // Move the native copy button into the toolbar so it is not covered by
      // the overlay in Code view (same fix as the Mermaid renderer).
      moveNativeCopyButton(codeBlockHost, toggleContainer);

      const diagramBtn = document.createElement('button');
      setDiagramToolbarButton(diagramBtn, 'wavedrom');
      diagramBtn.className = 'active';
      diagramBtn.dataset.view = 'diagram';

      const codeBtn = document.createElement('button');
      setDiagramToolbarButton(codeBtn, 'code');
      codeBtn.dataset.view = 'code';

      toggleContainer.append(diagramBtn, codeBtn);
      wrapper.prepend(toggleContainer);

      const diagramContainer = document.createElement('div');
      diagramContainer.className = 'gv-wavedrom-diagram';
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

      diagramContainer.addEventListener('click', () => {
        const svgEl = diagramContainer.querySelector('svg');
        if (svgEl) fullscreen.open(diagramContainer.innerHTML, panelBg);
      });
    }

    return wrapper.querySelector<HTMLElement>('.gv-wavedrom-diagram');
  };

  return {
    createStyles,
    ensure,
    teardownForCode,
    clear() {
      fullscreen.close();
      document.querySelectorAll<HTMLElement>('.gv-wavedrom-wrapper').forEach(teardown);
      document.getElementById(STYLES_ID)?.remove();
    },
  };
};

export type WaveDromView = ReturnType<typeof createWaveDromView>;
