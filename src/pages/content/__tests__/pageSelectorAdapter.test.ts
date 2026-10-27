import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import type { SiteAdapter } from '@/features/plugins/types';

import { startPageSelectorAdapter } from '../pageSelectorAdapter';

const bundle = requireBundledSiteAdapter('gemini');
const cached: SiteAdapter = { ...bundle, catalogRevision: Number.MAX_SAFE_INTEGER };
const stops: Array<() => void> = [];

function pending() {
  let finish: (adapter: SiteAdapter | null) => void = () => {};
  const read = new Promise<SiteAdapter | null>((resolve) => {
    finish = resolve;
  });
  const lifetime = new AbortController();
  const adapter = startPageSelectorAdapter({
    bundled: bundle,
    lifetime: lifetime.signal,
    read: () => read,
  });
  stops.push(adapter.stop);
  return { ...adapter, finish, lifetime };
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

it('a timely cache read preserves the newer adapter for its caller', async () => {
  const adapter = pending();
  await vi.advanceTimersByTimeAsync(40);
  adapter.finish(cached);
  expect((await adapter.ready).adapter).toBe(cached);
  expect(vi.getTimerCount()).toBe(0);
});

it('a hung cache resolves to the bundle at 250 ms', async () => {
  const adapter = pending();
  let mounted: SiteAdapter | null | undefined;
  void adapter.ready.then((value) => {
    mounted = value.adapter;
  });
  await vi.advanceTimersByTimeAsync(249);
  expect(mounted).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(mounted).toBe(bundle);
  adapter.finish(cached);
  await vi.advanceTimersByTimeAsync(0);
  expect((await adapter.ready).adapter).toBe(bundle);
  expect(vi.getTimerCount()).toBe(0);
});

it('a failed cache resolves to the bundle without waiting for the deadline', async () => {
  const adapter = startPageSelectorAdapter({
    bundled: bundle,
    lifetime: new AbortController().signal,
    read: async () => {
      throw new Error('Storage unavailable');
    },
  });
  stops.push(adapter.stop);
  let resolved: SiteAdapter | null | undefined;
  void adapter.ready.then((value) => {
    resolved = value.adapter;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(resolved).toBe(bundle);
  expect((await adapter.ready).adapter).toBe(bundle);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['stop', 'abort'] as const)(
  'a retired page cannot adopt a cached adapter that arrives after %s',
  async (method) => {
    const adapter = pending();
    await vi.advanceTimersByTimeAsync(10);
    if (method === 'stop') adapter.stop();
    else adapter.lifetime.abort();
    let resolved: SiteAdapter | null | undefined;
    void adapter.ready.then((value) => {
      resolved = value.adapter;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(bundle);
    expect((await adapter.ready).adapter).toBe(bundle);
    adapter.finish(cached);
    await vi.advanceTimersByTimeAsync(0);
    expect((await adapter.ready).adapter).toBe(bundle);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('an already retired page settles without starting another cache read', async () => {
  const lifetime = new AbortController();
  lifetime.abort();
  const read = vi.fn(async () => cached);
  const adapter = startPageSelectorAdapter({ bundled: bundle, lifetime: lifetime.signal, read });
  expect((await adapter.ready).adapter).toBe(bundle);
  expect(read).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
