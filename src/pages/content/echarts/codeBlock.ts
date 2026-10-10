import {
  getAppTheme,
  PANEL_BG,
  resolveEChartsRenderTheme,
  type createEChartsRenderer,
} from './renderer';
import {
  getCodeBlockLanguage,
  isEChartsLanguageEligible,
  parseEChartsOption,
  shouldRenderECharts,
} from './source';
import type { createEChartsView } from './view';

const THEME_MODE = 'auto';

export function createEChartsCodeBlocks(
  renderer: ReturnType<typeof createEChartsRenderer>,
  view: ReturnType<typeof createEChartsView>,
) {
  let echartsEnabled = true;
  let renderGeneration = 0;

  const finishStaleRender = (codeEl: HTMLElement) => {
    codeEl.dataset.echartsProcessing = 'false';
    if (echartsEnabled && codeEl.isConnected) {
      void renderEcharts(codeEl, codeEl.textContent || '');
    }
  };

  function restoreSource(codeEl: HTMLElement, host: HTMLElement): void {
    const wrapper = host.parentElement;
    if (wrapper?.classList.contains('gv-echarts-wrapper')) view.teardown(wrapper);
    else codeEl.dataset.echartsProcessing = 'false';
  }

  function canContinue(
    codeEl: HTMLElement,
    host: HTMLElement,
    code: string,
    generation: number,
  ): boolean {
    if (!codeEl.isConnected || !host.isConnected) {
      codeEl.dataset.echartsProcessing = 'false';
      return false;
    }
    if (!echartsEnabled || generation !== renderGeneration) {
      finishStaleRender(codeEl);
      return false;
    }
    const latestCode = codeEl.textContent || '';
    if (latestCode !== code) {
      codeEl.dataset.echartsProcessing = 'false';
      void renderEcharts(codeEl, latestCode);
      return false;
    }
    return true;
  }

  function displayChart(
    codeEl: HTMLElement,
    host: HTMLElement,
    code: string,
    parsed: Record<string, unknown>,
  ): void {
    // Read theme after both awaits so a switch during loading is not lost.
    const renderTheme = resolveEChartsRenderTheme(THEME_MODE, getAppTheme());
    const panelBg = PANEL_BG[renderTheme];
    const diagramContainer = view.ensure(host, () => {
      void renderEcharts(codeEl, codeEl.textContent || '');
    });
    if (!diagramContainer) return;
    diagramContainer.style.setProperty('--gv-echarts-panel-bg', panelBg);
    if (diagramContainer.parentElement?.classList.contains('gv-echarts-modal-card')) {
      diagramContainer.parentElement.style.setProperty('--gv-echarts-panel-bg', panelBg);
    }
    if (diagramContainer.style.display === 'none') {
      codeEl.dataset.echartsProcessing = 'false';
      return;
    }
    renderer.render(diagramContainer, parsed, renderTheme);
    codeEl.dataset.echartsCode = code;
    codeEl.dataset.echartsTheme = renderTheme;
    codeEl.dataset.echartsProcessing = 'false';
  }

  const renderEcharts = async (codeEl: HTMLElement, code: string) => {
    if (!echartsEnabled || !isEChartsLanguageEligible(codeEl)) return;
    const requestedRenderTheme = resolveEChartsRenderTheme(THEME_MODE, getAppTheme());
    // Skip when nothing changed — the theme is part of the key so an explicit
    // Gemini theme switch re-renders existing charts in the new theme.
    if (codeEl.dataset.echartsCode === code && codeEl.dataset.echartsTheme === requestedRenderTheme)
      return;
    if (codeEl.dataset.echartsProcessing === 'true') return;

    codeEl.dataset.echartsProcessing = 'true';
    const generationAtStart = renderGeneration;

    try {
      const codeBlockHost = codeEl.closest('code-block') as HTMLElement;
      if (!codeBlockHost) {
        codeEl.dataset.echartsProcessing = 'false';
        return;
      }

      view.createStyles();

      const parsed = await parseEChartsOption(code);
      if (!parsed) {
        const latestCode = codeEl.textContent || '';
        if (
          latestCode !== code &&
          echartsEnabled &&
          generationAtStart === renderGeneration &&
          codeEl.isConnected &&
          codeBlockHost.isConnected
        ) {
          codeEl.dataset.echartsProcessing = 'false';
          void renderEcharts(codeEl, latestCode);
          return;
        }
        restoreSource(codeEl, codeBlockHost);
        return;
      }
      if (!canContinue(codeEl, codeBlockHost, code, generationAtStart)) return;

      const echarts = await renderer.load();
      if (!echarts) {
        restoreSource(codeEl, codeBlockHost);
        return;
      }
      if (!canContinue(codeEl, codeBlockHost, code, generationAtStart)) return;

      if (!isEChartsLanguageEligible(codeEl)) {
        restoreSource(codeEl, codeBlockHost);
        return;
      }

      displayChart(codeEl, codeBlockHost, code, parsed);
    } catch {
      const codeBlockHost = codeEl.closest('code-block') as HTMLElement;
      const wrapper = codeBlockHost?.parentElement;
      if (wrapper?.classList.contains('gv-echarts-wrapper')) {
        view.teardown(wrapper);
      } else {
        codeEl.dataset.echartsProcessing = 'false';
        if (codeBlockHost) codeBlockHost.style.display = '';
      }
    }
  };

  const processCodeBlocks = () => {
    view.cleanupDetached();
    const codeElements = document.querySelectorAll('code[data-test-id="code-content"]');
    codeElements.forEach((codeEl) => {
      const codeText = codeEl.textContent || '';
      if (shouldRenderECharts(getCodeBlockLanguage(codeEl), codeText)) {
        void renderEcharts(codeEl as HTMLElement, codeText);
      } else {
        const wrapper = codeEl.closest<HTMLElement>('.gv-echarts-wrapper');
        if (wrapper) view.teardown(wrapper);
      }
    });
  };

  return {
    process: processCodeBlocks,
    get enabled() {
      return echartsEnabled;
    },
    setEnabled(enabled: boolean) {
      echartsEnabled = enabled;
      if (!enabled) renderGeneration += 1;
    },
    clear: view.clear,
  };
}
