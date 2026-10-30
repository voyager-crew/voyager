import mermaid from 'mermaid';

import { installMermaidImageFallback } from './imageFallback';
import type { MermaidRenderRequest, MermaidRenderResult } from './protocol';
import { MERMAID_FONT_FAMILY, sanitizeMermaidSvg } from './sanitize';

const MERMAID_LIGHT_THEME_DIRECTIVE = '%%{init: {"theme":"default"}}%%';

/** Runs only in the extension renderer document, never against the host DOM or its fonts. */
export async function renderMermaidDocument(
  request: MermaidRenderRequest,
): Promise<MermaidRenderResult> {
  installMermaidImageFallback(document, chrome.runtime.getURL(''));
  mermaid.initialize({
    startOnLoad: false,
    theme: request.theme === 'dark' ? 'dark' : 'default',
    // SVG labels preserve text across sanitization in both Mermaid versions.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    securityLevel: 'strict',
    fontFamily: MERMAID_FONT_FAMILY,
    logLevel: 5,
  });

  const draw = async (id: string, source: string): Promise<string> => {
    // Firefox bundles v9; Chrome and Safari bundle v11.
    const output = await mermaid.render(id, source);
    return sanitizeMermaidSvg(typeof output === 'string' ? output : output.svg);
  };

  let svg: string;
  try {
    svg = await draw(request.id, request.code);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      id: request.id,
      svg: '',
      lightExportSvg: null,
      errorMessage: message.length > 100 ? message.slice(0, 100) + '...' : message,
      theme: request.theme,
    };
  }

  let lightExportSvg: string | null = null;
  if (request.lightExport && request.theme === 'dark') {
    try {
      lightExportSvg = await draw(
        `${request.id}-export`,
        `${request.code}\n${MERMAID_LIGHT_THEME_DIRECTIVE}`,
      );
    } catch {
      // A missing light copy must not hide a successful page diagram.
    }
  }

  return { id: request.id, svg, lightExportSvg, errorMessage: null, theme: request.theme };
}
