import { describe, expect, it, vi } from 'vitest';

import { createContentExtractor } from '../DOMContentExtractor';
import { domExtractorTestAdapter } from './domExtractorTestAdapter';

const extractor = createContentExtractor(domExtractorTestAdapter);

describe('exportRichText.lists', () => {
  it('preserves ordered-list starting numbers in Markdown', () => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content><div class="markdown">
        <ol start="22"><li>First retained number</li><li>Next retained number</li></ol>
      </div></message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.text).toContain('22. First retained number');
    expect(extracted.text).toContain('23. Next retained number');
  });

  it('preserves WaveDrom skin styles and fenced source inside list items', () => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown">
          <ul>
            <li>
              Timing diagram
              <div class="gv-wavedrom-wrapper">
                <code-block style="display: none;">
                  <div class="code-block-decoration">wavedrom</div>
                  <pre><code role="text">{"signal": [{"name":"clk","wave":"p..."}]}</code></pre>
                </code-block>
                <div class="gv-wavedrom-toggle"><button>Diagram</button></div>
                <div class="gv-wavedrom-diagram">
                  <svg viewBox="0 0 800 200">
                    <style>.s1{fill:#fff;stroke:#000}</style>
                    <g class="s1"><text>clk</text></g>
                  </svg>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.html).toContain('class="gv-export-wavedrom"');
    expect(extracted.html).toContain('<style>.s1{fill:#fff;stroke:#000}</style>');
    expect(extracted.html).not.toContain('gv-wavedrom-toggle');
    expect(extracted.text).toContain(
      '- Timing diagram\n  ```wavedrom\n  {"signal": [{"name":"clk","wave":"p..."}]}\n  ```',
    );
  });

  it('preserves rendered Mermaid diagrams and fenced source inside list items', () => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown">
          <ul>
            <li>
              <span>Diagram</span>
              <div class="gv-mermaid-wrapper" data-gv-mermaid-theme="light">
                <code-block style="display: none;">
                  <div class="code-block-decoration">mermaid</div>
                  <pre><code role="text">flowchart TD\nA --&gt; B</code></pre>
                </code-block>
                <div class="gv-mermaid-toggle"><button>Diagram</button></div>
                <div class="gv-mermaid-diagram">
                  <svg viewBox="0 0 120 80"><text>Rendered diagram</text></svg>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.hasCode).toBe(true);
    expect(extracted.html).toContain('<ul>');
    expect(extracted.html).toContain('class="gv-export-mermaid"');
    expect(extracted.html).toContain('<svg viewBox="0 0 120 80">');
    expect(extracted.html).not.toContain('gv-mermaid-wrapper');
    expect(extracted.html).not.toContain('<pre><code');
    expect(extracted.text).toContain('- Diagram\n  ```mermaid\n  flowchart TD\n  A --> B\n  ```');
  });

  it('snapshots the live ECharts canvas inside list items', () => {
    const clonedCanvasReadback = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockImplementation(() => {
        throw new Error('A cloned canvas has no rendered pixels');
      });
    try {
      const assistant = document.createElement('div');
      assistant.innerHTML = `
        <message-content>
          <div class="markdown">
            <ul>
              <li>
                <span>Chart</span>
                <div class="gv-echarts-wrapper">
                  <code-block style="display: none;">
                    <div class="code-block-decoration">echarts</div>
                    <pre><code role="text">{"series": [{"type": "pie", "data": [{"value": 1}]}]}</code></pre>
                  </code-block>
                  <div class="gv-echarts-toggle"><button>Diagram</button></div>
                  <div class="gv-echarts-diagram"><canvas width="800" height="400"></canvas></div>
                </div>
              </li>
            </ul>
          </div>
        </message-content>
      `;
      const liveCanvas = assistant.querySelector('canvas')!;
      const liveReadback = vi.fn(() => 'data:image/png;base64,LIVE');
      Object.defineProperty(liveCanvas, 'toDataURL', { value: liveReadback });
      vi.spyOn(liveCanvas, 'getBoundingClientRect').mockReturnValue({
        width: 400,
        height: 200,
        top: 0,
        right: 400,
        bottom: 200,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      const extracted = extractor.extractAssistantContent(assistant);

      expect(liveReadback).toHaveBeenCalledWith('image/png');
      expect(extracted.html).toContain('class="gv-export-echarts"');
      expect(extracted.html).toContain('src="data:image/png;base64,LIVE"');
      expect(extracted.html).toContain('alt="Chart"');
      expect(extracted.html).toContain('width="400"');
      expect(extracted.html).not.toContain('gv-echarts-wrapper');
      expect(extracted.text).toContain(
        '- Chart\n  ```echarts\n  {"series": [{"type": "pie", "data": [{"value": 1}]}]}\n  ```',
      );
    } finally {
      clonedCanvasReadback.mockRestore();
    }
  });

  it('preserves regular fenced code when list extraction handles block content', () => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown">
          <ul>
            <li>
              <span>Example</span>
              <code-block>
                <div class="code-block-decoration">typescript</div>
                <pre><code role="text">const answer = 42;</code></pre>
              </code-block>
            </li>
          </ul>
        </div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.hasCode).toBe(true);
    expect(extracted.html).toContain('<ul>');
    expect(extracted.html).toContain('<pre><code class="language-typescript">');
    expect(extracted.html).not.toContain('<code-block>');
    expect(extracted.text).toContain('- Example\n  ```typescript\n  const answer = 42;\n  ```');
  });

  it('preserves prose, ordinary code, and subsequent prose order inside list items', () => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown">
          <ul>
            <li>
              <span>Before ordinary code.</span>
              <code-block>
                <div class="code-block-decoration">typescript</div>
                <pre><code role="text">const answer = 42;</code></pre>
              </code-block>
              <span>After ordinary code.</span>
            </li>
          </ul>
        </div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.hasCode).toBe(true);
    expect(extracted.text).toContain(
      '- Before ordinary code.\n  ```typescript\n  const answer = 42;\n  ```\n  After ordinary code.',
    );
  });

  it('preserves Mermaid blocks and nested lists at their original list-item positions', () => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown">
          <ul>
            <li>
              <span>Before Mermaid.</span>
              <div class="gv-mermaid-wrapper" data-gv-mermaid-theme="light">
                <code-block><div class="code-block-decoration">mermaid</div><pre><code role="text">flowchart TD\nA --&gt; B</code></pre></code-block>
                <div class="gv-mermaid-diagram"><svg viewBox="0 0 120 80"><text>Diagram</text></svg></div>
              </div>
              <ul><li>Nested item</li></ul>
              <span>After Mermaid.</span>
            </li>
          </ul>
        </div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.hasCode).toBe(true);
    expect(extracted.html).toContain('class="gv-export-mermaid"');
    expect(extracted.text).toContain(
      '- Before Mermaid.\n  ```mermaid\n  flowchart TD\n  A --> B\n  ```\n  - Nested item\n  After Mermaid.',
    );
  });

  it('keeps interleaved ordinary and Mermaid blocks in list DOM order', () => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown">
          <ol>
            <li>
              <span>First prose.</span>
              <code-block><div class="code-block-decoration">json</div><pre><code role="text">{}</code></pre></code-block>
              <span>Second prose.</span>
              <div class="gv-mermaid-wrapper" data-gv-mermaid-theme="light">
                <code-block><div class="code-block-decoration">mermaid</div><pre><code role="text">graph LR\nA --&gt; B</code></pre></code-block>
                <div class="gv-mermaid-diagram"><svg viewBox="0 0 120 80"><text>Diagram</text></svg></div>
              </div>
              <span>Third prose with <span class="math-inline" data-math="x^2">x²</span>.</span>
            </li>
          </ol>
        </div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.hasCode).toBe(true);
    expect(extracted.hasFormulas).toBe(true);
    expect(extracted.text).toContain(
      '1. First prose.\n   ```json\n   {}\n   ```\n   Second prose.\n   ```mermaid\n   graph LR\n   A --> B\n   ```\n   Third prose with $x^2$.',
    );
  });

  it('extracts Mermaid blocks wrapped by response elements inside list items', () => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown">
          <ul>
            <li>
              <span>Before wrapped Mermaid.</span>
              <response-element>
                <div class="gv-mermaid-wrapper" data-gv-mermaid-theme="light">
                  <code-block><div class="code-block-decoration">mermaid</div><pre><code role="text">flowchart LR\nA --&gt; B</code></pre></code-block>
                  <div class="gv-mermaid-diagram"><svg viewBox="0 0 120 80"><text>Diagram</text></svg></div>
                </div>
              </response-element>
              <span>After wrapped Mermaid.</span>
            </li>
          </ul>
        </div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.hasCode).toBe(true);
    expect(extracted.html).toContain('class="gv-export-mermaid"');
    expect(extracted.text).toContain(
      '- Before wrapped Mermaid.\n  ```mermaid\n  flowchart LR\n  A --> B\n  ```\n  After wrapped Mermaid.',
    );
  });

  it('preserves block order through section and div containers inside list items', () => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown">
          <ul>
            <li>
              <section>
                <p>Before ordinary code.</p>
                <div>
                  <code-block><div class="code-block-decoration">typescript</div><pre><code role="text">const answer = 42;</code></pre></code-block>
                </div>
                <p>Before Mermaid.</p>
                <div>
                  <div>
                    <div class="gv-mermaid-wrapper" data-gv-mermaid-theme="light">
                      <code-block><div class="code-block-decoration">Code snippet</div><pre><code role="text">flowchart TD\nA --&gt; B</code></pre></code-block>
                      <div class="gv-mermaid-diagram"><svg viewBox="0 0 120 80"><text>Diagram</text></svg></div>
                    </div>
                  </div>
                </div>
                <ol><li>Nested item</li></ol>
                <p>After nested list.</p>
              </section>
            </li>
          </ul>
        </div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.hasCode).toBe(true);
    expect(extracted.html).toContain('class="gv-export-mermaid"');
    expect(extracted.text).toContain(
      '- Before ordinary code.\n  ```typescript\n  const answer = 42;\n  ```\n  Before Mermaid.\n  ```mermaid\n  flowchart TD\n  A --> B\n  ```\n  1. Nested item\n  After nested list.',
    );
    expect(extracted.text).not.toContain('```code snippet');
  });

  it('should strip source chips nested in lists from exported HTML', () => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown">
          <ul>
            <li>
              Item 1
              <sources-carousel-inline>
                <mat-icon fonticon="link">link</mat-icon>
              </sources-carousel-inline>
            </li>
            <li>Item 2</li>
          </ul>
        </div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.text).toContain('Item 1');
    expect(extracted.text).toContain('Item 2');
    expect(extracted.text).not.toMatch(/\blink\b/i);

    expect(extracted.html).toContain('<ul>');
    expect(extracted.html).toMatch(/<li[^>]*>\s*Item 1/i);
    expect(extracted.html).toMatch(/<li[^>]*>\s*Item 2/i);
    expect(extracted.html).not.toContain('sources-carousel-inline');
    expect(extracted.html).not.toContain('mat-icon');
  });

  it('preserves Gemini KaTeX radical image nodes nested in lists', () => {
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown">
          <ul>
            <li>
              <b>积的开方：</b>
              <span class="math-inline" data-math="\\sqrt{ab} = \\sqrt{a}">
                <span class="katex">
                  <span class="katex-html" aria-hidden="true">
                    <span class="base">
                      <span class="mord sqrt">
                        <span class="vlist-t">
                          <span class="vlist">
                            <span class="hide-tail">
                              <img class="katex-svg" style="display:block;position:absolute;width:100%;height:inherit;" src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" />
                            </span>
                          </span>
                        </span>
                      </span>
                    </span>
                  </span>
                </span>
              </span>
            </li>
          </ul>
        </div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);

    expect(extracted.hasFormulas).toBe(true);
    expect(extracted.text).toContain('$\\sqrt{ab} = \\sqrt{a}$');
    expect(extracted.html).toContain('class="katex-svg"');
    expect(extracted.html).toContain('data:image/svg+xml');
    expect(extracted.html).toContain('hide-tail');
  });

  it('an exported list keeps its diagram code visible', () => {
    // A diagram plugin hides the host block in the page; image export renders the clone there.
    const pageStyle = document.createElement('style');
    pageStyle.textContent = '[data-gv-diagram-hidden] { display: none !important; }';
    document.head.append(pageStyle);
    const assistant = document.createElement('div');
    assistant.innerHTML = `
      <message-content>
        <div class="markdown">
          <ul>
            <li>
              Chart
              <div class="gv-diagram-panel"></div>
              <div data-markdown-copy="code-block" data-gv-diagram-hidden="">
                <code>{ series: [{ type: "pie" }] }</code>
              </div>
            </li>
          </ul>
        </div>
      </message-content>
    `;

    const extracted = extractor.extractAssistantContent(assistant);
    const rendered = document.createElement('div');
    rendered.innerHTML = extracted.html;
    document.body.append(rendered);

    const code = Array.from(rendered.querySelectorAll('code')).find((el) =>
      el.textContent?.includes('series'),
    );
    expect(code).toBeDefined();
    for (let el: Element | null = code!; el && el !== rendered; el = el.parentElement) {
      expect(getComputedStyle(el).display).not.toBe('none');
    }
    rendered.remove();
    pageStyle.remove();
  });
});
