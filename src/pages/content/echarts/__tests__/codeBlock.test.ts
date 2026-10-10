import { describe, expect, it, vi } from 'vitest';

import { moveNativeCopyButton } from '../view';
import { BAR_OPTION, PIE_OPTION, createEChartsFixture } from './fixture';

const fixture = createEChartsFixture();

describe('moveNativeCopyButton', () => {
  const makeCodeBlock = (): {
    codeBlockHost: HTMLElement;
    parent: HTMLElement;
    toolbar: HTMLElement;
  } => {
    const codeBlockHost = document.createElement('code-block');
    const parent = document.createElement('div');
    parent.appendChild(codeBlockHost);
    const toolbar = document.createElement('div');
    return { codeBlockHost, parent, toolbar };
  };

  it('moves a .copy-button into the toolbar and resets its positioning', () => {
    const { codeBlockHost, toolbar } = makeCodeBlock();
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-button';
    copyBtn.style.position = 'absolute';
    copyBtn.style.top = '8px';
    codeBlockHost.appendChild(copyBtn);

    const moved = moveNativeCopyButton(codeBlockHost, toolbar);
    expect(moved).toBe(copyBtn);
    expect(toolbar.contains(copyBtn)).toBe(true);
    expect(copyBtn.style.position).toBe('static');
    expect(copyBtn.style.top).toBe('auto');
    expect(copyBtn.style.right).toBe('auto');
    // jsdom normalises the px unit on zero margins.
    expect(copyBtn.style.marginTop).toBe('0px');
  });

  it('prefers the .buttons container when present', () => {
    const { codeBlockHost, toolbar } = makeCodeBlock();
    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    codeBlockHost.appendChild(buttons);
    codeBlockHost.appendChild(
      Object.assign(document.createElement('button'), { className: 'copy-button' }),
    );

    expect(moveNativeCopyButton(codeBlockHost, toolbar)).toBe(buttons);
    expect(toolbar.contains(buttons)).toBe(true);
  });

  it('returns null when no native copy button exists', () => {
    const { codeBlockHost, toolbar } = makeCodeBlock();
    expect(moveNativeCopyButton(codeBlockHost, toolbar)).toBeNull();
  });
});

describe('processCodeBlocks language labels', () => {
  const makeCodeBlock = (language: string | null, code: string): HTMLElement => {
    const codeBlock = document.createElement('code-block');
    const decoration = document.createElement('div');
    decoration.className = 'code-block-decoration';
    if (language) {
      const span = document.createElement('span');
      span.textContent = language;
      decoration.appendChild(span);
    }
    const codeEl = document.createElement('code');
    codeEl.setAttribute('data-test-id', 'code-content');
    codeEl.textContent = code;
    codeBlock.append(decoration, codeEl);
    document.body.appendChild(codeBlock);
    return codeEl;
  };

  it('renders a chart under an explicit echarts label', async () => {
    makeCodeBlock('echarts', PIE_OPTION);
    fixture.blocks.process();
    await vi.waitFor(() => {
      expect(document.querySelector('.gv-echarts-wrapper')).not.toBeNull();
    });
  });

  it('renders a chart under an explicit echart label', async () => {
    makeCodeBlock('echart', PIE_OPTION);
    fixture.blocks.process();
    await vi.waitFor(() => {
      expect(document.querySelector('.gv-echarts-wrapper')).not.toBeNull();
    });
  });

  it('renders a chart under an explicit chart label', async () => {
    makeCodeBlock('chart', PIE_OPTION);
    fixture.blocks.process();
    await vi.waitFor(() => {
      expect(document.querySelector('.gv-echarts-wrapper')).not.toBeNull();
    });
  });

  it('does not render chart source inside a json-labelled block', async () => {
    makeCodeBlock('json', PIE_OPTION);
    fixture.blocks.process();
    // The json label returns synchronously before any render is scheduled.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('.gv-echarts-wrapper')).toBeNull();
  });

  it('renders chart source under a generic localized label', async () => {
    makeCodeBlock('代码段', BAR_OPTION);
    fixture.blocks.process();
    await vi.waitFor(() => {
      expect(document.querySelector('.gv-echarts-wrapper')).not.toBeNull();
    });
  });

  it('renders chart source without any language label', async () => {
    makeCodeBlock(null, BAR_OPTION);
    fixture.blocks.process();
    await vi.waitFor(() => {
      expect(document.querySelector('.gv-echarts-wrapper')).not.toBeNull();
    });
  });

  it('skips chart source inside a specific-language block', async () => {
    makeCodeBlock('typescript', PIE_OPTION);
    fixture.blocks.process();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('.gv-echarts-wrapper')).toBeNull();
  });

  it('Gemini echarts rendering is unchanged', async () => {
    vi.mocked(chrome.storage.sync.get).mockImplementation(((
      _defaults: unknown,
      callback: (items: Record<string, unknown>) => void,
    ) => callback({ gvEchartsEnabled: true })) as never);
    const labelled = makeCodeBlock('echarts', PIE_OPTION).closest<HTMLElement>('code-block')!;
    const unlabelled = makeCodeBlock(null, BAR_OPTION).closest<HTMLElement>('code-block')!;
    const json = makeCodeBlock('json', PIE_OPTION).closest<HTMLElement>('code-block')!;

    fixture.feature.start();

    await vi.waitFor(() =>
      expect(document.querySelectorAll('.gv-echarts-wrapper')).toHaveLength(2),
    );
    // Gemini still wraps its own host in place and hides it behind the chart.
    for (const host of [labelled, unlabelled]) {
      expect(host.parentElement?.classList.contains('gv-echarts-wrapper')).toBe(true);
      expect(host.style.display).toBe('none');
    }
    expect(json.parentElement).toBe(document.body);
    expect(document.querySelector('.gv-diagram-panel')).toBeNull();
  });

  it('skips non-chart JSON in an unlabelled block', async () => {
    makeCodeBlock(null, '{"foo": "bar", "list": [1, 2, 3]}');
    fixture.blocks.process();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('.gv-echarts-wrapper')).toBeNull();
  });
});
