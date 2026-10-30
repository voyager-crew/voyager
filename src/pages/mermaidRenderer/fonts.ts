import { decodeCssEscapes, stripCssComments } from '@/features/plugins/manifest/sinkGuards';

/** Generic names cannot resolve to a host page's downloadable @font-face. */
export const MERMAID_FONT_FAMILY = 'system-ui, sans-serif';

function normalizeDeclaration(declaration: string): string {
  const withoutComments = stripCssComments(declaration);
  const colon = withoutComments.indexOf(':');
  if (colon < 0) return declaration;
  const property = decodeCssEscapes(withoutComments.slice(0, colon)).trim().toLowerCase();
  if (property !== 'font' && property !== 'font-family') return declaration;

  const value = withoutComments.slice(colon + 1);
  const priority = /!\s*important\s*$/i.test(value) ? 'important' : '';
  const suffix = priority ? ' !important' : '';
  if (property === 'font-family') return `font-family: ${MERMAID_FONT_FAMILY}${suffix}`;

  // Let the browser expand the shorthand so weight, size and line-height survive.
  // This empty, detached element is never laid out and cannot request a font.
  const style = document.createElement('span').style;
  style.setProperty('font', value.replace(/!\s*important\s*$/i, '').trim(), priority);
  if (!style.fontSize || style.fontSize.includes('var(')) {
    return `font-family: ${MERMAID_FONT_FAMILY}${suffix}`;
  }
  const longhands = [
    'font-style',
    'font-variant',
    'font-weight',
    'font-stretch',
    'font-size',
    'line-height',
  ]
    .map((name) => [name, style.getPropertyValue(name)])
    .filter(([, next]) => next)
    .map(([name, next]) => `${name}: ${next}${suffix}`);
  return [...longhands, `font-family: ${MERMAID_FONT_FAMILY}${suffix}`].join('; ');
}

/** Rewrites declarations without treating a string's semicolons/braces as CSS syntax. */
export function normalizeMermaidFonts(css: string): string {
  let result = '';
  let start = 0;
  let parentheses = 0;
  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    if (char === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      i = close < 0 ? css.length : close + 1;
    } else if (char === '\\') {
      i++;
    } else if (char === '"' || char === "'") {
      const quote = char;
      while (++i < css.length && css[i] !== quote) {
        if (css[i] === '\\') i++;
      }
    } else if (char === '(') {
      parentheses++;
    } else if (char === ')') {
      parentheses = Math.max(0, parentheses - 1);
    } else if (!parentheses && (char === '{' || char === '}' || char === ';')) {
      const segment = css.slice(start, i);
      result += (char === '{' ? segment : normalizeDeclaration(segment)) + char;
      start = i + 1;
    }
  }
  return result + normalizeDeclaration(css.slice(start));
}
