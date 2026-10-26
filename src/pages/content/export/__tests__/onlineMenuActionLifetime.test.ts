// @vitest-environment-options {"url":"https://gemini.google.com/app/first"}
import { afterEach, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import {
  injectConversationMenuExportButton,
  injectConversationMenuMoveToFolderButton,
} from '../conversationMenuInjection';

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  document.body.innerHTML = '';
  document.body.removeAttribute('data-streaming');
  vi.restoreAllMocks();
});

const actions = [
  ['export', injectConversationMenuExportButton],
  ['move', injectConversationMenuMoveToFolderButton],
] as const;

async function mount() {
  document.body.innerHTML = `
    <nav data-test-id="overflow-container">
      <div data-test-id="conversation" id="first"><a href="/app/first">First</a></div>
      <div data-test-id="conversation" id="second"><a href="/app/second">Second</a></div>
      <div><button data-test-id="actions-menu-button" aria-haspopup="menu"
        aria-expanded="true" aria-controls="menu"></button></div>
    </nav>
    <div id="menu" role="menu" class="new-panel"><div class="new-content">
      <gem-menu-item data-test-id="pin-button"><mat-icon fonticon="keep"></mat-icon>
        <span class="label-container"><span class="label">Pin</span></span>
      </gem-menu-item>
    </div></div>`;
  cleanups.push(
    await installGeminiSelectorPatch({
      'menu.panels': ['.new-panel'],
      'menu.content': ['.new-content'],
    }),
  );
  return {
    panel: document.querySelector<HTMLElement>('#menu')!,
    trigger: document.querySelector<HTMLElement>('[aria-haspopup]')!,
    first: document.querySelector<HTMLElement>('#first')!,
    second: document.querySelector<HTMLElement>('#second')!,
  };
}

it.each(actions)(
  'keeps %s working after unrelated streaming attributes change during a sidebar repaint',
  async (_name, inject) => {
    const { panel, first, second } = await mount();
    const response = document.createElement('model-response');
    document.body.append(response);
    let repainting = false;
    vi.spyOn(first, 'getBoundingClientRect').mockImplementation(() => ({
      ...new DOMRect(),
      top: repainting ? 50 : 0,
      height: 10,
    }));
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({
      ...new DOMRect(),
      top: 20,
      height: 10,
    });
    const onClick = vi.fn();
    const button = inject(panel, { label: 'Action', tooltip: 'Action', onClick })!;
    expect(button.isConnected).toBe(true);
    await Promise.resolve();
    const documentReads = vi.spyOn(document, 'querySelectorAll');

    // Streaming paints may temporarily move neighboring rows without changing either chat.
    repainting = true;
    document.body.setAttribute('data-streaming', 'true');
    response.setAttribute('aria-label', 'Streaming');
    await Promise.resolve();
    repainting = false;
    document.body.setAttribute('data-streaming', 'false');
    await Promise.resolve();
    expect(documentReads).not.toHaveBeenCalled();

    button.click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(documentReads).toHaveBeenCalled();
    expect(panel.isConnected).toBe(false);
  },
);

it.each(['account label', 'account removal', 'route'] as const)(
  'removes visible actions after the %s changes and permits the new scope',
  async (reason) => {
    const { panel } = await mount();
    const account = document.createElement('a');
    account.href = 'https://accounts.google.com';
    account.setAttribute('aria-label', 'Google Account: first@example.com');
    document.body.prepend(account);
    const oldClick = vi.fn();
    const old = injectConversationMenuExportButton(panel, {
      label: 'Old',
      tooltip: 'Old',
      onClick: oldClick,
    })!;
    expect(old.isConnected).toBe(true);
    if (reason === 'account label')
      account.setAttribute('aria-label', 'Google Account: second@example.com');
    else if (reason === 'account removal') account.remove();
    else {
      const href = window.location.href;
      cleanups.push(() => window.history.replaceState({}, '', href));
      window.history.replaceState({}, '', '/u/1/app/other');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    await Promise.resolve();
    expect(old.isConnected).toBe(false);
    old.click();
    expect(oldClick).not.toHaveBeenCalled();

    const onClick = vi.fn();
    const fresh = injectConversationMenuExportButton(panel, {
      label: 'Fresh',
      tooltip: 'Fresh',
      onClick,
    })!;
    fresh.click();
    expect(onClick).toHaveBeenCalledOnce();
  },
);

it.each(actions)(
  'removes cancelled %s buttons from an open menu and permits a fresh action',
  async (_name, inject) => {
    const { panel, trigger } = await mount();
    const cancelledClick = vi.fn();
    const old = inject(panel, { label: 'Old', tooltip: 'Old', onClick: cancelledClick })!;
    expect(old.isConnected).toBe(true);
    trigger.setAttribute('aria-expanded', 'false');
    await Promise.resolve();
    expect(old.isConnected).toBe(false);
    expect(panel.isConnected).toBe(true);
    expect(panel.querySelector('[data-test-id="pin-button"]')?.textContent).toContain('Pin');
    old.click();
    expect(cancelledClick).not.toHaveBeenCalled();

    trigger.setAttribute('aria-expanded', 'true');
    const onClick = vi.fn();
    const fresh = inject(panel, { label: 'Fresh', tooltip: 'Fresh', onClick })!;
    expect(fresh).not.toBe(old);
    fresh.click();
    expect(onClick).toHaveBeenCalledOnce();
  },
);
