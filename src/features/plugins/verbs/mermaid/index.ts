/**
 * `mermaid` primitive: Gemini's Mermaid renderer (`pages/content/mermaid`) on
 * a site's code blocks, through the shared engine in `codeBlockDiagram.ts`
 * (its reference implementation). Gemini's official plugin uses it; ChatGPT
 * draws Mermaid itself, so its plugin lists only ECharts and WaveDrom. The same
 * `shouldRenderMermaid` decides which blocks are Mermaid on every site, the
 * library stays a lazy import, and the theme follows `html[data-gv-scheme]`.
 */
import { mermaidExportHtml } from '@/features/export/services/exportCodeBlocks';
import { createMermaidErrorCard, createStyles } from '@/pages/content/mermaid/codeBlock';
import { createMermaidFullscreen } from '@/pages/content/mermaid/fullscreen';
import { MermaidRenderer } from '@/pages/content/mermaid/renderer';
import { normalizeMermaidCode, shouldRenderMermaid } from '@/pages/content/mermaid/source';
import type { Scheme } from '@/pages/content/platformTheme/scheme';

import {
  type CodeBlockDiagram,
  type CodeBlockDiagramParams,
  activateCodeBlockDiagram,
  validateCodeBlockDiagramParams,
} from '../codeBlockDiagram';
import { getPrimitiveContract } from '../contracts';
import { leaseDiagramStyle } from '../diagramStyleLease';
import type { Primitive } from '../types';

/** Holds the fullscreen viewer's styles; Gemini installs the same element. */
const MERMAID_STYLES_ID = 'gv-mermaid-styles';

/** The SVG element `markup` holds, or null. */
function parseSvg(markup: string): SVGSVGElement | null {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content.querySelector('svg');
}

/** `exportImage` draws a light copy in a dark theme, so export always carries the light diagram. */
function mermaidDiagram(exportImage: boolean): CodeBlockDiagram {
  let scheme: Scheme = 'light';
  const renderer = new MermaidRenderer(() => scheme);
  const fullscreen = createMermaidFullscreen();
  /** Each drawn panel's light SVG, sanitized; absent for an error card or a missing light copy. */
  const lightSvgs = new WeakMap<HTMLElement, string>();
  return {
    name: 'mermaid',
    kind: 'mermaid',
    // The syntax-error card reads Gemini's colour token; give it the panel's.
    css: '.diagram { --gemini-on-surface-variant: var(--gv-diagram-fg); }',
    matches: shouldRenderMermaid,
    prepare(next) {
      scheme = next;
      return renderer.initialize();
    },
    async render(target, source) {
      lightSvgs.delete(target);
      // Without exportImage, export reads the code block, so no second light-theme render.
      const diagram = await renderer.render(normalizeMermaidCode(source), {
        lightExport: exportImage,
      });
      if (!diagram) throw new Error('Mermaid is unavailable');
      if (diagram.errorMessage !== null) {
        target.replaceChildren(createMermaidErrorCard(diagram.errorMessage));
        return;
      }
      target.innerHTML = diagram.svg;
      if (!exportImage) return;
      const light = diagram.theme === 'dark' ? diagram.lightExportSvg : target.innerHTML;
      if (light) lightSvgs.set(target, light);
    },
    exportHtml(target) {
      const svg = parseSvg(lightSvgs.get(target) ?? '');
      return svg ? mermaidExportHtml(svg) : null;
    },
    openFullscreen(target) {
      if (target.querySelector('svg')) fullscreen.open(target.innerHTML);
    },
    install(doc) {
      const release = leaseDiagramStyle(doc, MERMAID_STYLES_ID, createStyles);
      // An open viewer belongs to this activation: turning the plugin off closes it and its listeners.
      return () => {
        renderer.dispose();
        fullscreen.close();
        release();
      };
    },
  };
}

export const mermaidPrimitive: Primitive<CodeBlockDiagramParams> = {
  contract: getPrimitiveContract('mermaid')!,
  validateParams: validateCodeBlockDiagramParams,
  activate(scope, params, context) {
    activateCodeBlockDiagram(scope, params, context, mermaidDiagram(params.exportImage === true));
  },
};
