export type MermaidTheme = 'dark' | 'light';
type MermaidLibrary = Awaited<typeof import('mermaid')>['default'];

const MERMAID_LIGHT_THEME_DIRECTIVE = '%%{init: {"theme":"default"}}%%';

const MERMAID_FORBIDDEN_TAGS = [
  'a',
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
  'source',
  'video',
];
const MERMAID_FORBIDDEN_ATTRIBUTES = [
  'action',
  'download',
  'formaction',
  'href',
  'poster',
  'src',
  'srcdoc',
  'srcset',
  'target',
  'xlink:href',
];

function decodeCssEscapes(value: string): string {
  return value.replace(/\\([0-9a-f]{1,6}\s?|.)/gi, (_match, escaped: string) => {
    const hex = escaped.trim();
    if (/^[0-9a-f]{1,6}$/i.test(hex)) {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
    }
    return escaped;
  });
}

function containsUnsafeMermaidCss(value: string): boolean {
  // Contained tooltip stacking is safe; rejecting its z-index removes the whole theme.
  const normalized = decodeCssEscapes(value)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .toLowerCase();
  return (
    /(?:^|[;{])\s*position\s*:\s*(?:fixed|sticky)/.test(normalized) ||
    /(?:^|[;{])\s*inset(?:-[a-z]+)?\s*:/.test(normalized) ||
    /@import|(?:expression|behavior|-moz-binding)\s*[:(]/.test(normalized) ||
    /url\s*\(\s*(?!["']?#)/.test(normalized)
  );
}

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
    if (containsUnsafeMermaidCss(style.textContent ?? '')) style.remove();
  });
  template.content.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    const value = element.getAttribute('style') ?? '';
    if (containsUnsafeMermaidCss(value)) element.removeAttribute('style');
  });
  template.content.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (
        /^(?:fill|stroke|filter|clip-path|mask|marker-start|marker-mid|marker-end)$/i.test(
          attribute.name,
        ) &&
        /url\s*\(\s*(?!["']?#)/i.test(attribute.value)
      ) {
        element.removeAttribute(attribute.name);
      }
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

/**
 * Resolve the Mermaid theme from Gemini's explicit page state before falling
 * back to the browser's system preference.
 */
export function resolveMermaidTheme(doc: Document, prefersDark: boolean): 'dark' | 'default' {
  const body = doc.body;
  const root = doc.documentElement;

  if (doc.querySelector('.theme-host.dark-theme')) return 'dark';
  if (doc.querySelector('.theme-host.light-theme')) return 'default';

  const hasExplicitDarkTheme = Boolean(
    body.classList.contains('dark-theme') ||
    root.classList.contains('dark') ||
    body.getAttribute('data-theme') === 'dark',
  );
  if (hasExplicitDarkTheme) return 'dark';

  const hasExplicitLightTheme = Boolean(
    body.classList.contains('light-theme') ||
    root.classList.contains('light') ||
    body.getAttribute('data-theme') === 'light',
  );
  if (hasExplicitLightTheme) return 'default';

  return prefersDark ? 'dark' : 'default';
}

const getMermaidTheme = (): MermaidTheme =>
  resolveMermaidTheme(document, window.matchMedia('(prefers-color-scheme: dark)').matches) ===
  'dark'
    ? 'dark'
    : 'light';

/**
 * Owns the lazy library cache and the theme used by the active configuration.
 * `resolveTheme` defaults to Gemini's page state; plugin sites pass
 * `html[data-gv-scheme]`.
 */
export class MermaidRenderer {
  private instance: MermaidLibrary | null = null;
  private loadFailed = false;
  private initializedTheme: MermaidTheme | null = null;

  constructor(private readonly resolveTheme: () => MermaidTheme = getMermaidTheme) {}

  private async load(): Promise<MermaidLibrary | null> {
    if (this.instance) return this.instance;
    if (this.loadFailed) return null;

    try {
      const mod = await import('mermaid');
      this.instance = mod.default;
      return this.instance;
    } catch (error) {
      this.loadFailed = true;
      console.error('[Gemini Voyager] Failed to load Mermaid library:', error);
      return null;
    }
  }

  async initialize(): Promise<boolean> {
    const mermaid = await this.load();
    if (!mermaid) return false;

    const theme = this.resolveTheme();
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      // SVG text labels survive sanitization; foreignObject labels disappear.
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      securityLevel: 'strict',
      fontFamily: 'Google Sans, Roboto, sans-serif',
      logLevel: 5, // 5 = fatal (v9.x uses numbers)
    });
    this.initializedTheme = theme;
    return true;
  }

  /**
   * Raw SVGs need sanitizing before insertion. Null means loading failed; syntax errors become text.
   * In a dark theme a light copy is rendered for export unless `lightExport` is false.
   */
  async render(normalizedCode: string, { lightExport = true }: { lightExport?: boolean } = {}) {
    const mermaid = await this.load();
    if (!mermaid) return null;

    // First, try to render to validate the code
    const uniqueId = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
    let svg: string;
    let renderedDiagram = false;
    let renderErrorMessage: string | null = null;

    try {
      // v9.x render returns string directly, v10.x returns {svg: string}
      const result = await mermaid.render(uniqueId, normalizedCode);
      svg = typeof result === 'string' ? result : (result as { svg: string }).svg;
      renderedDiagram = true;
    } catch (renderError) {
      // Mermaid failed - likely incomplete or invalid syntax

      // Clean up any error SVGs mermaid may have created
      const errorSvg = document.getElementById(uniqueId);
      if (errorSvg) errorSvg.remove();

      // Also clean up any floating error containers mermaid creates
      document.querySelectorAll('[id^="d"]').forEach((el) => {
        if (el.textContent?.includes('Syntax error') || el.querySelector('.error-icon')) {
          el.remove();
        }
      });

      // Create a friendly error message
      const errorMsg = renderError instanceof Error ? renderError.message : 'Unknown error';
      renderErrorMessage = errorMsg.length > 100 ? errorMsg.substring(0, 100) + '...' : errorMsg;
      svg = '';
    }

    let lightExportSvg: string | null = null;
    if (lightExport && renderedDiagram && this.initializedTheme === 'dark') {
      const exportId = `${uniqueId}-export`;
      try {
        const exportResult = await mermaid.render(
          exportId,
          `${normalizedCode}\n${MERMAID_LIGHT_THEME_DIRECTIVE}`,
        );
        lightExportSvg =
          typeof exportResult === 'string' ? exportResult : (exportResult as { svg: string }).svg;
      } catch {
        document.getElementById(exportId)?.remove();
      }
    }

    return {
      id: uniqueId,
      svg,
      lightExportSvg,
      errorMessage: renderErrorMessage,
      theme: this.initializedTheme,
    };
  }
}
