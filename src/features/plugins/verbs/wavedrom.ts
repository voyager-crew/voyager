/**
 * `wavedrom` primitive: Gemini's WaveDrom renderer (`pages/content/wavedrom`)
 * on another site's code blocks, through the shared engine in
 * `codeBlockDiagram.ts`. The same `shouldRenderWaveDrom` decides which blocks
 * are WaveJSON on every site, the library stays a lazy import, and the render
 * theme follows Gemini's policy (`WAVEDROM_THEME_MODE`) on `html[data-gv-scheme]`.
 */
import { createWaveDromFullscreen } from '@/pages/content/wavedrom/fullscreen';
import {
  createWaveDromRenderer,
  PANEL_BG,
  resolveWaveRenderTheme,
  shouldRenderWaveDrom,
  WAVEDROM_THEME_MODE,
} from '@/pages/content/wavedrom/renderer';
import { createWaveDromView } from '@/pages/content/wavedrom/view';

import {
  type CodeBlockDiagram,
  type CodeBlockDiagramParams,
  activateCodeBlockDiagram,
  validateCodeBlockDiagramParams,
} from './codeBlockDiagram';
import { getPrimitiveContract } from './contracts';
import type { Primitive } from './types';

/** Holds the fullscreen viewer's styles; Gemini installs the same element. */
const WAVEDROM_STYLES_ID = 'gv-wavedrom-styles';

/**
 * Header labels a host gives a block that has no language tag. ChatGPT shows a
 * localized "plain text" (measured: 纯文本). Like Gemini's generic labels, they
 * leave the block to content detection.
 */
const UNTAGGED_LABELS: ReadonlySet<string> = new Set(['纯文本', 'plain text']);

/** Whether a block is WaveDrom, deciding exactly as Gemini does once an untagged label is cleared. */
function matchesWaveDrom(language: string | null, source: string): boolean {
  return shouldRenderWaveDrom(language && UNTAGGED_LABELS.has(language) ? null : language, source);
}

function waveDromDiagram(): CodeBlockDiagram {
  let theme = resolveWaveRenderTheme(WAVEDROM_THEME_MODE, 'light');
  const renderer = createWaveDromRenderer();
  const fullscreen = createWaveDromFullscreen();
  return {
    name: 'wavedrom',
    label: '〜 Diagram',
    matches: matchesWaveDrom,
    prepare(scheme) {
      theme = resolveWaveRenderTheme(WAVEDROM_THEME_MODE, scheme);
      return renderer.load();
    },
    async render(target, source) {
      const svg = await renderer.render(source, theme === 'dark');
      // Invalid or still-streaming WaveJSON shows the code, as on Gemini; a changed source retries.
      if (!svg) throw new Error('Not a WaveDrom diagram');
      // The skin's exact backdrop: the light diagram stays readable on a dark page.
      target.style.backgroundColor = PANEL_BG[theme];
      target.innerHTML = svg;
    },
    openFullscreen(target) {
      if (target.querySelector('svg')) fullscreen.open(target.innerHTML, PANEL_BG[theme]);
    },
    install(doc) {
      if (doc.getElementById(WAVEDROM_STYLES_ID)) return fullscreen.close;
      createWaveDromView(fullscreen).createStyles(PANEL_BG[theme]);
      return () => {
        fullscreen.close();
        doc.getElementById(WAVEDROM_STYLES_ID)?.remove();
      };
    },
  };
}

export const wavedromPrimitive: Primitive<CodeBlockDiagramParams> = {
  contract: getPrimitiveContract('wavedrom')!,
  validateParams: validateCodeBlockDiagramParams,
  activate(scope, params, context) {
    activateCodeBlockDiagram(scope, params, context, waveDromDiagram());
  },
};
