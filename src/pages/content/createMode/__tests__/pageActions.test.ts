// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app/0123456789abcdef" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readComposer } from '@/core/services/composer';
import { isUserEvent } from '@/core/utils/userEvent';
import { createPageUrl } from '@/features/plugins/local/authoring/skillLink';
import { installNativeEditingMock } from '@/tests/nativeEditing';

import { startCreateMode } from '../index';
import { REPLY_CONTROL_CLASS } from '../replyControl';
import { RESCAN_DELAY_MS } from '../replyControls';

vi.mock('@/core/utils/userEvent', () => ({ isUserEvent: vi.fn(() => true) }));

const PLUGIN = {
  id: 'me.compact',
  name: 'Compact turns',
  version: '1.0.0',
  description: 'Tighter spacing between my messages',
  author: 'me',
  category: 'readability',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: ['https://gemini.google.com/*'],
  contributes: { styles: [{ css: '.gv-plugin-compact{margin-block:4px}' }] },
};

let stop: (() => void) | null = null;
let restoreEditing = () => {};
let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => void) | null;

function page(
  block: unknown,
  draft = '',
): { composer: HTMLElement; sendClicked: ReturnType<typeof vi.fn> } {
  document.body.innerHTML = `
    <main>
      <user-query><div class="query-text-line"></div></user-query>
      <model-response><message-content>
        <code-block><pre><code></code></pre></code-block>
      </message-content></model-response>
      <rich-textarea><div class="ql-editor" contenteditable="true"><p>${draft || '<br>'}</p></div></rich-textarea>
      <button class="send-button">Send</button>
    </main>`;
  document.querySelector('.query-text-line')!.textContent =
    `Read ${createPageUrl('gemini')} first. Make my turns compact.`;
  document.querySelector('code')!.textContent = JSON.stringify(block, null, 2);
  const sendClicked = vi.fn();
  document.querySelector('.send-button')!.addEventListener('click', sendClicked);
  return {
    composer: document.querySelector<HTMLElement>('[contenteditable="true"]')!,
    sendClicked,
  };
}

const ask = (message: unknown): unknown => {
  let reply: unknown;
  listener?.(message, {}, (value) => (reply = value));
  return reply;
};

async function pressControl(): Promise<void> {
  await vi.advanceTimersByTimeAsync(RESCAN_DELAY_MS + 10);
  const control = document.querySelector<HTMLElement>(`.${REPLY_CONTROL_CLASS}`);
  control?.shadowRoot?.querySelector('button')?.click();
}

describe('Create mode actions on a Gemini reply', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(isUserEvent).mockReturnValue(true);
    restoreEditing = installNativeEditingMock();
    vi.mocked(chrome.storage.local.get).mockResolvedValue({} as never);
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation((added) => {
      listener = added as typeof listener;
    });
  });

  afterEach(() => {
    stop?.();
    stop = null;
    listener = null;
    restoreEditing();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('hands the picked block to the panel once and opens it', async () => {
    page(PLUGIN);
    const openReview = vi.fn(() => true);
    stop = startCreateMode({
      find: () => document.querySelector('[contenteditable="true"]'),
      openReview,
    });
    await pressControl();

    expect(openReview).toHaveBeenCalledTimes(1);
    expect(ask({ type: 'gv.create.pending' })).toEqual({
      candidate: { text: JSON.stringify(PLUGIN, null, 2), siteId: 'gemini' },
    });
    expect(ask({ type: 'gv.create.pending' })).toEqual({ candidate: null });
  });

  it('appends the problems after a blank line below a draft, and sends nothing', async () => {
    const { composer, sendClicked } = page({ ...PLUGIN, name: '' }, 'my note');
    stop = startCreateMode({ find: () => composer, openReview: () => true });
    await pressControl();

    const text = readComposer(composer);
    expect(text).toMatch(/^my note\n\n+\S/);
    expect(text).toContain('Fix these problems');
    expect(text).toMatch(/\nname: /);
    expect(sendClicked).not.toHaveBeenCalled();
  });
});
