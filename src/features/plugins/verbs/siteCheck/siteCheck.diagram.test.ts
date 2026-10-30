import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildVoyagerDiagnostics } from '@/core/services/DiagnosticsExportService';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { mermaidPrimitive } from '../mermaid';
import { collectProbes, runProbes } from './probes';
import {
  buildSiteCheckReport,
  describePick,
  formatSiteCheckMarkdown,
  pluginIds,
  serializeSiteCheckReport,
} from './report';

const library = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: library }));
vi.mock('@/pages/content/mermaid/isolatedRender', async () => ({
  renderInIsolatedDocument: (await import('@/pages/mermaidRenderer/render')).renderMermaidDocument,
}));

const SECRET = 'Alice-Private-Plan';
/** What Mermaid draws for `class Alice Alice-Private-Plan`: the author's class lands on the node. */
const DRAWN = `<svg id="mermaid-1" class="flowchart" aria-roledescription="flowchart-v2">
  <g class="root"><g class="nodes">
    <g class="node default ${SECRET}" id="flowchart-Alice-0">
      <rect class="basic label-container ${SECRET}"></rect><g class="label"><text>Alice</text></g>
    </g>
  </g></g></svg>`;

const claude = requireBundledSiteAdapter('claude');
let scope: PluginScope;

beforeEach(() => {
  library.initialize.mockReset();
  library.render.mockReset();
  library.render.mockResolvedValue({ svg: DRAWN });
  document.body.innerHTML = `<main><div data-testid="assistant-message">
    <div class="font-claude-message">
      <p class="${SECRET}-para">See the plan.</p>
      <div class="overflow-x-auto"><pre class="code-block__code"><code class="language-mermaid"></code></pre></div>
    </div></div></main>`;
  document.querySelector('code')!.textContent =
    'flowchart TD\n  Alice --> Bob\n  class Alice Alice-Private-Plan';
  scope = new PluginScope();
});

afterEach(async () => {
  await scope.dispose();
  document.body.replaceChildren();
});

function reportFor(picked: Element): string[] {
  const probes = collectProbes(claude, null, 'voyager.claude-site-check');
  const section = describePick(picked, probes, pluginIds([]));
  const report = buildSiteCheckReport({
    url: 'https://claude.ai/chat/x',
    doc: document,
    adapter: claude,
    results: runProbes(probes, { doc: document, conversation: true }),
    statuses: [],
    picked: section,
    diagnostics: buildVoyagerDiagnostics({ extensionVersion: '2.2.1', buildTarget: 'chrome' }),
  });
  return [formatSiteCheckMarkdown(report), serializeSiteCheckReport(report)];
}

describe('site check picks inside message content', () => {
  it('does not export a Mermaid node’s author-chosen class when a node of the drawn diagram is picked', async () => {
    void mermaidPrimitive.activate(
      scope,
      { codeBlock: 'pre' },
      {
        doc: document,
        adapter: claude,
        pluginId: 'test.mermaid',
        settings: {},
        setTargetCounter: () => {},
      },
    );
    const panel = () => document.querySelector<HTMLElement>('.gv-diagram-panel');
    const node = () => panel()?.shadowRoot?.querySelector('g.node');
    await vi.waitFor(() => expect(node()).toBeTruthy(), { timeout: 3000 });
    // The real renderer path keeps the author's class on the node.
    expect(node()!.classList.contains(SECRET)).toBe(true);

    for (const output of reportFor(node()!.querySelector('rect')!)) {
      expect(output).not.toContain(SECRET);
      expect(output).toContain('div.gv-diagram-panel[data-gv-diagram=mermaid]{withheld}');
      // The message turn still shows where the diagram sits.
      expect(output).toContain('div.font-claude-message');
    }
  });

  it('does not export the class of an element inside a message turn', () => {
    for (const output of reportFor(document.querySelector('p')!)) {
      expect(output).not.toContain(SECRET);
      expect(output).toContain('div.font-claude-message');
    }
  });
});
