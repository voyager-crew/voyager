import { createMermaidId } from '@/pages/mermaidRenderer/identifiers';
import type { MermaidTheme } from '@/pages/mermaidRenderer/protocol';

import { renderInIsolatedDocument } from './isolatedRender';

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

/** Owns the selected theme and the lifetime of this activation's isolated render requests. */
export class MermaidRenderer {
  private loadFailed = false;
  private initializedTheme: MermaidTheme | null = null;
  private readonly lifetime = new AbortController();

  constructor(private readonly resolveTheme: () => MermaidTheme = getMermaidTheme) {}

  async initialize(): Promise<boolean> {
    this.initializedTheme = this.resolveTheme();
    return !this.loadFailed && !this.lifetime.signal.aborted;
  }

  /** Only sanitized SVG crosses back from the extension document. */
  async render(code: string, { lightExport = true }: { lightExport?: boolean } = {}) {
    if (this.loadFailed || this.lifetime.signal.aborted) return null;
    const outcome = await renderInIsolatedDocument(
      {
        id: createMermaidId(),
        code,
        theme: this.initializedTheme ?? this.resolveTheme(),
        lightExport,
      },
      this.lifetime.signal,
    );
    if (outcome.kind === 'not-ready') this.loadFailed = true;
    return outcome.kind === 'rendered' ? outcome.diagram : null;
  }

  dispose(): void {
    this.lifetime.abort();
  }
}
