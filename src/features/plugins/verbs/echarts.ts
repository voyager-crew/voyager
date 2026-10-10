/**
 * `echarts` primitive: Gemini's ECharts renderer (`pages/content/echarts`) on
 * another site's code blocks, through the shared engine in `codeBlockDiagram.ts`.
 * The same `shouldRenderECharts` decides which blocks are charts on every site,
 * the options are parsed and sanitized as on Gemini (never evaluated), the
 * library stays a lazy import, and the theme follows `html[data-gv-scheme]`.
 */
import { getDiagramToolbarLabels } from '@/core/ui/diagramToolbar';
import { createEChartsFullscreen } from '@/pages/content/echarts/fullscreen';
import { CHART_HEIGHT, PANEL_BG, createEChartsRenderer } from '@/pages/content/echarts/renderer';
import { parseEChartsOption, shouldRenderECharts } from '@/pages/content/echarts/source';
import { createEChartsView } from '@/pages/content/echarts/view';
import type { Scheme } from '@/pages/content/platformTheme/scheme';

import {
  type CodeBlockDiagram,
  type CodeBlockDiagramParams,
  activateCodeBlockDiagram,
  validateCodeBlockDiagramParams,
} from './codeBlockDiagram';
import { getPrimitiveContract } from './contracts';
import type { Primitive } from './types';

/** Holds the fullscreen viewer's styles; Gemini installs the same element. */
const ECHARTS_STYLES_ID = 'gv-echarts-styles';
/** Gemini's chart container class, which the fullscreen styles size. */
const CHART_CLASS = 'gv-echarts-diagram';

function echartsDiagram(): CodeBlockDiagram {
  let scheme: Scheme = 'light';
  const renderer = createEChartsRenderer();
  const fullscreen = createEChartsFullscreen(renderer.resize);
  return {
    name: 'echarts',
    kind: 'echarts',
    // The chart paints its own backdrop and takes clicks, so no padding or zoom cursor.
    css: `.diagram { padding: 0; overflow: hidden; cursor: auto; }
.${CHART_CLASS} {
  height: ${CHART_HEIGHT}px;
  padding: 16px;
  box-sizing: border-box;
  background-color: var(--gv-echarts-panel-bg);
}`,
    fullscreenLabel: getDiagramToolbarLabels().fullscreen,
    matches: shouldRenderECharts,
    async prepare(next) {
      scheme = next;
      return (await renderer.load()) !== null;
    },
    async render(target, source) {
      const option = await parseEChartsOption(source);
      // As on Gemini, a block that does not parse as a chart stays code.
      if (!option) throw new Error('Not an ECharts option');
      const chart = target.ownerDocument.createElement('div');
      chart.className = CHART_CLASS;
      chart.style.setProperty('--gv-echarts-panel-bg', PANEL_BG[scheme]);
      target.replaceChildren(chart);
      renderer.render(chart, option, scheme);
      renderer.observe(chart);
      return () => {
        // Fullscreen moved the live chart out of the panel; put it back first.
        if (!target.contains(chart)) fullscreen.close();
        renderer.dispose(chart);
        chart.remove();
      };
    },
    openFullscreen(target) {
      const chart = target.querySelector<HTMLElement>(`.${CHART_CLASS}`);
      if (chart) fullscreen.open(chart);
    },
    install(doc) {
      renderer.startResizeObserver();
      const ownsStyles = !doc.getElementById(ECHARTS_STYLES_ID);
      // The view only lends its stylesheet; its wrappers are Gemini's.
      if (ownsStyles) createEChartsView(renderer, fullscreen).createStyles();
      return () => {
        fullscreen.close();
        renderer.stopResizeObserver();
        if (ownsStyles) doc.getElementById(ECHARTS_STYLES_ID)?.remove();
      };
    },
  };
}

export const echartsPrimitive: Primitive<CodeBlockDiagramParams> = {
  contract: getPrimitiveContract('echarts')!,
  validateParams: validateCodeBlockDiagramParams,
  activate(scope, params, context) {
    activateCodeBlockDiagram(scope, params, context, echartsDiagram());
  },
};
