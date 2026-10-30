import {
  cssCanFetch,
  decodeCssEscapes,
  stripCssComments,
} from '@/features/plugins/manifest/sinkGuards';

import { MERMAID_FONT_FAMILY, normalizeMermaidFonts } from './fonts';

export { MERMAID_FONT_FAMILY } from './fonts';

const MERMAID_FORBIDDEN_TAGS = [
  'a',
  'animate',
  'animateMotion',
  'animateTransform',
  'audio',
  'base',
  'button',
  'embed',
  'form',
  'iframe',
  'image',
  'img',
  'input',
  'link',
  'meta',
  'object',
  'script',
  'set',
  'source',
  'video',
];
const MERMAID_FORBIDDEN_ATTRIBUTES = [
  'action',
  'background',
  'download',
  'formaction',
  'face',
  'href',
  'poster',
  'src',
  'srcdoc',
  'srcset',
  'target',
  'xlink:href',
  'xml:base',
];
const CSS_PRESENTATION_ATTRIBUTE =
  /^(?:fill|stroke|filter|clip-path|mask|marker|marker-start|marker-mid|marker-end|cursor)$/i;

function containsUnsafeMermaidCss(value: string): boolean {
  const normalized = decodeCssEscapes(stripCssComments(value)).toLowerCase();
  return (
    // The shared tokenizer keeps comment-like text inside a quoted URL intact.
    cssCanFetch(value) ||
    /@(?:import|font-face)\b/.test(normalized) ||
    /(?:^|[;{])\s*position\s*:\s*(?:fixed|sticky)/.test(normalized) ||
    /(?:^|[;{])\s*inset(?:-[a-z]+)?\s*:/.test(normalized) ||
    /(?:expression|behavior|-moz-binding)\s*[:(]/.test(normalized)
  );
}

/** Only inert SVG may leave the renderer document and enter the host page. */
export async function sanitizeMermaidSvg(svg: string): Promise<string> {
  const DOMPurifyModule = await import('dompurify');
  const DOMPurify = DOMPurifyModule.default ?? DOMPurifyModule;
  const sanitized = DOMPurify.sanitize(svg, {
    FORBID_ATTR: MERMAID_FORBIDDEN_ATTRIBUTES,
    FORBID_TAGS: MERMAID_FORBIDDEN_TAGS,
    KEEP_CONTENT: true,
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
  });
  const template = document.createElement('template');
  template.innerHTML = sanitized;

  template.content.querySelectorAll('style').forEach((style) => {
    const css = style.textContent ?? '';
    if (containsUnsafeMermaidCss(css)) style.remove();
    else style.textContent = normalizeMermaidFonts(css);
  });
  template.content.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) {
        element.removeAttribute(attribute.name);
      } else if (CSS_PRESENTATION_ATTRIBUTE.test(attribute.name) && cssCanFetch(attribute.value)) {
        element.removeAttribute(attribute.name);
      } else if (attribute.name.toLowerCase() === 'font-family') {
        element.setAttribute(attribute.name, MERMAID_FONT_FAMILY);
      }
    }
    if (element instanceof HTMLElement || element instanceof SVGElement) {
      const css = element.getAttribute('style') ?? '';
      if (containsUnsafeMermaidCss(css)) element.removeAttribute('style');
      else if (css) element.setAttribute('style', normalizeMermaidFonts(css));
      // Even an SVG without font declarations must not inherit a host @font-face.
      element.style.removeProperty('font-family');
      element.style.setProperty('font-family', MERMAID_FONT_FAMILY, 'important');
    }
  });
  // Mermaid double-escapes ampersands; decode only sanitized SVG text, never markup.
  template.content.querySelectorAll('text, tspan').forEach((element) => {
    element.childNodes.forEach((node) => {
      if (node.nodeType === 3 && node.textContent?.includes('&amp;')) {
        node.textContent = node.textContent.replace(/&amp;/gi, '&');
      }
    });
  });

  return template.innerHTML;
}
