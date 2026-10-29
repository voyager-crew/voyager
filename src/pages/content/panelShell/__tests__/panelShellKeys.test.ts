/**
 * The keyboard and focus around the panel: ⌥V from a composer, IME, a host
 * that types into its composer on any key (ChatGPT), Esc on the host page,
 * outside presses, and the caret going back where it was.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PANEL_MESSAGE, PANEL_SHELL_MESSAGE } from '@/features/panel/protocol';

import {
  type ShellPage,
  bootstrapI18n,
  flush,
  hover,
  installShellPage,
  panel,
  postFromPanel,
  pressAltV,
  satellite,
  ball,
} from './shellHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
vi.mock('@/core/utils/userEvent', () => import('./forgedEvents'));

const CLAUDE = 'https://claude.ai/new';
const CHATGPT = 'https://chatgpt.com/';

let page: ShellPage;
const removeListeners: Array<() => void> = [];

beforeAll(bootstrapI18n);

afterEach(async () => {
  for (const remove of removeListeners.splice(0)) remove();
  await page.restore();
  vi.restoreAllMocks();
});

function listen(
  target: EventTarget,
  listener: (event: KeyboardEvent) => void,
  capture = false,
): void {
  target.addEventListener('keydown', listener as EventListener, capture);
  removeListeners.push(() =>
    target.removeEventListener('keydown', listener as EventListener, capture),
  );
}

function textareaComposer(): HTMLTextAreaElement {
  const composer = document.createElement('textarea');
  composer.value = 'Hello brave new world';
  document.body.appendChild(composer);
  composer.focus();
  composer.setSelectionRange(6, 15, 'backward');
  return composer;
}

/** The browser's part of a keydown nobody prevented: the key's character goes into the field. */
function typed(event: KeyboardEvent): void {
  const field = document.activeElement;
  if (event.defaultPrevented || !(field instanceof HTMLTextAreaElement) || event.key.length !== 1) {
    return;
  }
  field.setRangeText(event.key, field.selectionStart, field.selectionEnd, 'end');
}

function selectionOf(field: HTMLTextAreaElement): [number, number, string] {
  return [field.selectionStart, field.selectionEnd, field.selectionDirection];
}

function pressEscape(target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function pointerDown(target: EventTarget): void {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
}

describe('⌥V and the composer', () => {
  it('toggles the panel from a focused composer without typing into it, and gives the caret back', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    const composer = textareaComposer();

    typed(pressAltV(composer));
    await flush();

    expect(panel()).not.toBeNull();
    expect(document.activeElement).toBe(document.querySelector('.gv-ps-frame'));
    expect(composer.value).toBe('Hello brave new world');

    // The host moves the caret while the panel has focus.
    composer.setSelectionRange(0, 0);
    typed(pressAltV(document.body));
    await flush();

    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(composer);
    expect(composer.value).toBe('Hello brave new world');
    expect(selectionOf(composer)).toEqual([6, 15, 'backward']);
  });

  it('leaves ⌥V to the input method while it composes', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    const composer = textareaComposer();

    const event = pressAltV(composer, { isComposing: true });
    await flush();

    expect(event.defaultPrevented).toBe(false);
    expect(page.sentOfType(PANEL_MESSAGE.tokenIssue)).toEqual([]);
    expect(panel()).toBeNull();
  });

  it('keeps ⌥V from a host that focuses its composer and types any key pressed outside it (ChatGPT)', async () => {
    page = installShellPage(CHATGPT);
    const composer = document.createElement('div');
    composer.setAttribute('contenteditable', 'true');
    composer.tabIndex = 0;
    document.body.appendChild(composer);
    const heard: string[] = [];
    // ChatGPT default-prevents any printable key outside its composer, focuses it and inserts the key.
    const typeToFocus = (where: string) => (event: KeyboardEvent) => {
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey) return;
      heard.push(`${where}:${event.key}`);
      event.preventDefault();
      composer.focus();
      composer.textContent += event.key;
    };
    listen(window, typeToFocus('window'));
    listen(document, typeToFocus('document'));
    listen(document, typeToFocus('document-capture'), true);
    await page.start();

    pressAltV(document.body);
    await flush();

    expect(heard).toEqual([]);
    expect(composer.textContent).toBe('');
    expect(document.activeElement).not.toBe(composer);
    expect(panel()).not.toBeNull();

    // Any other key still reaches the host.
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }),
    );
    expect(heard).toEqual(['document-capture:a', 'document:a', 'window:a']);
  });
});

describe('closing and focus', () => {
  it('closes on Esc pressed on the host page and gives the caret back, then leaves Esc to the host', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    const composer = textareaComposer();
    const hostEscapes: string[] = [];
    listen(document, (event) => {
      if (event.key === 'Escape') hostEscapes.push('host');
    });

    pressAltV(composer);
    await flush();
    composer.setSelectionRange(0, 0);

    expect(pressEscape(document.body, { isComposing: true }).defaultPrevented).toBe(false);
    expect(panel()).not.toBeNull();
    const escape = pressEscape();
    await flush();

    expect(escape.defaultPrevented).toBe(true);
    expect(hostEscapes).toEqual(['host']);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(composer);
    expect(selectionOf(composer)).toEqual([6, 15, 'backward']);

    pressEscape();
    expect(hostEscapes).toEqual(['host', 'host']);
  });

  it('closes on a press outside the panel, but not on the panel itself or the shell toast', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    hover(ball());
    satellite('hide')!.click();
    await flush();
    pressAltV(document.body);
    await flush();
    const toast = document.querySelector<HTMLElement>('.gv-ps-toast')!;

    pointerDown(panel()!);
    pointerDown(toast.querySelector('.gv-ps-toast-undo')!);
    await flush();
    expect(panel()).not.toBeNull();

    const outside = document.createElement('p');
    document.body.appendChild(outside);
    pointerDown(outside);
    await flush();
    expect(panel()).toBeNull();
    expect(page.sentOfType(PANEL_MESSAGE.close)).toHaveLength(1);
  });

  it('puts the caret back on the panel page’s request and stays open', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    const composer = textareaComposer();
    pressAltV(composer);
    await flush();
    composer.setSelectionRange(0, 0);

    postFromPanel({ kind: PANEL_SHELL_MESSAGE.focusReturn });

    expect(document.activeElement).toBe(composer);
    expect(selectionOf(composer)).toEqual([6, 15, 'backward']);
    expect(panel()).not.toBeNull();
  });

  it('restores a contenteditable composer’s selection exactly when the panel page closes it', async () => {
    page = installShellPage(CLAUDE);
    await page.start();
    const composer = document.createElement('div');
    composer.setAttribute('contenteditable', 'true');
    composer.tabIndex = 0;
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(composer, 'isContentEditable', { value: true });
    composer.innerHTML = '<p>Hello <b>big</b> world</p>';
    document.body.appendChild(composer);
    const big = composer.querySelector('b')!.firstChild!;
    const world = composer.querySelector('p')!.lastChild!;
    composer.focus();
    document.getSelection()!.setBaseAndExtent(world, 3, big, 1);

    pressAltV(composer);
    await flush();
    document.getSelection()!.removeAllRanges();
    postFromPanel({ kind: PANEL_SHELL_MESSAGE.close });
    await flush();

    const selection = document.getSelection()!;
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(composer);
    expect([selection.anchorNode, selection.anchorOffset]).toEqual([world, 3]);
    expect([selection.focusNode, selection.focusOffset]).toEqual([big, 1]);
  });
});
