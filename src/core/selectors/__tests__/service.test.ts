import { afterEach, describe, expect, it, vi } from 'vitest';

import { getBundledSiteSelectorView } from '../bundle';
import { SiteSelectorService, type SiteSelectorLifetime } from '../service';
import type { SiteSelectorView } from '../types';

const lifetimes: SiteSelectorLifetime[] = [];
const sites = [
  ['gemini', 'gemini.google.com', 'composer.candidates'],
  ['gemini', 'business.gemini.google', 'composer.candidates'],
  ['aistudio', 'aistudio.google.com', 'input.candidates'],
  ['aistudio', 'aistudio.google.cn', 'input.candidates'],
  ['chatgpt', 'chatgpt.com', 'input.candidates'],
  ['chatgpt', 'chat.openai.com', 'input.candidates'],
  ['claude', 'claude.ai', 'input.candidates'],
  ['deepseek', 'chat.deepseek.com', 'export.assistantContent'],
  ['kimi', 'www.kimi.com', 'input.candidates'],
] as const;

async function hydrate(
  siteId: string,
  host: string,
  locators: unknown,
  raw: Record<string, unknown> = {},
) {
  const service = new SiteSelectorService(siteId);
  const lifetime = service.initialize({
    host,
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 1,
    read: async () => ({ id: siteId, catalogRevision: 2, locators, ...raw }),
  });
  lifetimes.push(lifetime);
  await lifetime.ready;
  return service;
}

function readInputs(view: SiteSelectorView, key: string) {
  return Array.from(document.querySelectorAll(view.profiles[key].join(',')));
}

afterEach(() => {
  for (const lifetime of lifetimes.splice(0)) lifetime.stop();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('per-site catalog snapshots', () => {
  it.each(sites)(
    '%s on %s reads the same page content through bundled and remote profiles',
    async (siteId, host, key) => {
      document.body.innerHTML = `
      <form><rich-textarea><div id="draft" class="ql-editor ds-scroll-area" data-testid="chat-input" data-lexical-editor="true" contenteditable="true" role="textbox">Draft</div></rich-textarea>
      <textarea class="ds-scroll-area" aria-label="Prompt">Draft</textarea></form><div class="markdown"><p>Answer</p></div>`;
      const bundled = readInputs(getBundledSiteSelectorView(siteId), key);
      expect(bundled.length).toBeGreaterThan(0);
      bundled.forEach((element) => element.classList.add('same-draft'));
      const service = await hydrate(siteId, host, { [key]: ['.same-draft'] });
      const accepted = service.resolve(
        (view) => readInputs(view, key),
        (nodes) => nodes.length > 0,
      );
      expect(accepted.view.remoteKeys.has(key)).toBe(true);
      expect(accepted.value).toEqual(bundled);
      expect(accepted.value.map((node) => node.textContent)).toEqual(
        bundled.map((node) => node.textContent),
      );
    },
  );

  it('a ChatGPT cache cannot replace Claude input even if its locator matches', async () => {
    document.body.innerHTML =
      '<div data-testid="chat-input" contenteditable="true">Claude draft</div><section class="foreign">ChatGPT draft</section>';
    const service = await hydrate(
      'claude',
      'claude.ai',
      { 'input.candidates': ['.foreign'] },
      { id: 'chatgpt' },
    );
    expect(
      readInputs(service.getView(), 'input.candidates').map((node) => node.textContent),
    ).toEqual(['Claude draft']);
    const foreignHost = await hydrate('claude', 'chatgpt.com', {
      'input.candidates': ['.foreign'],
    });
    expect(
      readInputs(foreignHost.getView(), 'input.candidates').map((node) => node.textContent),
    ).toEqual(['Claude draft']);
  });

  it.each(['[', ['.wrong-shape'], null, 'x'.repeat(2049)].map((invalid) => ({ invalid })))(
    'an invalid composer group leaves the input repair usable and restores its Send control: %j',
    async ({ invalid }) => {
      document.body.innerHTML =
        '<form><div id="prompt-textarea" contenteditable="true">Bundled input</div><button type="submit">Send</button></form><section class="repaired">Repaired input</section><button class="wrong-send">Wrong Send</button>';
      const service = await hydrate(
        'chatgpt',
        'chatgpt.com',
        { 'input.candidates': ['.repaired'] },
        {
          selectors: { composer: invalid, sendButton: '.wrong-send', composerRoot: '.wrong-root' },
        },
      );
      expect(
        readInputs(service.getView(), 'input.candidates').map((node) => node.textContent),
      ).toEqual(['Repaired input']);
      expect(readInputs(service.getView(), 'composer').map((node) => node.textContent)).toEqual([
        'Bundled input',
      ]);
      expect(readInputs(service.getView(), 'sendButton').map((node) => node.textContent)).toEqual([
        'Send',
      ]);
    },
  );

  it('a rejected partial operation rereads every field from the bundle', async () => {
    document.body.innerHTML =
      '<div data-testid="chat-input" contenteditable="true">Complete draft</div><section class="partial">Wrong draft</section>';
    const service = await hydrate(
      'claude',
      'claude.ai',
      { 'input.candidates': ['.partial'] },
      { selectors: { composer: '.missing' } },
    );
    const operation = service.resolve(
      (view) => ({
        inputs: readInputs(view, 'input.candidates'),
        mount: readInputs(view, 'composer'),
      }),
      ({ inputs, mount }) => inputs.length === 1 && mount.length === 1,
    );
    expect(operation.value.inputs.map((node) => node.textContent)).toEqual(['Complete draft']);
    expect(operation.value.mount).toEqual(operation.value.inputs);
  });

  it('without remote changes each operation calls the bundled reader exactly once', () => {
    document.body.innerHTML = '<textarea class="ds-scroll-area">Draft</textarea>';
    const service = new SiteSelectorService('deepseek');
    const read = vi.fn((view: SiteSelectorView) => readInputs(view, 'input.candidates'));
    const guard = vi.fn(() => true);
    const operation = service.resolve(read, guard);
    expect(operation.value.map((node) => node.textContent)).toEqual(['Draft']);
    expect(read).toHaveBeenCalledTimes(1);
    expect(guard).not.toHaveBeenCalled();
  });

  it('a late read cannot replace the draft view after its lifetime has ended', async () => {
    document.body.innerHTML =
      '<div data-testid="chat-input" contenteditable="true">Saved draft</div><section class="late">Other draft</section>';
    const service = new SiteSelectorService('claude');
    const controller = new AbortController();
    let complete: (raw: unknown) => void = () => undefined;
    const lifetime = service.initialize({
      host: 'claude.ai',
      doc: document,
      lifetime: controller.signal,
      bundledRevision: 1,
      read: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    lifetimes.push(lifetime);
    await Promise.resolve();
    controller.abort();
    await lifetime.ready;
    complete({ id: 'claude', catalogRevision: 2, locators: { 'input.candidates': ['.late'] } });
    await Promise.resolve();
    await Promise.resolve();
    expect(
      readInputs(service.getView(), 'input.candidates').map((node) => node.textContent),
    ).toEqual(['Saved draft']);
  });
});
