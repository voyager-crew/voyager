import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findGeminiSendButton } from '@/core/gemini/composer/send';
import { createSendKeyCoordinator } from '@/core/services/composer/sendKeys/sendKeyCoordinator';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';

const stops: Array<() => void> = [];

function mount(html: string): void {
  document.body.innerHTML = html;
  document.querySelectorAll<HTMLElement>('[contenteditable], textarea').forEach((field) => {
    field.getBoundingClientRect = () => ({ height: 20, width: 200 }) as DOMRect;
  });
  document.querySelectorAll<HTMLElement>('button, gem-button').forEach((button) => {
    Object.defineProperty(button, 'offsetParent', { configurable: true, value: document.body });
  });
}

function input(id = 'input'): HTMLElement {
  return document.getElementById(id)!;
}

function press(target: HTMLElement, modifiers: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  target.dispatchEvent(event);
  return event;
}

function listen(safari = false): void {
  const coordinator = createSendKeyCoordinator('gemini', { isSafari: () => safari });
  if (safari) coordinator.registerSafariFallback({ source: 'test' });
  else coordinator.registerMainMode({ source: 'test', mode: 'ctrlEnterSends' });
  stops.push(() => coordinator.stop());
}

async function online(containers: string[]): Promise<void> {
  stops.push(await installGeminiSelectorPatch({ 'composer.sendContainers': containers }));
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn(() => true),
  });
  vi.stubGlobal('requestAnimationFrame', () => 0);
});

afterEach(() => {
  stops
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('online Gemini send owners', () => {
  it.each([
    ['a model response', '<model-response id="excluded"></model-response>'],
    ['a user query', '<user-query id="excluded"></user-query>'],
    ['a dialog', '<dialog id="excluded" open></dialog>'],
    ['a message', '<div id="excluded" data-message-author-role="assistant"></div>'],
    ['a plugin panel', '<div id="excluded" data-gv-plugin="test"></div>'],
    ['Voyager UI', '<div id="excluded" class="panel gv-test-panel"></div>'],
  ])('Ctrl+Enter in an editor inside %s does not click its Run button', async (_name, wrapper) => {
    mount(
      `${wrapper}<div class="new-composer"><textarea id="input">code</textarea><button aria-label="Run">Run</button></div>`,
    );
    const owner = document.querySelector<HTMLElement>('.new-composer')!;
    document.getElementById('excluded')!.append(owner);
    const click = vi.spyOn(owner.querySelector('button')!, 'click');
    await online(['.new-composer']);
    listen();
    expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(click).not.toHaveBeenCalled();
    expect((input() as HTMLTextAreaElement).value).toBe('code');
    document.body.append(owner);
    expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });

  it.each(['hidden', 'readonly', 'style="visibility: hidden"'])(
    'Ctrl+Enter in an unavailable editor (%s) does not run a renamed owner’s action',
    async (attribute) => {
      mount(
        `<div class="new-composer"><textarea id="input" ${attribute}>code</textarea><button aria-label="Run">Run</button></div>`,
      );
      const click = vi.spyOn(document.querySelector('button')!, 'click');
      await online(['.new-composer']);
      listen();
      expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(click).not.toHaveBeenCalled();
      input().removeAttribute(attribute.split('=')[0]);
      expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(true);
      expect(click).toHaveBeenCalledOnce();
    },
  );

  it.each(['layout', 'hidden', 'collapse'])(
    'Ctrl+Enter waits for one visible Send action when another is concealed by %s',
    async (visibility) => {
      mount(
        '<div class="new-composer"><div id="input" contenteditable="true">draft</div><button aria-label="Send">Send</button><button aria-label="Submit">Submit</button></div>',
      );
      const [send, submit] = Array.from(document.querySelectorAll('button'));
      const click = vi.spyOn(send, 'click');
      const otherClick = vi.spyOn(submit, 'click');
      await online(['.new-composer']);
      listen();
      expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(click).not.toHaveBeenCalled();
      expect(otherClick).not.toHaveBeenCalled();
      if (visibility === 'layout')
        Object.defineProperty(submit, 'offsetParent', { configurable: true, value: null });
      else submit.style.visibility = visibility;
      expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(true);
      expect(click).toHaveBeenCalledOnce();
      expect(otherClick).not.toHaveBeenCalled();
    },
  );

  it('keeps main, old-message edit and dialog keyboard behavior identical on the same DOM', async () => {
    mount(`
      <div id="main" class="text-input-field"><div id="input" contenteditable="true">main draft</div><button aria-label="Send message">Send</button></div>
      <div id="edit" class="user-query-container edit-mode"><div class="edit-container"><div id="old" contenteditable="true">old draft</div></div><button class="update-button">Update</button></div>
      <div id="dialog" role="dialog"><textarea id="modal">dialog draft</textarea><button aria-label="Send">Send</button></div>
    `);
    const sent: string[] = [];
    document.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => sent.push(button.parentElement!.id));
    });
    const exercise = (): boolean[] => {
      listen();
      const results: boolean[] = [];
      for (const target of [input(), input('old'), input('modal')]) {
        results.push(press(target, { ctrlKey: true }).defaultPrevented);
        results.push(press(target, { metaKey: true, shiftKey: true }).defaultPrevented);
        results.push(press(target, { shiftKey: true }).defaultPrevented);
        results.push(press(target, { isComposing: true, ctrlKey: true }).defaultPrevented);
        results.push(press(target, { keyCode: 229, ctrlKey: true }).defaultPrevented);
        results.push(press(target, { altKey: true }).defaultPrevented);
        results.push(press(target).defaultPrevented);
      }
      stops.pop()!();
      return results;
    };
    const bundled = exercise();
    const bundledSent = sent.splice(0);
    await online(['#main', '#edit', '#dialog']);
    expect(exercise()).toEqual(bundled);
    expect(sent).toEqual(bundledSent);
    expect(sent).toEqual(['main', 'main', 'edit', 'edit', 'dialog', 'dialog']);
    expect(input().textContent).toBe('main draft');
    expect(input('old').textContent).toBe('old draft');
  });

  it('repairs a renamed owner while preserving Safari Enter, Stop and upload guards', async () => {
    mount(
      '<div class="new-composer"><div id="input" contenteditable="true">draft</div><button aria-label="Send message">Send</button></div>',
    );
    const button = document.querySelector('button')!;
    const click = vi.spyOn(button, 'click');
    listen(true);
    expect(press(input()).defaultPrevented).toBe(false);
    await online(['.new-composer']);
    expect(press(input()).defaultPrevented).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    button.classList.add('stop');
    button.setAttribute('aria-label', 'Stop response');
    expect(press(input()).defaultPrevented).toBe(false);
    button.classList.remove('stop');
    button.setAttribute('aria-label', 'Send message');
    button.parentElement!.insertAdjacentHTML('beforeend', '<div role="progressbar"></div>');
    expect(press(input()).defaultPrevented).toBe(false);
    button.parentElement!.querySelector('[role="progressbar"]')!.remove();
    expect(press(input()).defaultPrevented).toBe(true);
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('a remote outer owner cannot send an old-message update from the main draft', async () => {
    mount(
      `<div id="workspace"><button class="update-button">Update</button><div class="text-input-field"><div id="input" contenteditable="true">main draft</div><button aria-label="Send">Send</button></div></div>`,
    );
    const update = vi.spyOn(document.querySelector('.update-button') as HTMLButtonElement, 'click');
    const send = vi.spyOn(
      document.querySelector('[aria-label="Send"]') as HTMLButtonElement,
      'click',
    );
    await online(['#workspace']);
    listen();
    expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
    expect(input().textContent).toBe('main draft');
  });

  it('a remote inner owner cannot hide an upload in the bundled composer', async () => {
    mount(
      '<div class="text-input-field"><progress></progress><div class="inner"><div id="input" contenteditable="true">draft</div><button aria-label="Send">Send</button></div></div>',
    );
    const click = vi.spyOn(document.querySelector('button')!, 'click');
    await online(['.inner']);
    listen();
    expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(false);
    document.querySelector('progress')!.remove();
    expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });

  it('a renamed inner owner cannot leave an uploading attachment outside its read', async () => {
    mount(
      '<div class="renamed-shell"><progress></progress><div class="new-composer"><div id="input" contenteditable="true">draft</div><button aria-label="Send">Send</button></div></div>',
    );
    const click = vi.spyOn(document.querySelector('button')!, 'click');
    await online(['.new-composer']);
    listen();
    expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(false);
    document.querySelector('progress')!.remove();
    expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });

  it('an incomplete remote owner list still sends the old-message update and the main draft separately', async () => {
    mount(
      '<div class="text-input-field"><div id="input" contenteditable="true">main draft</div><button aria-label="Send">Send</button></div><div class="user-query-container edit-mode"><textarea id="old">old draft</textarea><button class="update-button">Update</button></div>',
    );
    const send = vi.spyOn(
      document.querySelector<HTMLButtonElement>('[aria-label="Send"]')!,
      'click',
    );
    const update = vi.spyOn(document.querySelector<HTMLButtonElement>('.update-button')!, 'click');
    await online(['.text-input-field']);
    listen();
    expect(press(input('old'), { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(update).toHaveBeenCalledOnce();
    expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(input('old').textContent).toBe('old draft');
    expect(input().textContent).toBe('main draft');
  });

  it('the bundled path keeps its original multi-input owner routing without remote checks', () => {
    mount(
      '<div class="text-input-field"><div id="input" contenteditable="true">main draft</div><textarea id="other">another draft</textarea><button aria-label="Send">Send</button></div>',
    );
    const click = vi.spyOn(document.querySelector('button')!, 'click');
    listen();
    expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press(input('other'), { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('a renamed owner with two inputs cannot borrow the other input’s button', async () => {
    mount(
      '<div class="new-composer"><div id="input" contenteditable="true">first draft</div><textarea id="other">second draft</textarea><button aria-label="Send">Send</button></div>',
    );
    const click = vi.spyOn(document.querySelector('button')!, 'click');
    await online(['.new-composer']);
    listen();
    expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(false);
    input('other').remove();
    expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });

  it.each(['Stop response', 'Save', 'Confirm', 'Update', 'disabled Send'])(
    'a renamed %s owner cannot borrow an unrelated outer Send',
    async (label) => {
      mount(
        `<div id="outer"><div class="renamed-inner"><div id="input" contenteditable="true">retained draft</div><button id="actual" aria-label="${label}">${label}</button></div><button id="unrelated" aria-label="Send message">Send</button></div>`,
      );
      const field = input();
      const actual = document.getElementById('actual') as HTMLButtonElement;
      if (label === 'disabled Send') actual.disabled = true;
      const actualClick = vi.spyOn(actual, 'click');
      const otherClick = vi.spyOn(
        document.getElementById('unrelated') as HTMLButtonElement,
        'click',
      );
      await online(['#outer']);
      listen();
      expect(press(field, { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(field.textContent).toBe('retained draft');
      // The same remote owner becomes usable once it really owns the input's available Send.
      document.getElementById('outer')!.replaceChildren(field, actual);
      actual.disabled = false;
      actual.setAttribute('aria-label', 'Send message');
      actual.textContent = 'Send';
      expect(press(field, { ctrlKey: true }).defaultPrevented).toBe(true);
      expect(actualClick).toHaveBeenCalledOnce();
      expect(otherClick).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['Save', ''],
    ['Confirm', ''],
    ['Update', ''],
    ['Archive', ''],
    ['Save', '<mat-icon fonticon="send"></mat-icon>'],
  ])(
    'a renamed notes editor with %s cannot turn Ctrl+Enter into an unrelated action (%s)',
    async (label, icon) => {
      mount(
        `<div class="new-composer"><div id="input" contenteditable="true">private notes</div><button class="send-button" aria-label="${label}">${icon}</button></div>`,
      );
      const button = document.querySelector('button')!;
      const click = vi.spyOn(button, 'click');
      await online(['.new-composer']);
      listen();
      expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(input().textContent).toBe('private notes');
      button.setAttribute('aria-label', 'Send message');
      expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(true);
      expect(click).toHaveBeenCalledOnce();
    },
  );

  it('a locator-only decoy cannot replace the native send button of a renamed owner', async () => {
    mount(
      '<div class="new-composer"><div id="input" contenteditable="true">draft</div><button id="decoy" aria-label="Runtime settings">Unrelated</button><button aria-label="发送消息">发送</button></div>',
    );
    const decoy = document.querySelector<HTMLButtonElement>('#decoy')!;
    const decoyClick = vi.spyOn(decoy, 'click');
    const sendClick = vi.spyOn(
      document.querySelector<HTMLButtonElement>('[aria-label="发送消息"]')!,
      'click',
    );
    await online(['.new-composer']);
    listen();
    expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(false);
    decoy.remove();
    expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(sendClick).toHaveBeenCalledOnce();
    expect(decoyClick).not.toHaveBeenCalled();
  });

  it('a remote ancestor cannot replace the closest native owner of a renamed composer', async () => {
    mount(
      '<div class="new-composer"><div class="native-owner"><div id="input" contenteditable="true">draft</div><button aria-label="Send">Send</button></div></div>',
    );
    const click = vi.spyOn(document.querySelector('button')!, 'click');
    await online(['.new-composer']);
    listen();
    expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(false);
    const inner = document.querySelector('.native-owner')!;
    inner.replaceWith(...inner.childNodes);
    expect(press(input(), { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });

  it('a detached renamed composer cannot provide a send control', async () => {
    mount(
      '<div class="new-composer"><div id="input" contenteditable="true">draft</div><button aria-label="Send">Send</button></div>',
    );
    await online(['.new-composer']);
    const field = input();
    const owner = field.parentElement!;
    const button = owner.querySelector('button')!;
    owner.remove();
    expect(findGeminiSendButton(field)).toBeNull();
    document.body.append(owner);
    expect(findGeminiSendButton(field)).toBe(button);
  });
});
