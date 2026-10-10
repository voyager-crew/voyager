import { describe, expect, it, vi } from 'vitest';

import { startWaveDrom } from '../index';

const WAVEJSON = '{ signal: [{ name: "clk", wave: "p...." }, { name: "data", wave: "x.34.x" }] }';

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

describe('Gemini wavedrom rendering', () => {
  it('Gemini wavedrom rendering is unchanged', async () => {
    vi.mocked(chrome.storage.sync.get).mockImplementation(((
      _keys: unknown,
      callback: (items: Record<string, unknown>) => void,
    ) => callback({ gvWaveDromEnabled: true })) as never);
    const labelled = geminiBlock(WAVEJSON, 'WaveDrom');
    const unlabelled = geminiBlock(WAVEJSON, null);
    const json = geminiBlock(WAVEJSON, 'JSON');

    startWaveDrom();

    await vi.waitFor(() =>
      expect(document.querySelectorAll('.gv-wavedrom-wrapper svg')).toHaveLength(2),
    );
    // Gemini still wraps its own host in place and hides it behind the diagram.
    for (const host of [labelled, unlabelled]) {
      expect(host.parentElement?.classList.contains('gv-wavedrom-wrapper')).toBe(true);
      expect(host.style.display).toBe('none');
    }
    expect(json.parentElement).toBe(document.body);
    expect(document.querySelector('.gv-diagram-panel')).toBeNull();
  });
});
