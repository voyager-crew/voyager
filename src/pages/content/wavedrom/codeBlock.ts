import { logger } from '@/core/services/LoggerService';

import {
  getAppTheme,
  PANEL_BG,
  resolveWaveRenderTheme,
  shouldRenderWaveDrom,
  WAVEDROM_THEME_MODE,
  type WaveDromRenderer,
} from './renderer';
import type { WaveDromView } from './view';

const getCodeBlockLanguage = (codeEl: Element): string | null => {
  const codeBlock = codeEl.closest('.code-block, code-block');
  if (!codeBlock) return null;
  const decoration = codeBlock.querySelector('.code-block-decoration');
  if (!decoration) return null;
  const langSpan = decoration.querySelector(':scope > span');
  const language = langSpan?.textContent?.trim().toLowerCase();
  return language || null;
};

/** Owns block eligibility and generation/source checks across asynchronous SVG rendering. */
export const createWaveDromCodeBlocks = (renderer: WaveDromRenderer, view: WaveDromView) => {
  let wavedromEnabled = true;
  let renderGeneration = 0;

  const renderWaveDrom = async (codeEl: HTMLElement, code: string) => {
    if (!wavedromEnabled) return;
    if (codeEl.dataset.wavedromCode === code) return;
    if (codeEl.dataset.wavedromProcessing === 'true') return;

    codeEl.dataset.wavedromProcessing = 'true';
    const generationAtStart = renderGeneration;

    try {
      const codeBlockHost = codeEl.closest('code-block') as HTMLElement;
      if (!codeBlockHost) {
        codeEl.dataset.wavedromProcessing = 'false';
        return;
      }

      const appTheme = getAppTheme();
      const renderTheme = resolveWaveRenderTheme(WAVEDROM_THEME_MODE, appTheme);
      const panelBg = PANEL_BG[renderTheme];

      view.createStyles(panelBg);

      const svg = await renderer.render(code, renderTheme === 'dark');
      if (!svg) {
        const latestCode = codeEl.textContent || '';
        if (latestCode !== code && wavedromEnabled && generationAtStart === renderGeneration) {
          codeEl.dataset.wavedromProcessing = 'false';
          void renderWaveDrom(codeEl, latestCode);
          return;
        }
        codeEl.dataset.wavedromProcessing = 'false';
        view.teardownForCode(codeEl);
        return;
      }
      if (!wavedromEnabled || generationAtStart !== renderGeneration) {
        codeEl.dataset.wavedromProcessing = 'false';
        return;
      }
      const latestCode = codeEl.textContent || '';
      if (latestCode !== code) {
        codeEl.dataset.wavedromProcessing = 'false';
        void renderWaveDrom(codeEl, latestCode);
        return;
      }

      // Update the backdrop if the render theme changed.
      const diagramContainer = view.ensure(codeBlockHost, panelBg);
      if (!diagramContainer) {
        codeEl.dataset.wavedromProcessing = 'false';
        return;
      }
      diagramContainer.style.backgroundColor = panelBg;
      diagramContainer.innerHTML = svg;

      codeEl.dataset.wavedromCode = code;
      codeEl.dataset.wavedromProcessing = 'false';
      logger.info('[Gemini Voyager] WaveDrom diagram rendered');
    } catch {
      codeEl.dataset.wavedromProcessing = 'false';
      view.teardownForCode(codeEl);
      const codeBlockHost = codeEl.closest('code-block') as HTMLElement | null;
      if (codeBlockHost) codeBlockHost.style.display = '';
    }
  };

  const process = () => {
    const codeElements = document.querySelectorAll('code[data-test-id="code-content"]');
    codeElements.forEach((codeEl) => {
      const codeText = codeEl.textContent || '';
      const language = getCodeBlockLanguage(codeEl);

      if (shouldRenderWaveDrom(language, codeText)) {
        void renderWaveDrom(codeEl as HTMLElement, codeText);
        return;
      }
      view.teardownForCode(codeEl);
    });
  };

  return {
    process,
    get enabled() {
      return wavedromEnabled;
    },
    setEnabled(enabled: boolean) {
      wavedromEnabled = enabled;
      if (!enabled) renderGeneration += 1;
    },
    clear: view.clear,
  };
};

export type WaveDromCodeBlocks = ReturnType<typeof createWaveDromCodeBlocks>;
