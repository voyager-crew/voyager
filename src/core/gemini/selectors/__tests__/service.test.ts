import { afterEach, describe, expect, it, vi } from 'vitest';

import { getBundledGeminiTurnView } from '../bundle';
import { GeminiSelectorService } from '../service';

const patch = (selectors: unknown, catalogRevision = 2) => ({
  format: 1,
  site: 'gemini',
  host: 'gemini.google.com',
  catalogRevision,
  selectors,
});

function mount(service: GeminiSelectorService, read: () => Promise<unknown>, signal?: AbortSignal) {
  return service.initialize({
    host: 'gemini.google.com',
    doc: document,
    lifetime: signal ?? new AbortController().signal,
    read,
    bundledRevision: 1,
  });
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('Gemini page selector snapshot', () => {
  it('reads once and replaces an ordered list as a whole without filling it with old entries', async () => {
    const service = new GeminiSelectorService();
    const read = vi.fn(async () => patch({ 'turn.user': ['.new-second', '.new-first'] }));
    const lifetime = mount(service, read);
    await lifetime.ready;
    expect(service.getView().profiles['turn.user']).toEqual(['.new-second', '.new-first']);
    expect(service.getView().profiles['turn.assistant']).toEqual(
      getBundledGeminiTurnView().profiles['turn.assistant'],
    );
    service.getView();
    service.getView();
    expect(read).toHaveBeenCalledTimes(1);
    lifetime.stop();
  });

  it('rejects the whole cached patch when one selector fails native parsing', async () => {
    const service = new GeminiSelectorService();
    const lifetime = mount(service, async () =>
      patch({ 'turn.user': ['.valid-new'], 'turn.assistant': ['['] }),
    );
    await lifetime.ready;
    expect(service.getView().remoteKeys.size).toBe(0);
    expect(service.getView().profiles['turn.user']).toContain('.user-query-container');
    lifetime.stop();
  });

  it('never adopts a stale revision or a failed storage read', async () => {
    const service = new GeminiSelectorService();
    const old = mount(service, async () => patch({ 'turn.user': ['.old'] }, 1));
    await old.ready;
    expect(service.getView().remoteKeys.size).toBe(0);
    old.stop();
    const failed = mount(service, async () => {
      throw new Error('storage unavailable');
    });
    await failed.ready;
    expect(service.getView().remoteKeys.size).toBe(0);
    failed.stop();
  });

  it('does not install a late read after the startup deadline', async () => {
    vi.useFakeTimers();
    const service = new GeminiSelectorService();
    let complete: (value: unknown) => void = () => undefined;
    const pending = new Promise<unknown>((resolve) => {
      complete = resolve;
    });
    const lifetime = mount(service, () => pending);
    await vi.advanceTimersByTimeAsync(250);
    await lifetime.ready;
    complete(patch({ 'turn.user': ['.late'] }));
    await Promise.resolve();
    await Promise.resolve();
    expect(service.getView().remoteKeys.size).toBe(0);
    lifetime.stop();
  });

  it('stops a pending read on retirement and does not let an old cleanup clear a new snapshot', async () => {
    const service = new GeminiSelectorService();
    const controller = new AbortController();
    const old = mount(service, () => new Promise(() => undefined), controller.signal);
    controller.abort();
    await old.ready;
    const current = mount(service, async () => patch({ 'turn.user': ['.current'] }));
    await current.ready;
    old.stop();
    expect(service.getView().profiles['turn.user']).toEqual(['.current']);
    current.stop();
    expect(service.getView().remoteKeys.size).toBe(0);
  });

  it('uses remote-only DOM when bundled selectors find nothing', async () => {
    const service = new GeminiSelectorService();
    const user = document.createElement('section');
    user.className = 'new-user';
    document.body.append(user);
    const lifetime = mount(service, async () => patch({ 'turn.user': ['.new-user'] }));
    await lifetime.ready;
    const result = service.resolve(
      (view) => Array.from(document.querySelectorAll(view.profiles['turn.user'].join(','))),
      (nodes) => nodes.length > 0,
    );
    expect(result.value).toEqual([user]);
    expect(result.view.remoteKeys.has('turn.user')).toBe(true);
    lifetime.stop();
  });

  it('retries the entire operation on an empty remote result without combining tiers', async () => {
    const service = new GeminiSelectorService();
    const user = document.createElement('user-query');
    const assistant = document.createElement('model-response');
    document.body.append(user, assistant);
    const lifetime = mount(service, async () =>
      patch({
        'turn.userWithHosts': ['.missing-user'],
        'turn.assistantWithHosts': ['.missing-answer'],
      }),
    );
    await lifetime.ready;
    const result = service.resolve(
      (view) => ({
        users: Array.from(document.querySelectorAll(view.profiles['turn.userWithHosts'].join(','))),
        answers: Array.from(
          document.querySelectorAll(view.profiles['turn.assistantWithHosts'].join(',')),
        ),
      }),
      (value) => value.users.length > 0,
    );
    expect(result.value).toEqual({ users: [user], answers: [assistant] });
    expect(result.view.remoteKeys.size).toBe(0);
    lifetime.stop();
  });

  it('does not do a partial-pair rescue probe once the operation is usable', async () => {
    const service = new GeminiSelectorService();
    const lifetime = mount(service, async () => patch({ 'turn.user': ['.new-user'] }));
    await lifetime.ready;
    const read = vi.fn(() => ({ users: ['pending'], answers: [] }));
    expect(service.resolve(read, (value) => value.users.length > 0).value).toEqual({
      users: ['pending'],
      answers: [],
    });
    expect(read).toHaveBeenCalledTimes(1);
    lifetime.stop();
  });
});
