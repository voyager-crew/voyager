import { describe, expect, it, vi } from 'vitest';

import { startMermaid } from '../index';

const library = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: library }));

const FLOWCHART = 'flowchart TD\n  Start --> Middle\n  Middle --> Finish\n  Finish --> Done';

/** Gemini's code block: a `code-block` host with a language label in its decoration. */
function geminiBlock(source: string, label: string | null): HTMLElement {
  const host = document.createElement('code-block');
  host.innerHTML =
    '<div class="code-block">' +
    (label === null ? '' : `<div class="code-block-decoration"><span>${label}</span></div>`) +
    '<pre><code data-test-id="code-content"></code></pre></div>';
  host.querySelector('code')!.textContent = source;
  document.body.append(host);
  return host;
}

describe('Gemini mermaid rendering', () => {
  it('Gemini mermaid rendering is unchanged', async () => {
    library.render.mockResolvedValue({ svg: '<svg><text>Diagram</text></svg>' });
    vi.mocked(chrome.storage.sync.get).mockImplementation(((
      _keys: unknown,
      callback: (items: Record<string, unknown>) => void,
    ) => callback({ gvMermaidEnabled: true })) as never);
    const labelled = geminiBlock(FLOWCHART, 'Mermaid');
    const unlabelled = geminiBlock(FLOWCHART, null);
    const python = geminiBlock(FLOWCHART, 'Python');

    startMermaid();

    await vi.waitFor(() =>
      expect(document.querySelectorAll('.gv-mermaid-wrapper')).toHaveLength(2),
    );
    // Gemini still wraps its own host in place and hides it behind the diagram.
    for (const host of [labelled, unlabelled]) {
      expect(host.parentElement?.classList.contains('gv-mermaid-wrapper')).toBe(true);
      expect(host.style.display).toBe('none');
    }
    expect(python.parentElement).toBe(document.body);
    expect(document.querySelector('.gv-diagram-panel')).toBeNull();
  });
});
