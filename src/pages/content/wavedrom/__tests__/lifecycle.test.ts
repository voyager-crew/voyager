import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { createWaveDromFixture } from './fixture';

const fixture = createWaveDromFixture();

describe('runtime disable lifecycle', () => {
  const WAVEJSON = '{"signal": [{"name":"clk","wave":"p..."}]}';

  type StorageChangeListener = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string,
  ) => void;

  const startEnabled = (): StorageChangeListener => {
    const storageGet = chrome.storage.sync.get as unknown as ReturnType<typeof vi.fn>;
    storageGet.mockImplementation(
      (_defaults: Record<string, unknown>, callback: (result: Record<string, unknown>) => void) =>
        callback({ [StorageKeys.WAVEDROM_ENABLED]: true }),
    );
    fixture.feature.start();
    const addListener = chrome.storage.onChanged.addListener as unknown as ReturnType<typeof vi.fn>;
    return addListener.mock.calls.at(-1)?.[0] as StorageChangeListener;
  };

  const addWaveDromBlock = (code = WAVEJSON): HTMLElement => {
    const codeBlock = document.createElement('code-block');
    codeBlock.innerHTML = `
      <div class="code-block-decoration"><span>wavedrom</span></div>
      <pre><code data-test-id="code-content"></code></pre>
    `;
    const codeEl = codeBlock.querySelector<HTMLElement>('code')!;
    codeEl.textContent = code;
    document.body.appendChild(codeBlock);
    return codeEl;
  };

  const disable = (listener: StorageChangeListener): void => {
    listener(
      {
        [StorageKeys.WAVEDROM_ENABLED]: { oldValue: true, newValue: false },
      },
      'sync',
    );
  };

  const enable = (listener: StorageChangeListener): void => {
    listener(
      {
        [StorageKeys.WAVEDROM_ENABLED]: { oldValue: false, newValue: true },
      },
      'sync',
    );
  };

  it('clears a queued debounced render when disabled', async () => {
    vi.useFakeTimers();
    const onStorageChanged = startEnabled();
    addWaveDromBlock();
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    disable(onStorageChanged);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);

    const renderAnyMod = await import('wavedrom/render-any');
    expect(renderAnyMod.default).not.toHaveBeenCalled();
    expect(document.querySelector('.gv-wavedrom-wrapper')).toBeNull();
  });

  it('drops an in-flight render that resolves after disable', async () => {
    const onStorageChanged = startEnabled();
    const codeEl = addWaveDromBlock();

    fixture.blocks.process();
    expect(codeEl.dataset.wavedromProcessing).toBe('true');
    disable(onStorageChanged);

    await vi.waitFor(() => {
      expect(codeEl.dataset.wavedromProcessing).toBe('false');
    });
    expect(document.querySelector('.gv-wavedrom-wrapper')).toBeNull();
  });

  it('drops a stale SVG and rerenders the latest source after an await', async () => {
    const updatedWaveJson = '{"signal": [{"name":"data","wave":"x.34"}]}';
    const stringifyMod = await import('onml/stringify.js');
    vi.mocked(stringifyMod.default)
      .mockReturnValueOnce('<svg viewBox="0 0 100 50"><text>stale</text></svg>')
      .mockReturnValueOnce('<svg viewBox="0 0 100 50"><text>latest</text></svg>');
    const codeEl = addWaveDromBlock();

    fixture.blocks.process();
    expect(codeEl.dataset.wavedromProcessing).toBe('true');
    codeEl.textContent = updatedWaveJson;

    await vi.waitFor(() => {
      expect(document.querySelector('.gv-wavedrom-diagram')?.textContent).toContain('latest');
    });
    expect(document.querySelector('.gv-wavedrom-diagram')?.textContent).not.toContain('stale');
    expect(codeEl.dataset.wavedromCode).toBe(updatedWaveJson);

    const renderAnyMod = await import('wavedrom/render-any');
    expect(renderAnyMod.default).toHaveBeenCalledTimes(2);
    expect(renderAnyMod.default).toHaveBeenLastCalledWith(
      expect.any(Number),
      { signal: [{ name: 'data', wave: 'x.34' }] },
      expect.any(Object),
    );
  });

  it('restores rendered source and can render again after re-enable', async () => {
    const onStorageChanged = startEnabled();
    const codeEl = addWaveDromBlock();
    const codeBlockHost = codeEl.closest<HTMLElement>('code-block')!;
    const decoration = codeBlockHost.querySelector<HTMLElement>('.code-block-decoration')!;
    const nativeButtons = document.createElement('div');
    nativeButtons.className = 'buttons';
    nativeButtons.setAttribute(
      'style',
      'position: absolute; top: 8px; right: 12px; margin-top: 3px; color: red;',
    );
    const beforeButtons = document.createElement('span');
    beforeButtons.textContent = 'before';
    const afterButtons = document.createElement('span');
    afterButtons.textContent = 'after';
    decoration.append(beforeButtons, nativeButtons, afterButtons);
    const originalChildren = Array.from(decoration.childNodes);
    const originalStyle = nativeButtons.getAttribute('style');

    fixture.blocks.process();
    await vi.waitFor(() => {
      expect(document.querySelector('.gv-wavedrom-wrapper')).not.toBeNull();
    });
    expect(document.querySelector('.gv-wavedrom-toggle')?.contains(nativeButtons)).toBe(true);
    expect(document.getElementById('gv-wavedrom-styles')).not.toBeNull();
    // The toolbar sits above the timing diagram instead of floating over its waves.
    const toggle = document.querySelector<HTMLElement>('.gv-wavedrom-toggle')!;
    expect(document.querySelector('.gv-wavedrom-wrapper')!.firstElementChild).toBe(toggle);
    expect(getComputedStyle(toggle).position).not.toBe('absolute');
    fixture.fullscreen.open('<svg viewBox="0 0 50 50"><g/></svg>', '#f9fafb');
    expect(document.querySelector('.gv-wavedrom-modal')).not.toBeNull();

    disable(onStorageChanged);

    expect(document.querySelector('.gv-wavedrom-wrapper')).toBeNull();
    expect(document.querySelector('.gv-wavedrom-modal')).toBeNull();
    expect(document.getElementById('gv-wavedrom-styles')).toBeNull();
    expect(codeBlockHost.style.display).toBe('');
    expect(Array.from(decoration.childNodes)).toEqual(originalChildren);
    expect(nativeButtons.getAttribute('style')).toBe(originalStyle);
    expect(codeEl.dataset.wavedromCode).toBeUndefined();

    enable(onStorageChanged);
    await vi.waitFor(() => {
      expect(document.querySelector('.gv-wavedrom-wrapper')).not.toBeNull();
    });
    expect(document.getElementById('gv-wavedrom-styles')).not.toBeNull();
  });
});
