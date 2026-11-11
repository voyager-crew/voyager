// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isUserEvent } from '@/core/utils/userEvent';
import { createPageUrl } from '@/features/plugins/local/authoring/skillLink';
import type { LocalPluginRecordMap } from '@/features/plugins/local/localPluginStore';
import type { SiteAdapter } from '@/features/plugins/types';

import { REPLY_CONTROL_CLASS } from '../replyControl';
import { RESCAN_DELAY_MS, startReplyControls } from '../replyControls';

vi.mock('@/core/utils/userEvent', () => ({ isUserEvent: vi.fn(() => false) }));

const MANIFEST = {
  id: 'me.rounded',
  name: 'Rounded',
  version: '1.0.0',
  description: 'Round my messages',
  author: 'me',
  category: 'readability',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: ['https://claude.ai/*'],
  contributes: { styles: [{ css: '.gv-plugin-rounded{border-radius:16px}' }] },
};
const plugin = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({ ...MANIFEST, ...patch }, null, 2);

const SITE = (codeBlock?: string): SiteAdapter => ({
  id: 'fixture',
  label: 'Fixture',
  matches: ['https://fixture.test/*'],
  theme: { hostSelector: 'body', lightSelector: 'body.light', darkSelector: 'body.dark' },
  capabilities: new Set(),
  selectors: {
    userTurn: '.user',
    assistantTurn: '.assistant',
    ...(codeBlock ? { codeBlock } : {}),
  },
});

const MARKER = `Read ${createPageUrl('claude')} first, then round my messages.`;

let stop: (() => void) | null = null;
let records: LocalPluginRecordMap;
let notifyRecords: () => void;
const onAction = vi.fn();

function chat(userText: string, blocks: readonly string[]): void {
  document.body.innerHTML = `
    <main>
      <div class="user"></div>
      <div class="assistant"><p>Here it is.</p></div>
    </main>`;
  document.querySelector('.user')!.textContent = userText;
  for (const text of blocks) addBlock(text);
}

function addBlock(text: string): HTMLElement {
  const block = document.createElement('div');
  block.className = 'code';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = text;
  pre.append(code);
  block.append(pre);
  document.querySelector('.assistant')!.append(block);
  return block;
}

function start(site: SiteAdapter = SITE('.code')): void {
  stop = startReplyControls({
    doc: document,
    adapter: site,
    loadRecords: async () => records,
    subscribeRecords: (callback) => {
      notifyRecords = callback;
      return () => {
        notifyRecords = () => {};
      };
    },
    onAction,
  });
}

const settle = () => vi.advanceTimersByTimeAsync(RESCAN_DELAY_MS + 10);
const controls = () =>
  Array.from(document.querySelectorAll<HTMLElement>(`.${REPLY_CONTROL_CLASS}`));
const controlText = (control: HTMLElement) => control.shadowRoot?.textContent ?? '';
const controlButton = (control: HTMLElement) => control.shadowRoot?.querySelector('button') ?? null;

describe('Create mode controls under reply code blocks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    records = {};
    notifyRecords = () => {};
    onAction.mockClear();
    vi.mocked(isUserEvent).mockReturnValue(false);
  });

  afterEach(() => {
    stop?.();
    stop = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('reads no reply in a chat that no user message started from a create page', async () => {
    chat('Round my messages please', [plugin()]);
    start();
    await settle();
    expect(controls()).toHaveLength(0);
  });

  it('offers a review under a plugin block once the chat is a Create chat', async () => {
    chat(MARKER, [plugin()]);
    start();
    await settle();

    const [control] = controls();
    expect(control.previousElementSibling?.className).toBe('code');
    expect(controlText(control)).toContain('Preview and install');
  });

  it('follows blocks as they arrive and leave, and teardown restores the page', async () => {
    chat(MARKER, []);
    const before = document.body.innerHTML;
    start();
    await settle();
    expect(controls()).toHaveLength(0);

    const block = addBlock(plugin());
    await settle();
    expect(controls()).toHaveLength(1);

    block.remove();
    await settle();
    expect(controls()).toHaveLength(0);

    addBlock(plugin());
    await settle();
    expect(controls()).toHaveLength(1);
    stop?.();
    stop = null;
    document.querySelector('.code')?.remove();
    expect(document.body.innerHTML).toBe(before);
  });

  it('gives a block still streaming, or code that is no JSON object, no control', async () => {
    chat(MARKER, [plugin().slice(0, 80), '[1, 2]', 'const x = 1;']);
    start();
    await settle();
    expect(controls()).toHaveLength(0);
  });

  it('lets only the latest block per plugin act, and marks earlier ones', async () => {
    chat(MARKER, [plugin(), plugin({ version: '1.1.0' })]);
    start();
    await settle();

    const [earlier, latest] = controls();
    expect(controlButton(earlier)).toBeNull();
    expect(controlText(earlier)).toContain('Earlier version');
    expect(controlText(latest)).toContain('Preview and install');
  });

  it('tells an installed plugin apart from an update to it, and follows installs', async () => {
    chat(MARKER, [plugin()]);
    start();
    await settle();
    expect(controlText(controls()[0])).toContain('Preview and install');

    records = {
      'local.me.rounded': { manifest: { ...MANIFEST, id: 'local.me.rounded' } },
    } as never;
    notifyRecords();
    await settle();
    expect(controlText(controls()[0])).toContain('Installed');
    expect(controlButton(controls()[0])).toBeNull();

    records = {
      'local.me.rounded': { manifest: { ...MANIFEST, id: 'local.me.rounded', version: '0.9.0' } },
    } as never;
    notifyRecords();
    await settle();
    expect(controlText(controls()[0])).toContain('Preview update');
  });

  it('says why a refused plugin cannot install and offers to ask for a fix', async () => {
    chat(MARKER, [plugin({ matches: ['https://example.com/*'] })]);
    start();
    await settle();
    const [control] = controls();
    expect(controlText(control)).toContain(
      'Can’t install this yet. It targets a site Voyager doesn’t support.',
    );
    expect(controlButton(control)?.textContent).toBe('Ask it to fix');
  });

  it('answers JSON in a format of the AI’s own instead of staying silent', async () => {
    chat(MARKER, [JSON.stringify({ name: 'Wide chat', target: 'gemini', css: '.a{}' })]);
    start();
    await settle();
    const [control] = controls();
    expect(controlText(control)).toContain('It isn’t written in Voyager’s plugin format.');

    vi.mocked(isUserEvent).mockReturnValue(true);
    controlButton(control)!.click();
    expect(onAction).toHaveBeenCalledWith(
      'problems',
      expect.objectContaining({ verdict: expect.objectContaining({ kind: 'rejected' }) }),
    );
  });

  /** A conversation ChatGPT keeps mounted, hidden, ahead of the one on screen. */
  function cachedConversation(userText: string, blocks: readonly string[]): void {
    const cached = document.createElement('main');
    cached.style.display = 'none';
    cached.innerHTML = '<div class="user"></div><div class="assistant"></div>';
    cached.querySelector('.user')!.textContent = userText;
    for (const text of blocks) {
      const block = document.createElement('div');
      block.className = 'code';
      block.innerHTML = '<pre><code></code></pre>';
      block.querySelector('code')!.textContent = text;
      cached.querySelector('.assistant')!.append(block);
    }
    document.body.append(cached);
  }

  it('gives an ordinary chat no control while a hidden earlier Create chat stays mounted', async () => {
    chat('Here is some JSON I found', [plugin()]);
    cachedConversation(MARKER, [plugin()]);
    start();
    await settle();
    expect(controls()).toHaveLength(0);
  });

  it('never lets a hidden conversation’s block count as the latest version', async () => {
    chat(MARKER, [plugin()]);
    cachedConversation(MARKER, [plugin({ version: '2.0.0' })]);
    start();
    await settle();

    expect(controls()).toHaveLength(1);
    expect(controlText(controls()[0])).toContain('Preview and install');
  });

  it('reads a pre inside a reply where the site declares no code block anchor', async () => {
    chat(MARKER, [plugin()]);
    start(SITE());
    await settle();
    expect(controls()).toHaveLength(1);
  });

  it('ignores a script’s click and hands the block over on a person’s click', async () => {
    chat(MARKER, [plugin()]);
    start();
    await settle();
    const button = controlButton(controls()[0])!;

    button.click();
    expect(onAction).not.toHaveBeenCalled();

    vi.mocked(isUserEvent).mockReturnValue(true);
    button.click();
    expect(onAction).toHaveBeenCalledWith(
      'preview',
      expect.objectContaining({ text: plugin(), siteId: 'fixture', latest: true }),
    );
  });
});
