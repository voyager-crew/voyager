// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  catalogConsumerContext,
  catalogConsumerPage,
  catalogConsumerPatch,
  moveToDialog,
  PluginScope,
} from './catalogConsumerFixture';
import { copyButtonPrimitive } from './copyButton';
import { tableCopyPrimitive } from './tableCopy';

let scope: PluginScope;
let retire: (() => void) | undefined;
const writes = vi.fn().mockResolvedValue(undefined);
const cases = [
  {
    name: 'copy',
    host: '.gv-copy-button',
    start: () =>
      copyButtonPrimitive.activate(
        scope,
        { target: 'assistantTurn', format: 'text' },
        catalogConsumerContext(),
      ),
  },
  {
    name: 'table',
    host: '.gv-table-copy',
    start: () => tableCopyPrimitive.activate(scope, {}, catalogConsumerContext()),
  },
];
function button(selector: string): HTMLButtonElement {
  return document.querySelector(selector)!.shadowRoot!.querySelector('button')!;
}
beforeEach(() => {
  vi.useFakeTimers();
  scope = new PluginScope();
  writes.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writes },
  });
});
afterEach(async () => {
  await scope.dispose();
  retire?.();
  retire = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(cases)(
  '$name preserves clipboard bytes on the same DOM through bundled and remote data',
  async ({ host, start }) => {
    catalogConsumerPage(true);
    void start();
    button(host).click();
    const baseline = writes.mock.calls[0][0];
    expect(baseline).toContain('Cell');
    await scope.dispose();
    scope = new PluginScope();
    retire = await catalogConsumerPatch();
    void start();
    button(host).click();
    expect(writes.mock.calls.map(([text]) => text)).toEqual([baseline, baseline]);
  },
);

it.each(cases)(
  '$name cannot copy a once-valid response after it becomes a dialog preview',
  async ({ host, start }) => {
    catalogConsumerPage();
    retire = await catalogConsumerPatch();
    void start();
    const stale = button(host);
    stale.click();
    expect(writes.mock.calls[0][0]).toContain('Cell');
    moveToDialog(document.querySelector('.answer')!);
    stale.click();
    expect(writes).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(350);
    expect(document.querySelector(host)).toBeNull();
    document.querySelector('main')!.append(document.querySelector('.answer')!);
    await vi.advanceTimersByTimeAsync(350);
    button(host).click();
    expect(writes).toHaveBeenCalledTimes(2);
  },
);

it.each(cases)(
  '$name releases old controls and rejects new dialog aliases on the next scan',
  async ({ host, start }) => {
    catalogConsumerPage();
    retire = await catalogConsumerPatch();
    void start();
    expect(document.querySelectorAll(host)).toHaveLength(1);
    const preview = document.querySelector('.answer')!.cloneNode(true) as HTMLElement;
    preview.querySelectorAll(host).forEach((element) => element.remove());
    moveToDialog(preview);
    await vi.advanceTimersByTimeAsync(350);
    expect(document.querySelector(host)).toBeNull();
    preview.parentElement!.remove();
    await vi.advanceTimersByTimeAsync(350);
    button(host).click();
    expect(writes.mock.calls[0][0]).toContain('Cell');
  },
);
