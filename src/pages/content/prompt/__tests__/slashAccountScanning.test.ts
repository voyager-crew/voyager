import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as accounts from '@/core/services/AccountIsolationService';

import { startPromptSlashCommand } from '../slashPrompt';
import { createTextarea, press, typeInto } from './slashPromptTestHarness';

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')!;
let destroy: (() => void) | undefined;

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  destroy?.();
  destroy = undefined;
  document.body.innerHTML = '';
  Object.defineProperty(window, 'location', originalLocation);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(['gemini.google.com', 'aistudio.google.com'])('slash account work on %s', (host) => {
  function start(template: boolean) {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: host, href: `https://${host}/u/0/app/first` },
    });
    const input = createTextarea('/fable');
    const account = document.createElement('button');
    account.className = 'account-switcher-text';
    account.dataset.email = 'first@example.com';
    document.body.append(account);
    destroy = startPromptSlashCommand({
      scheme: () => 'light',
      initialItems: [
        {
          id: 'f',
          name: 'Fable',
          text: template ? 'Write {{topic}}.' : 'Write a fable.',
          tags: [],
          createdAt: 1,
        },
      ],
    }).destroy;
    return { input, account };
  }

  async function streamReply(): Promise<void> {
    const response = document.createElement('article');
    document.body.append(response);
    response.textContent = 'A new sentence';
    response.className = 'streaming';
    response.setAttribute('aria-label', 'Assistant response');
    await flush();
    response.append(' follows.');
    response.style.opacity = '1';
    await flush();
  }

  it('idle slash commands do not rescan the account while replies stream with online fixes off', async () => {
    const { input, account } = start(false);
    await flush();
    const scan = vi.spyOn(accounts, 'detectAccountContextFromDocument');
    await streamReply();
    account.dataset.email = 'second@example.com';
    await flush();
    expect(scan).toHaveBeenCalledTimes(0);

    typeInto(input);
    expect(document.getElementById('gv-pm-slash-root')?.hidden).toBe(false);
    press(input, 'Enter');
    const sent: string[] = [];
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') sent.push(input.value.trim());
    });
    press(input, 'Enter');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(['Write a fable.']);
    scan.mockClear();
    await streamReply();
    account.dataset.email = 'third@example.com';
    await flush();
    expect(scan).toHaveBeenCalledTimes(0);
  });

  it('streaming beside an open template does no account scans but a changed account closes it', async () => {
    const { input, account } = start(true);
    typeInto(input);
    press(input, 'Enter');
    await flush();
    const scan = vi.spyOn(accounts, 'detectAccountContextFromDocument');
    await streamReply();
    expect(scan).toHaveBeenCalledTimes(0);
    expect(document.querySelector('.gv-pm-fill')).not.toBeNull();

    account.dataset.email = 'second@example.com';
    await flush();
    expect(document.querySelector('.gv-pm-fill')).toBeNull();
    expect(input.value).toBe('/Fable');

    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    typeInto(input);
    press(input, 'Enter');
    document.querySelector<HTMLElement>('.gv-pm-slot')!.textContent = 'the sea';
    document.querySelector<HTMLButtonElement>('.gv-pm-fill .gv-pm-save')!.click();
    press(input, 'Enter');
    await vi.advanceTimersByTimeAsync(0);
    expect(input.value.trim()).toBe('Write the sea.');
  });

  it.each(['cancel', 'submit'] as const)(
    'closing a template by %s stops account scans until the next pending operation',
    async (action) => {
      const { input, account } = start(true);
      typeInto(input);
      press(input, 'Enter');
      const slot = document.querySelector<HTMLElement>('.gv-pm-slot')!;
      slot.textContent = 'the sky';
      if (action === 'cancel') press(slot, 'Escape');
      else document.querySelector<HTMLButtonElement>('.gv-pm-fill .gv-pm-save')!.click();
      await flush();
      expect(input.value.trim()).toBe(action === 'submit' ? 'Fable' : '/Fable');
      const scan = vi.spyOn(accounts, 'detectAccountContextFromDocument');
      account.dataset.email = 'second@example.com';
      await streamReply();
      expect(scan).toHaveBeenCalledTimes(0);
      expect(document.querySelector('.gv-pm-fill')).toBeNull();
    },
  );
});
