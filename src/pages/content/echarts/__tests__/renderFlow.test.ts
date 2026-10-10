import { describe, expect, it, vi } from 'vitest';

import { requestEChartsDataUrl } from '../exportBridge';
import { makeFakeInstance, PIE_OPTION, createEChartsFixture } from './fixture';

const fixture = createEChartsFixture();

describe('render flow', () => {
  const addEChartsBlock = (code: string, language = 'echarts'): HTMLElement => {
    const codeBlock = document.createElement('code-block');
    const decoration = document.createElement('div');
    decoration.className = 'code-block-decoration';
    const span = document.createElement('span');
    span.textContent = language;
    decoration.appendChild(span);
    const codeEl = document.createElement('code');
    codeEl.setAttribute('data-test-id', 'code-content');
    codeEl.textContent = code;
    codeBlock.append(decoration, codeEl);
    document.body.appendChild(codeBlock);
    return codeEl;
  };

  it('disposes a new instance when applying the option throws', async () => {
    const echartsMod = await import('../runtime');
    const failedInstance = makeFakeInstance();
    failedInstance.setOption.mockImplementationOnce(() => {
      throw new Error('unsupported option');
    });
    vi.mocked(echartsMod.init).mockImplementationOnce(
      () => failedInstance as unknown as ReturnType<typeof echartsMod.init>,
    );
    const codeEl = addEChartsBlock(PIE_OPTION);
    const codeBlockHost = codeEl.closest<HTMLElement>('code-block')!;

    fixture.blocks.process();

    await vi.waitFor(() => {
      expect(failedInstance.dispose).toHaveBeenCalledTimes(1);
    });
    expect(document.querySelector('.gv-echarts-wrapper')).toBeNull();
    expect(codeBlockHost.style.display).toBe('');
  });

  it('builds the wrapper, toggle and diagram container and hides the source', async () => {
    const codeEl = addEChartsBlock(PIE_OPTION);
    const codeBlockHost = codeEl.closest<HTMLElement>('code-block')!;
    fixture.blocks.process();

    await vi.waitFor(() => {
      expect(document.querySelector('.gv-echarts-wrapper')).not.toBeNull();
    });
    const wrapper = document.querySelector('.gv-echarts-wrapper') as HTMLElement;
    expect(wrapper.contains(codeBlockHost)).toBe(true);
    expect(codeBlockHost.style.display).toBe('none');
    const toggle = wrapper.querySelector('.gv-echarts-toggle') as HTMLElement;
    expect(toggle).not.toBeNull();
    expect(wrapper.firstElementChild).toBe(toggle);
    expect(getComputedStyle(toggle).position).not.toBe('absolute');
    expect(toggle.querySelector('[data-view="diagram"]')?.textContent).toBe('diagramButton');
    expect(toggle.querySelector('[data-view="code"]')?.textContent).toBe('diagramCodeButton');
    expect(toggle.querySelector('[data-view="diagram"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(toggle.querySelector('[data-view="code"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.querySelector('[data-action="fullscreen"]')?.getAttribute('aria-label')).toBe(
      'echartsFullscreenButton',
    );
    expect(wrapper.querySelector('.gv-echarts-diagram')).not.toBeNull();
    expect(codeEl.dataset.echartsCode).toBe(PIE_OPTION);
    expect(codeEl.dataset.echartsTheme).toBe('light');
    expect(codeEl.dataset.echartsProcessing).toBe('false');
    const echartsMod = await import('../runtime');
    const fakeInstance = vi.mocked(echartsMod.init).mock.results.at(-1)?.value;
    expect(fakeInstance.setOption).toHaveBeenCalledWith(
      expect.objectContaining({ aria: { enabled: true } }),
      true,
    );

    (toggle.querySelector('[data-view="code"]') as HTMLButtonElement).click();
    expect(toggle.querySelector('[data-view="diagram"]')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(toggle.querySelector('[data-view="code"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('provides a composited PNG from the live ECharts instance for export', async () => {
    addEChartsBlock(PIE_OPTION);
    fixture.blocks.process();

    await vi.waitFor(() => {
      expect(document.querySelector('.gv-echarts-diagram')).not.toBeNull();
    });
    const diagram = document.querySelector<HTMLElement>('.gv-echarts-diagram')!;
    const echartsMod = await import('../runtime');
    const fakeInstance = vi.mocked(echartsMod.init).mock.results.at(-1)?.value;

    expect(requestEChartsDataUrl(diagram)).toEqual({
      handled: true,
      dataUrl: 'data:image/png;base64,COMPOSITED',
    });
    expect(fakeInstance.getDataURL).toHaveBeenCalledWith({
      type: 'png',
      pixelRatio: 1,
      backgroundColor: '#f9fafb',
    });
  });

  it('moves the native copy button into the toggle', async () => {
    const codeBlock = document.createElement('code-block');
    const decoration = document.createElement('div');
    decoration.className = 'code-block-decoration';
    const span = document.createElement('span');
    span.textContent = 'echarts';
    decoration.appendChild(span);
    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    decoration.appendChild(buttons);
    const codeEl = document.createElement('code');
    codeEl.setAttribute('data-test-id', 'code-content');
    codeEl.textContent = PIE_OPTION;
    codeBlock.append(decoration, codeEl);
    document.body.appendChild(codeBlock);

    fixture.blocks.process();
    await vi.waitFor(() => {
      expect(document.querySelector('.gv-echarts-toggle')).not.toBeNull();
    });
    expect(document.querySelector('.gv-echarts-toggle')?.contains(buttons)).toBe(true);
  });

  it('re-renders with a fresh instance when the source changes', async () => {
    const codeEl = addEChartsBlock(PIE_OPTION);
    fixture.blocks.process();
    await vi.waitFor(() => {
      expect(codeEl.dataset.echartsCode).toBe(PIE_OPTION);
    });
    const echartsMod = await import('../runtime');
    const initMock = vi.mocked(echartsMod.init);
    expect(initMock).toHaveBeenCalledTimes(1);
    const firstInstance = initMock.mock.results[0]?.value;

    const updated = `{
  "series": [{ "type": "pie", "data": [{ "value": 2, "name": "b" }] }]
}`;
    codeEl.textContent = updated;
    fixture.blocks.process();

    await vi.waitFor(() => {
      expect(codeEl.dataset.echartsCode).toBe(updated);
    });
    expect(initMock).toHaveBeenCalledTimes(2);
    expect(firstInstance.dispose).toHaveBeenCalled();
  });

  it('renders only the latest source when it changes during async parsing', async () => {
    const codeEl = addEChartsBlock(PIE_OPTION);
    fixture.blocks.process();

    const latest = `{
  "series": [{ "type": "pie", "data": [{ "value": 9, "name": "latest" }] }]
}`;
    codeEl.textContent = latest;

    await vi.waitFor(() => {
      expect(codeEl.dataset.echartsCode).toBe(latest);
    });
    const echartsMod = await import('../runtime');
    const initMock = vi.mocked(echartsMod.init);
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock.mock.results[0]?.value.setOption).toHaveBeenCalledWith(
      expect.objectContaining({
        series: [{ type: 'pie', data: [{ value: 9, name: 'latest' }] }],
      }),
      true,
    );
  });

  it('retries when an incomplete source becomes valid during a failed parse', async () => {
    const codeEl = addEChartsBlock('{ "series": [{ "type": "pie", "data": [');
    fixture.blocks.process();
    expect(codeEl.dataset.echartsProcessing).toBe('true');

    codeEl.textContent = PIE_OPTION;

    await vi.waitFor(() => {
      expect(codeEl.dataset.echartsCode).toBe(PIE_OPTION);
    });
    const echartsMod = await import('../runtime');
    expect(vi.mocked(echartsMod.init)).toHaveBeenCalledTimes(1);
  });

  it('abandons an in-flight generic render when Gemini finalizes a specific label', async () => {
    const codeEl = addEChartsBlock(PIE_OPTION, '代码段');
    const language = codeEl.closest('code-block')!.querySelector('.code-block-decoration span')!;
    fixture.blocks.process();
    expect(codeEl.dataset.echartsProcessing).toBe('true');

    language.textContent = 'json';
    fixture.blocks.process();

    await vi.waitFor(() => {
      expect(codeEl.dataset.echartsProcessing).toBe('false');
    });
    const echartsMod = await import('../runtime');
    expect(vi.mocked(echartsMod.init)).not.toHaveBeenCalled();
    expect(document.querySelector('.gv-echarts-wrapper')).toBeNull();
  });

  it('restores source view when a rendered option becomes invalid', async () => {
    const codeEl = addEChartsBlock(PIE_OPTION);
    const codeBlockHost = codeEl.closest<HTMLElement>('code-block')!;
    fixture.blocks.process();
    await vi.waitFor(() => {
      expect(document.querySelector('.gv-echarts-wrapper')).not.toBeNull();
    });
    const echartsMod = await import('../runtime');
    const instance = vi.mocked(echartsMod.init).mock.results.at(-1)?.value;

    codeEl.textContent = '{ "ordinary": true }';
    fixture.blocks.process();

    await vi.waitFor(() => {
      expect(document.querySelector('.gv-echarts-wrapper')).toBeNull();
    });
    expect(codeBlockHost.style.display).toBe('');
    expect(instance.dispose).toHaveBeenCalledTimes(1);
  });

  it('restores source view when the block receives a specific non-ECharts label', async () => {
    const codeEl = addEChartsBlock(PIE_OPTION);
    const codeBlockHost = codeEl.closest<HTMLElement>('code-block')!;
    fixture.blocks.process();
    await vi.waitFor(() => {
      expect(document.querySelector('.gv-echarts-wrapper')).not.toBeNull();
    });

    codeBlockHost.querySelector('.code-block-decoration span')!.textContent = 'json';
    fixture.blocks.process();

    expect(document.querySelector('.gv-echarts-wrapper')).toBeNull();
    expect(codeBlockHost.style.display).toBe('');
  });
});
