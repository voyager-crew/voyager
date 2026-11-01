import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { legacyBindingFor } from '@/features/plugins/storage/legacySettingBindings';

import { renderChangelogMarks } from '../changelogMarks';
import { createChangelogModal } from '../modal';
import { CHANGELOG_SWITCH_TARGETS } from '../switchTargets';

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

const QUOTE_REPLY = 'voyager.gemini-quote-reply';
const KEY = StorageKeys.QUOTE_REPLY_ENABLED;

/** Sync storage that keeps what is written and tells every listener, as the browser does. */
let store: Record<string, unknown>;
let listeners: Set<Listener>;

function emit(changes: Record<string, unknown>): void {
  const event = Object.fromEntries(
    Object.entries(changes).map(([key, newValue]) => [key, { newValue }]),
  );
  for (const listener of listeners) listener(event, 'sync');
}

beforeEach(() => {
  store = {};
  listeners = new Set();
  (chrome.storage.sync.get as unknown as Mock).mockImplementation(async (keys: string[]) =>
    Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]])),
  );
  (chrome.storage.sync.set as unknown as Mock).mockImplementation(
    async (items: Record<string, unknown>) => {
      Object.assign(store, items);
      emit(items);
    },
  );
  (chrome.storage.onChanged.addListener as unknown as Mock).mockImplementation((l: Listener) =>
    listeners.add(l),
  );
  (chrome.storage.onChanged.removeListener as unknown as Mock).mockImplementation((l: Listener) =>
    listeners.delete(l),
  );
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function render(html: string, mac = false) {
  const body = document.createElement('div');
  body.innerHTML = html;
  document.body.appendChild(body);
  const dispose = renderChangelogMarks(body, { mac, lang: 'zh', switchHint: 'hint' });
  return { body, dispose };
}

async function readSwitch(body: HTMLElement): Promise<HTMLButtonElement> {
  const control = body.querySelector<HTMLButtonElement>('[role="switch"]');
  if (!control) throw new Error('no switch');
  await vi.waitFor(() => expect(control.disabled).toBe(false));
  return control;
}

describe('changelog setting switch', () => {
  it('only lists targets whose switch is an existing setting the popup writes', () => {
    for (const id of Object.keys(CHANGELOG_SWITCH_TARGETS)) {
      expect(legacyBindingFor(id), id).not.toBeNull();
    }
  });

  it.each([
    [false, 'false'],
    [true, 'true'],
  ])('shows the stored value %s', async (stored, checked) => {
    store[KEY] = stored;
    const { body } = render(`<p>Try :switch:${QUOTE_REPLY}:</p>`);

    const control = await readSwitch(body);
    expect(control.getAttribute('aria-checked')).toBe(checked);
    expect(control.textContent).toBe('Gemini · 引用回复');
  });

  it('writes a click to the setting the feature reads', async () => {
    store[KEY] = false;
    const { body } = render(`<p>:switch:${QUOTE_REPLY}:</p>`);
    const control = await readSwitch(body);

    control.click();
    await vi.waitFor(() => expect(store[KEY]).toBe(true));
    expect(control.getAttribute('aria-checked')).toBe('true');
    expect(Object.keys(store)).toEqual([KEY]);

    control.click();
    await vi.waitFor(() => expect(store[KEY]).toBe(false));
  });

  it('puts the switch back when the write fails', async () => {
    store[KEY] = true;
    const { body } = render(`<p>:switch:${QUOTE_REPLY}:</p>`);
    const control = await readSwitch(body);
    (chrome.storage.sync.set as unknown as Mock).mockRejectedValueOnce(new Error('quota'));

    control.click();
    expect(control.getAttribute('aria-checked')).toBe('false');
    await vi.waitFor(() => expect(control.getAttribute('aria-checked')).toBe('true'));
  });

  it('follows a change made elsewhere until the viewer closes', async () => {
    store[KEY] = false;
    const overlay = await createChangelogModal(`<p>:switch:${QUOTE_REPLY}:</p>`, 'en');
    document.body.appendChild(overlay);
    const control = await readSwitch(overlay);

    emit({ [KEY]: true });
    expect(control.getAttribute('aria-checked')).toBe('true');

    overlay.querySelector<HTMLButtonElement>('.gv-changelog-got-it')!.click();
    expect(listeners.size).toBe(0);
  });

  it('renders an unlisted target as its id in plain text, never a control', () => {
    const { body } = render('<p>Turn on :switch:voyager.gemini-folders: now</p>');

    expect(body.querySelector('button')).toBeNull();
    expect(body.textContent).toBe('Turn on voyager.gemini-folders now');
    expect(listeners.size).toBe(0);
  });
});

describe('changelog shortcut caps', () => {
  it.each([
    [true, '⌥V'],
    [false, 'Alt+V'],
  ])('mac=%s shows %s in a kbd, and leaves code as written', (mac, label) => {
    const { body } = render('<p>Open with :kbd:Alt+V: or <code>:kbd:Alt+V:</code></p>', mac);

    expect(body.querySelector('kbd')?.textContent).toBe(label);
    expect(body.querySelector('code')?.textContent).toBe(':kbd:Alt+V:');
  });
});
