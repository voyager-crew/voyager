// Load shared mocks before the service and its dependencies.
import './__tests__/formulaCopyTestHarness';
import { describe, expect, it } from 'vitest';

import { setupFormulaCopyTestSuite, storageMocks } from './__tests__/formulaCopyTestHarness';

/** Gemini and AI Studio hand the service their `format` and `selectionLatex` settings. */
describe('Formula copy service with preferences from plugin settings', () => {
  const context = setupFormulaCopyTestSuite();
  const { writeTextMock } = context;

  async function clickFormula(math: HTMLElement): Promise<string | undefined> {
    writeTextMock.mockClear();
    math.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    return writeTextMock.mock.calls.at(-1)?.[0];
  }

  it('copies in the given format, applies a later one in place and never reads or watches storage', async () => {
    storageMocks.get.mockResolvedValue({ gvFormulaCopyFormat: 'latex' });
    (navigator.clipboard as unknown as { write?: unknown }).write = undefined;
    const math = document.createElement('span');
    math.setAttribute('data-math', 'x');
    document.body.appendChild(math);

    await context.service.prepare({ format: 'notion', selectionLatex: true });
    context.service.initialize();
    expect(await clickFormula(math)).toBe('$$x$$');

    context.service.adoptPreferences({ format: 'no-dollar', selectionLatex: false });
    expect(await clickFormula(math)).toBe('x');
    expect(context.service.isServiceInitialized()).toBe(true);
    // The settings are the one source: storage is never read or listened to.
    expect(storageMocks.get).not.toHaveBeenCalled();
    expect(storageMocks.addListener).not.toHaveBeenCalled();
  });

  it('a plugin without such settings taking over reads storage again', async () => {
    storageMocks.get.mockResolvedValue({ gvFormulaCopyFormat: 'notion' });
    (navigator.clipboard as unknown as { write?: unknown }).write = undefined;
    const math = document.createElement('span');
    math.setAttribute('data-math', 'x');
    document.body.appendChild(math);

    await context.service.prepare({ format: 'no-dollar', selectionLatex: true });
    context.service.dispose();
    await context.service.prepare();
    context.service.initialize();
    expect(await clickFormula(math)).toBe('$$x$$');
    expect(storageMocks.addListener).toHaveBeenCalledTimes(1);
  });
});
