import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  KEPT,
  ORIGINAL_URL,
  USER,
  branched,
  domResult,
  endpointFetch,
  jsonResponse,
  openConversation,
  readGrok,
} from './grokConversation.fixtures';

declare const jsdom: import('jsdom').JSDOM;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  jsdom.reconfigure({ url: ORIGINAL_URL });
  document.body.replaceChildren();
});

describe('Grok page fallback', () => {
  it('logs which path read the conversation', async () => {
    openConversation();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { nodes, responses } = branched();
    await readGrok(endpointFetch(nodes, responses));
    expect(info).toHaveBeenCalledWith('Grok export read via endpoint', {
      source: 'endpoint',
      count: 2,
    });

    await readGrok(async () => jsonResponse('no', 500), { readDom: async () => domResult('x') });
    expect(info).toHaveBeenLastCalledWith('Grok export read via virtual DOM', {
      source: 'virtual-dom',
      count: 1,
    });
  });

  it('embeds a YouTube link from the page when the endpoint is missed', async () => {
    openConversation();
    const result = await readGrok(async () => jsonResponse('no', 500), {
      readDom: async () => domResult('对比视频：https://www.youtube.com/watch?v=JMYspR42HFM'),
    });
    expect(result.snapshots[0]?.text).toBe(
      '对比视频：[![YouTube video](https://img.youtube.com/vi/JMYspR42HFM/hqdefault.jpg)](https://www.youtube.com/watch?v=JMYspR42HFM)',
    );
    expect(result.snapshots[0]?.content.hasImages).toBe(true);
  });

  it('stops a page read while the composer stop control is present', async () => {
    vi.useFakeTimers();
    openConversation();
    document.body.innerHTML =
      '<div data-testid="chat-transcript-scroller">' +
      `<div data-plane-row="gateway:${USER}"><div data-testid="user-message">Page prompt</div></div>` +
      `<div data-plane-row="gateway:${KEPT}"><div data-testid="assistant-message"><p>Page answer</p></div></div>` +
      '</div>' +
      '<button type="button" aria-label="Stop" data-testid="composer-stop"></button>';
    const scroller = document.querySelector<HTMLElement>(
      '[data-testid="chat-transcript-scroller"]',
    )!;
    let top = 40;
    Object.defineProperties(scroller, {
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          top = value;
        },
      },
      scrollHeight: { configurable: true, get: () => 2000 },
      clientHeight: { configurable: true, get: () => 800 },
    });
    const pending = readGrok(async () => jsonResponse('no', 500));
    await vi.advanceTimersByTimeAsync(150_000);
    const result = await pending;
    expect(result.completeness).toBe('partial');
    expect(result.reason).toBe('generating');
    expect(result.snapshots).toEqual([]);
    expect(scroller.scrollTop).toBe(40);
  });
});
