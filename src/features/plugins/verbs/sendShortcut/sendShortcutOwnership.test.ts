// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import { sendShortcutPrimitive } from './index';

const scopes: PluginScope[] = [];
const stopProfiles: Array<() => void> = [];
afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose();
  stopProfiles.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function activate(site: string, overrides: Record<string, string> = {}) {
  const scope = new PluginScope();
  scopes.push(scope);
  const adapter = requireBundledSiteAdapter(site);
  const selectors = {
    ...adapter.selectors,
    composer: '.remote-input',
    composerRoot: '.replacement',
    sendButton: '.remote-send',
    ...overrides,
  };
  const run = initializeSiteSelectors(site, {
    host: site === 'chatgpt' ? 'chatgpt.com' : site === 'kimi' ? 'www.kimi.com' : 'claude.ai',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({ id: site, catalogRevision: 1, selectors }),
  });
  stopProfiles.push(run.stop);
  await run.ready;
  void sendShortcutPrimitive.activate(
    scope,
    {},
    {
      doc: document,
      adapter,
      pluginId: 'test.send',
      settings: {},
      setTargetCounter: () => {},
    },
  );
}
function showField(): HTMLElement {
  const field = document.querySelector<HTMLElement>('.remote-input')!;
  field.getBoundingClientRect = () => ({ width: 300, height: 40 }) as DOMRect;
  return field;
}
function enter(field: HTMLElement, ctrlKey = true): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    ctrlKey,
    bubbles: true,
    cancelable: true,
  });
  field.dispatchEvent(event);
  return event;
}

it('an editor inside a Claude answer cannot become the main send unit through online data', async () => {
  document.body.innerHTML =
    '<section class="font-claude-message"><div data-composer-card-holder><div class="replacement"><div class="remote-input" contenteditable="true">reply text</div><button type="button" class="remote-send">Send</button></div></div></section>';
  const field = showField();
  const clicks = vi.fn();
  document.querySelector('.remote-send')!.addEventListener('click', clicks);
  await activate('claude');
  enter(field);
  expect(clicks).not.toHaveBeenCalled();
  expect(field.textContent).toBe('reply text');
  document.body.appendChild(document.querySelector('[data-composer-card-holder]')!);
  enter(field);
  expect(clicks).toHaveBeenCalledTimes(1);
});

it('a profile bio and Submit control are refused until native main-composer ownership is present', async () => {
  document.body.innerHTML =
    '<form class="replacement"><div class="remote-input" contenteditable="true">bio</div><button type="submit" class="remote-send">Submit</button></form>';
  const field = showField();
  const clicks = vi.fn((event: Event) => event.preventDefault());
  document.querySelector('.remote-send')!.addEventListener('click', clicks);
  await activate('chatgpt');
  enter(field);
  expect(clicks).not.toHaveBeenCalled();
  expect(field.textContent).toBe('bio');
  document.querySelector('form')!.setAttribute('data-chatgpt-composer', '');
  enter(field);
  expect(clicks).toHaveBeenCalledTimes(1);
});

it('a repaired composer still makes ordinary Enter a newline and Ctrl+Enter one send', async () => {
  document.body.innerHTML =
    '<form data-chatgpt-composer class="replacement"><div class="remote-input" contenteditable="true">draft</div><button type="submit" class="remote-send">Send</button></form>';
  const field = showField();
  const clicks = vi.fn((event: Event) => event.preventDefault());
  document.querySelector('.remote-send')!.addEventListener('click', clicks);
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.shiftKey) field.textContent += '\n';
  });
  await activate('chatgpt');
  expect(enter(field, false).defaultPrevented).toBe(true);
  expect(field.textContent).toBe('draft\n');
  expect(clicks).not.toHaveBeenCalled();
  expect(enter(field).defaultPrevented).toBe(true);
  expect(clicks).toHaveBeenCalledTimes(1);
});

it('an online send control cannot submit a different form through a form attribute', async () => {
  document.body.innerHTML =
    '<form data-chatgpt-composer class="replacement"><div class="remote-input" contenteditable="true">draft</div><button type="submit" form="profile" class="remote-send">Send</button></form><form id="profile"><input name="bio" value="profile text"></form>';
  const field = showField();
  const button = document.querySelector<HTMLButtonElement>('.remote-send')!;
  const clicks = vi.fn((event: Event) => event.preventDefault());
  button.addEventListener('click', clicks);
  await activate('chatgpt');
  enter(field);
  expect(clicks).not.toHaveBeenCalled();
  expect((document.querySelector('#profile input') as HTMLInputElement).value).toBe('profile text');
  button.removeAttribute('form');
  enter(field);
  expect(clicks).toHaveBeenCalledTimes(1);
});

it('a wrong online button keeps the exact bundled send control', async () => {
  document.body.innerHTML =
    '<form data-chatgpt-composer class="replacement"><div data-composer-markdown class="remote-input" contenteditable="true">draft</div><button type="submit" id="real">Send</button><button type="button" class="remote-send">Tools</button></form>';
  const field = showField();
  const real = vi.fn((event: Event) => event.preventDefault());
  const wrong = vi.fn();
  document.getElementById('real')!.addEventListener('click', real);
  document.querySelector('.remote-send')!.addEventListener('click', wrong);
  await activate('chatgpt');
  enter(field);
  expect(real).toHaveBeenCalledTimes(1);
  expect(wrong).not.toHaveBeenCalled();
});

it('a broad online owner cannot borrow a neighboring draft’s send', async () => {
  document.body.innerHTML =
    '<form data-chatgpt-composer class="replacement"><div data-composer-markdown class="remote-input" contenteditable="true">draft</div><button type="submit" id="real">Send</button></form><form><textarea>neighbor</textarea><button type="submit" class="remote-send">Send</button></form>';
  const field = showField();
  const real = vi.fn((event: Event) => event.preventDefault());
  const wrong = vi.fn((event: Event) => event.preventDefault());
  document.getElementById('real')!.addEventListener('click', real);
  document.querySelector('.remote-send')!.addEventListener('click', wrong);
  await activate('chatgpt', { composerRoot: 'body' });
  enter(field);
  expect(real).toHaveBeenCalledTimes(1);
  expect(wrong).not.toHaveBeenCalled();
});

it('Kimi repairs only its composer and keeps its installed bare-div send control', async () => {
  document.body.innerHTML =
    '<div class="chat-editor-content"><div class="remote-input" contenteditable="true">draft</div><div class="send-button-container">Send</div></div>';
  const field = showField();
  const click = vi.fn();
  document.querySelector('.send-button-container')!.addEventListener('click', click);
  await activate('kimi');
  expect(enter(field).defaultPrevented).toBe(true);
  expect(click).toHaveBeenCalledTimes(1);
  expect(field.textContent).toBe('draft');
});

it('ON without an accepted snapshot cannot redirect a send through the cached adapter', async () => {
  const run = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    read: async () => null,
  });
  stopProfiles.push(run.stop);
  await run.ready;
  document.body.innerHTML =
    '<form data-chatgpt-composer><div data-composer-markdown class="remote-input" contenteditable="true">draft</div><button type="submit" id="real">Send</button></form><form><textarea>profile</textarea><button type="submit" class="remote-send">Submit</button></form>';
  const field = showField();
  const real = vi.fn((event: Event) => event.preventDefault());
  const wrong = vi.fn((event: Event) => event.preventDefault());
  document.getElementById('real')!.addEventListener('click', real);
  document.querySelector('.remote-send')!.addEventListener('click', wrong);
  const adapter = requireBundledSiteAdapter('chatgpt');
  const scope = new PluginScope();
  scopes.push(scope);
  void sendShortcutPrimitive.activate(
    scope,
    {},
    {
      doc: document,
      adapter: {
        ...adapter,
        selectors: { ...adapter.selectors, composerRoot: 'body', sendButton: '.remote-send' },
      },
      pluginId: 'cached',
      settings: {},
      setTargetCounter: () => {},
    },
  );
  enter(field);
  expect(real).toHaveBeenCalledTimes(1);
  expect(wrong).not.toHaveBeenCalled();
});
