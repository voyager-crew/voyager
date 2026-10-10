/**
 * `mermaid` primitive: Gemini's Mermaid renderer (`pages/content/mermaid`) on
 * another site's code blocks, through the shared engine in `codeBlockDiagram.ts`
 * (its reference implementation). No bundled plugin uses it yet: ChatGPT draws
 * Mermaid itself, so its plugin lists only ECharts and WaveDrom. The same
 * `shouldRenderMermaid` decides which blocks are Mermaid on every site, the
 * library stays a lazy import, and the theme follows `html[data-gv-scheme]`.
 */
import { createMermaidErrorCard, createStyles } from '@/pages/content/mermaid/codeBlock';
import { openFullscreen } from '@/pages/content/mermaid/fullscreen';
import { MermaidRenderer, sanitizeMermaidSvg } from '@/pages/content/mermaid/renderer';
import { normalizeMermaidCode, shouldRenderMermaid } from '@/pages/content/mermaid/source';
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
const MERMAID_STYLES_ID = 'gv-mermaid-styles';

function mermaidDiagram(): CodeBlockDiagram {
  let scheme: Scheme = 'light';
  const renderer = new MermaidRenderer(() => scheme);
  return {
    name: 'mermaid',
    label: '📊 Diagram',
    // The syntax-error card reads Gemini's colour token; give it the panel's.
    css: '.diagram { --gemini-on-surface-variant: var(--gv-diagram-fg); }',
    matches: shouldRenderMermaid,
    prepare(next) {
      scheme = next;
      return renderer.initialize();
    },
    async render(target, source) {
      // No light export copy: plugin sites export the code block, not the diagram.
      const diagram = await renderer.render(normalizeMermaidCode(source), { lightExport: false });
      if (!diagram) throw new Error('Mermaid is unavailable');
      if (diagram.errorMessage !== null) {
        target.replaceChildren(createMermaidErrorCard(diagram.errorMessage));
      } else {
        target.innerHTML = await sanitizeMermaidSvg(diagram.svg);
      }
    },
    openFullscreen(target) {
      if (target.querySelector('svg')) openFullscreen(target.innerHTML);
    },
    install(doc) {
      if (doc.getElementById(MERMAID_STYLES_ID)) return () => {};
      createStyles();
      return () => doc.getElementById(MERMAID_STYLES_ID)?.remove();
    },
  };
}

export const mermaidPrimitive: Primitive<CodeBlockDiagramParams> = {
  contract: getPrimitiveContract('mermaid')!,
  validateParams: validateCodeBlockDiagramParams,
  activate(scope, params, context) {
    activateCodeBlockDiagram(scope, params, context, mermaidDiagram());
  },
};
