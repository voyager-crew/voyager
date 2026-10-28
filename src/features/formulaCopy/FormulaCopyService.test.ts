// Load shared mocks before the service and its dependencies.
import './__tests__/formulaCopyTestHarness';
import { describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { toastDriver } from '@/tests/toastDriver';
import { setCachedLanguage } from '@/utils/i18n';

import { FormulaCopyService } from './FormulaCopyService';
import {
  resetSingleton,
  setupFormulaCopyTestSuite,
  storageMocks,
} from './__tests__/formulaCopyTestHarness';

describe('Formula copy service', () => {
  const context = setupFormulaCopyTestSuite();
  const { writeMock, writeTextMock } = context;

  it('should initialize correctly and retain its active CSS marker', async () => {
    context.service.initialize();
    expect(context.service.isServiceInitialized()).toBe(true);
    expect(document.documentElement.classList.contains('gv-formula-copy-enabled')).toBe(true);

    document.documentElement.classList.remove('gv-formula-copy-enabled');
    await Promise.resolve();
    expect(document.documentElement.classList.contains('gv-formula-copy-enabled')).toBe(true);

    context.service.destroy();
    expect(document.documentElement.classList.contains('gv-formula-copy-enabled')).toBe(false);
  });

  it.each([
    ['ordinary text and arrow', 'plain-arrow'],
    ['ordinary text containing a host math-wrapped arrow', 'wrapped-arrow'],
    ['ordinary text and a real formula', 'formula'],
  ])('does not intercept native copy events for %s', (_label, fixtureKind) => {
    const selection = document.createElement('p');
    if (fixtureKind === 'wrapped-arrow') {
      selection.append('A ');
      const wrapper = document.createElement('span');
      wrapper.className = 'math-inline';
      const arrow = document.createElement('span');
      arrow.setAttribute('data-math', '\\rightarrow');
      arrow.textContent = '→';
      wrapper.appendChild(arrow);
      selection.append(wrapper, ' B');
    } else if (fixtureKind === 'formula') {
      selection.append('Result: ');
      const formula = document.createElement('span');
      formula.className = 'math-inline';
      formula.setAttribute('data-math', 'x^2');
      formula.textContent = 'x²';
      selection.append(formula);
    } else {
      selection.textContent = 'A → B';
    }
    document.body.appendChild(selection);
    const range = document.createRange();
    range.selectNodeContents(selection);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const setData = vi.fn();
    const copyEvent = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, 'clipboardData', { value: { setData } });

    context.service.initialize();
    selection.dispatchEvent(copyEvent);

    expect(copyEvent.defaultPrevented).toBe(false);
    expect(setData).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
    expect(writeTextMock).not.toHaveBeenCalled();
    window.getSelection()?.removeAllRanges();
  });

  it('leaves right-click behavior native and only copies on a later left click', async () => {
    const clipboard = navigator.clipboard as unknown as { write?: unknown };
    clipboard.write = undefined;
    const mathElement = document.createElement('span');
    mathElement.setAttribute('data-math', 'x^2');
    document.body.appendChild(mathElement);

    context.service.initialize();
    const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    mathElement.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(false);
    expect(writeTextMock).not.toHaveBeenCalled();

    mathElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(writeTextMock).toHaveBeenCalledWith('$x^2$');
  });

  it('becomes fully inert after destroy without clearing the selected format', async () => {
    const clipboard = navigator.clipboard as unknown as { write?: unknown };
    clipboard.write = undefined;
    const mathElement = document.createElement('span');
    mathElement.setAttribute('data-math', 'x^2');
    document.body.appendChild(mathElement);
    const pageClick = vi.fn();
    mathElement.addEventListener('click', pageClick);

    context.service.initialize();
    const formatListener = storageMocks.addListener.mock.calls.at(-1)?.[0] as Parameters<
      typeof browser.storage.onChanged.addListener
    >[0];
    formatListener({ gvFormulaCopyFormat: { oldValue: 'latex', newValue: 'notion' } }, 'sync');
    mathElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeTextMock).toHaveBeenCalledWith('$$x^2$$');
    expect(toastDriver.all()).toHaveLength(1);
    expect(pageClick).not.toHaveBeenCalled();

    context.service.destroy();
    writeTextMock.mockClear();
    expect(toastDriver.all()).toEqual([]);
    expect(document.documentElement.classList.contains('gv-formula-copy-enabled')).toBe(false);

    const disabledClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    mathElement.dispatchEvent(disabledClick);
    await Promise.resolve();

    expect(writeMock).not.toHaveBeenCalled();
    expect(writeTextMock).not.toHaveBeenCalled();
    expect(pageClick).toHaveBeenCalledTimes(1);
    expect(disabledClick.defaultPrevented).toBe(false);

    context.service.initialize();
    mathElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(writeTextMock).toHaveBeenCalledWith('$$x^2$$');
  });

  it('keeps format preference updates live while disabled', async () => {
    const clipboard = navigator.clipboard as unknown as { write?: unknown };
    clipboard.write = undefined;
    const mathElement = document.createElement('span');
    mathElement.setAttribute('data-math', 'x');
    document.body.appendChild(mathElement);

    context.service.initialize();
    const firstListener = storageMocks.addListener.mock.calls.at(-1)?.[0] as Parameters<
      typeof browser.storage.onChanged.addListener
    >[0];
    firstListener({ gvFormulaCopyFormat: { oldValue: 'latex', newValue: 'notion' } }, 'sync');
    mathElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(writeTextMock).toHaveBeenLastCalledWith('$$x$$');

    context.service.destroy();
    firstListener({ gvFormulaCopyFormat: { oldValue: 'notion', newValue: 'no-dollar' } }, 'sync');
    context.service.initialize();
    mathElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    expect(writeTextMock).toHaveBeenLastCalledWith('x');
    expect(storageMocks.addListener).toHaveBeenCalledTimes(1);
    expect(storageMocks.removeListener).not.toHaveBeenCalled();

    context.service.dispose();
    expect(storageMocks.removeListener).toHaveBeenCalledWith(firstListener);
  });

  it('loads the latest format before a caller activates click handling', async () => {
    let resolveFormatRead!: (value: Record<string, unknown>) => void;
    storageMocks.get.mockImplementation(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolveFormatRead = resolve;
        }),
    );
    const clipboard = navigator.clipboard as unknown as { write?: unknown };
    clipboard.write = undefined;
    const mathElement = document.createElement('span');
    mathElement.setAttribute('data-math', 'x');
    document.body.appendChild(mathElement);

    const preparing = context.service.prepare();
    expect(context.service.isServiceInitialized()).toBe(false);
    resolveFormatRead({ gvFormulaCopyFormat: 'notion' });
    await preparing;
    context.service.initialize();
    mathElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    expect(writeTextMock).toHaveBeenCalledWith('$$x$$');
  });

  it('does not let a stale format read override a newer live format change', async () => {
    let resolveFormatRead!: (value: Record<string, unknown>) => void;
    storageMocks.get.mockImplementation(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolveFormatRead = resolve;
        }),
    );
    const clipboard = navigator.clipboard as unknown as { write?: unknown };
    clipboard.write = undefined;
    const mathElement = document.createElement('span');
    mathElement.setAttribute('data-math', 'x');
    document.body.appendChild(mathElement);

    context.service.initialize();
    const formatListener = storageMocks.addListener.mock.calls.at(-1)?.[0] as Parameters<
      typeof browser.storage.onChanged.addListener
    >[0];
    formatListener({ gvFormulaCopyFormat: { oldValue: 'latex', newValue: 'notion' } }, 'sync');
    resolveFormatRead({ gvFormulaCopyFormat: 'latex' });
    await Promise.resolve();

    mathElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(writeTextMock).toHaveBeenCalledWith('$$x$$');
  });

  it('does not show a late toast after the service is disabled', async () => {
    let resolveClipboardWrite!: () => void;
    writeTextMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveClipboardWrite = resolve;
        }),
    );
    const clipboard = navigator.clipboard as unknown as { write?: unknown };
    clipboard.write = undefined;
    const mathElement = document.createElement('span');
    mathElement.setAttribute('data-math', 'x');
    document.body.appendChild(mathElement);

    context.service.initialize();
    mathElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    context.service.destroy();
    resolveClipboardWrite();
    await Promise.resolve();
    await Promise.resolve();

    expect(toastDriver.all()).toEqual([]);
  });

  it('does not let a pre-disable timer hide a toast created after re-enable', async () => {
    vi.useFakeTimers();
    try {
      const mathElement = document.createElement('span');
      mathElement.setAttribute('data-math', 'x');
      document.body.appendChild(mathElement);

      context.service.initialize();
      mathElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      expect(toastDriver.all()).toHaveLength(1);

      context.service.destroy();
      vi.advanceTimersByTime(1000);
      context.service.initialize();
      mathElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      expect(toastDriver.all()).toHaveLength(1);

      vi.advanceTimersByTime(1000);
      expect(toastDriver.all()).toHaveLength(1);
      vi.advanceTimersByTime(1000);
      expect(toastDriver.all()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the success toast in the user-selected language, not the browser UI locale', async () => {
    // Pick Chinese the way the popup language switcher does (custom i18n layer),
    // independent of browser.i18n / the browser UI locale.
    await setCachedLanguage('zh');
    resetSingleton();
    context.service = FormulaCopyService.getInstance({ format: 'latex' });

    const mathElement = document.createElement('span');
    mathElement.setAttribute('data-math', 'x^2');
    mathElement.classList.add('math-inline');
    document.body.appendChild(mathElement);

    context.service.initialize();
    mathElement.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(toastDriver.all().map(({ message, tone }) => [message, tone])).toEqual([
      ['公式已复制', 'success'],
    ]);

    await setCachedLanguage('en');
  });
});
