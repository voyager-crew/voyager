import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sanitizeMermaidSvg } from '@/pages/mermaidRenderer/sanitize';

import { createMermaidErrorCard } from '../codeBlock';
import { openFullscreen } from '../fullscreen';
import { MermaidRenderer, resolveMermaidTheme } from '../renderer';

// jsdom cannot load extension documents; mock only that browser transport.
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

vi.mock('../isolatedRender', async () => ({
  renderInIsolatedDocument: async (
    request: import('@/pages/mermaidRenderer/protocol').MermaidRenderRequest,
  ) => ({
    kind: 'rendered',
    diagram: await (await import('@/pages/mermaidRenderer/render')).renderMermaidDocument(request),
  }),
}));

describe('Mermaid rendering', () => {
  let renderer: MermaidRenderer;
  const getLibrary = async () => (await import('mermaid')).default;
  beforeEach(() => {
    renderer = new MermaidRenderer();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    document.body.className = '';
  });

  describe('initialization', () => {
    it('loads the library successfully', async () => {
      await expect(renderer.initialize()).resolves.toBe(true);
    });

    it('initializes Mermaid in strict mode for untrusted model output', async () => {
      await renderer.initialize();
      await renderer.render('flowchart TD\nA --> B', { lightExport: false });

      const mermaid = await getLibrary();
      expect(mermaid.initialize).toHaveBeenCalledWith(
        expect.objectContaining({ securityLevel: 'strict' }),
      );
    });

    it('uses SVG flowchart labels so sanitization preserves visible text', async () => {
      await renderer.initialize();
      await renderer.render('flowchart TD\nA --> B', { lightExport: false });

      const mermaid = await getLibrary();
      expect(mermaid.initialize).toHaveBeenCalledWith(
        expect.objectContaining({ htmlLabels: false, flowchart: { htmlLabels: false } }),
      );
    });
  });

  describe('resolveMermaidTheme', () => {
    it('prefers an explicit Gemini light host over generic dark markers', () => {
      const page = document.implementation.createHTMLDocument();
      const themeHost = page.createElement('div');
      themeHost.className = 'theme-host light-theme';
      page.body.append(themeHost);
      page.body.classList.add('dark-theme');
      page.documentElement.classList.add('dark');
      page.body.dataset.theme = 'dark';

      expect(resolveMermaidTheme(page, true)).toBe('default');
    });

    it('prefers an explicit Gemini dark host over generic light markers', () => {
      const page = document.implementation.createHTMLDocument();
      const themeHost = page.createElement('div');
      themeHost.className = 'theme-host dark-theme';
      page.body.append(themeHost);
      page.body.classList.add('light-theme');
      page.documentElement.classList.add('light');
      page.body.dataset.theme = 'light';

      expect(resolveMermaidTheme(page, false)).toBe('dark');
    });

    it('uses generic page markers when Gemini exposes no theme host', () => {
      const darkPage = document.implementation.createHTMLDocument();
      darkPage.body.dataset.theme = 'dark';
      expect(resolveMermaidTheme(darkPage, false)).toBe('dark');

      const lightPage = document.implementation.createHTMLDocument();
      lightPage.body.dataset.theme = 'light';
      expect(resolveMermaidTheme(lightPage, true)).toBe('default');
    });

    it('falls back to a dark system preference when Gemini exposes no theme', () => {
      const page = document.implementation.createHTMLDocument();

      expect(resolveMermaidTheme(page, true)).toBe('dark');
    });

    it('falls back to the default theme when Gemini exposes no theme and the system is light', () => {
      const page = document.implementation.createHTMLDocument();

      expect(resolveMermaidTheme(page, false)).toBe('default');
    });
  });

  describe('fullscreen lifecycle', () => {
    it.each(['button', 'escape', 'backdrop'] as const)(
      'closes after the fade and stops document dragging via %s',
      (path) => {
        vi.useFakeTimers();
        try {
          openFullscreen('<svg width="100" height="100"><path d="M0 0" /></svg>');
          const modal = document.querySelector<HTMLElement>('.gv-mermaid-modal')!;
          const content = modal.querySelector<HTMLElement>('.gv-mermaid-modal-content')!;
          vi.advanceTimersToNextFrame();
          content.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 20 }));
          const close = {
            button: () => modal.querySelector<HTMLButtonElement>('button:last-child')!.click(),
            escape: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
            backdrop: () => modal.click(),
          }[path];
          close();
          const transform = content.style.transform;
          document.dispatchEvent(new MouseEvent('mousemove', { clientX: 70, clientY: 80 }));
          expect(content.style.transform).toBe(transform);
          expect(content.classList.contains('dragging')).toBe(false);
          expect(modal.classList.contains('visible')).toBe(false);
          vi.advanceTimersByTime(300);
          expect(modal.isConnected).toBe(false);
        } finally {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          vi.runAllTimers();
          vi.useRealTimers();
        }
      },
    );
  });

  describe('renderer output', () => {
    it('keeps the page diagram when the light export render fails', async () => {
      document.body.className = 'dark-theme';
      await renderer.initialize();
      const mermaid = await getLibrary();
      (mermaid.render as unknown as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ svg: '<svg data-page-theme="dark"></svg>' })
        .mockRejectedValueOnce(new Error('light export failed'));

      const diagram = await renderer.render('flowchart TD\nA --> B\nB --> C');

      expect(diagram).toMatchObject({ theme: 'dark', errorMessage: null, lightExportSvg: null });
      expect(diagram?.svg).toContain('data-page-theme="dark"');
    });

    it('caps a syntax error, preserves unrelated host nodes, and shows the error as text', async () => {
      document.body.innerHTML =
        '<div id="document-content">Keep me</div><div id="d-host-node">Syntax error in the host</div>';
      const mermaid = await getLibrary();
      vi.mocked(mermaid.render).mockRejectedValueOnce(
        new Error(`<b id="gv-proof">proof</b>${'x'.repeat(120)}`),
      );

      const diagram = await renderer.render('not a diagram');

      expect(document.getElementById('d-host-node')?.textContent).toBe('Syntax error in the host');
      expect(document.getElementById('document-content')?.textContent).toBe('Keep me');
      expect(diagram?.errorMessage).toHaveLength(103);
      expect(diagram?.errorMessage?.endsWith('...')).toBe(true);
      const card = createMermaidErrorCard(diagram!.errorMessage!);
      expect(card.querySelector('#gv-proof')).toBeNull();
      expect(card.textContent).toContain('<b id="gv-proof">proof</b>');
    });

    it('sanitizes links, remote media, handlers, and escaping CSS from rendered diagrams', async () => {
      const html = await sanitizeMermaidSvg(`<svg viewBox="0 0 100 50">
          <style>.node{position:fixed;inset:0;z-index:99}</style>
          <foreignObject><a href="https://example.invalid/phish">Verify</a><img src="https://example.invalid/pixel"></foreignObject>
          <g onload="alert(1)"><text>Safe label</text></g>
          <image href="https://example.invalid/pixel"/>
        </svg>`);
      const diagram = document.createElement('div');
      diagram.innerHTML = html;

      expect(diagram.querySelector('a, img, image, script, iframe, form, input')).toBeNull();
      expect(html).not.toContain('example.invalid');
      expect(html).not.toContain('position:fixed');
      expect(html).not.toContain('onload');
      expect(diagram.textContent).toContain('Safe label');
    });

    it('preserves Mermaid theme CSS when its contained tooltip uses z-index', async () => {
      const diagram = document.createElement('div');
      diagram.innerHTML = await sanitizeMermaidSvg(`<svg viewBox="0 0 100 50">
          <style>
            #chart .node rect { fill: #ececff; stroke: #9370db; }
            div.mermaidTooltip { position: absolute; z-index: 100; }
          </style>
          <g id="chart" class="node">
            <rect width="50" height="20"></rect>
            <text><tspan>Dosing &amp;amp; Distribution</tspan></text>
          </g>
        </svg>`);

      const style = diagram.querySelector('style');
      expect(style?.textContent).toContain('fill: #ececff');
      expect(style?.textContent).toContain('z-index: 100');
      expect(diagram.querySelector('tspan')?.textContent).toBe('Dosing & Distribution');
    });
  });
});
