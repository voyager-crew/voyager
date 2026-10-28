import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import type { HighlightRecordV1 } from '@/core/types/highlight';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';
import { loadTranslations } from '@/utils/translations';

import { Library } from '../Library';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return chrome.storage;
    },
    get i18n() {
      return chrome.i18n;
    },
    get runtime() {
      return chrome.runtime;
    },
  },
}));

let root: Root;
let container: HTMLDivElement;
let stars: StarredMessage[];
let highlights: HighlightRecordV1[];
let highlightReadFails: boolean;
let deleteFails: boolean;
let language: string;
let dark: boolean;
let schemeChanged: (() => void) | undefined;
let listeners: Set<Parameters<typeof chrome.storage.onChanged.addListener>[0]>;
const originalRuntimeSend = chrome.runtime.sendMessage;

function star(overrides: Partial<StarredMessage> = {}): StarredMessage {
  return {
    conversationId: 'gemini:conv:one',
    conversationUrl: 'https://gemini.google.com/app/one',
    conversationTitle: 'Research conversation',
    turnId: 'turn-1',
    content: 'Stored preview only\nSecond preview line',
    starredAt: 20,
    account: 'opaque-star-account',
    ...overrides,
  };
}

function highlight(overrides: Partial<HighlightRecordV1> = {}): HighlightRecordV1 {
  return {
    id: 'highlight-one',
    schemaVersion: 1,
    platform: 'gemini',
    accountHash: 'opaque-highlight-account',
    conversationId: 'one',
    conversationUrl: 'https://gemini.google.com/app/one',
    conversationTitle: 'Research conversation',
    turnId: 'response-1',
    role: 'assistant',
    anchor: {
      quote: { exact: 'A saved quotation', prefix: '', suffix: '' },
      position: { start: 0, end: 17 },
      sourceTextHash: 'hash',
    },
    note: 'Annotation note',
    color: 'yellow',
    createdAt: 10,
    updatedAt: 30,
    revision: { counter: 1, deviceId: 'device' },
    ...overrides,
  };
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      <LanguageProvider>
        <Library />
      </LanguageProvider>,
    );
  });
}

function buttons(label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).filter(
    (button) => button.textContent?.trim() === label || button.getAttribute('aria-label') === label,
  );
}

async function choose(id: string, value: string): Promise<void> {
  await act(async () => {
    const select = container.querySelector<HTMLSelectElement>(`#${id}`)!;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function query(value: string): Promise<void> {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('#library-search')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function answerConfirmation(label: string): Promise<void> {
  const host = document.querySelector<HTMLElement>('[data-gv-layer="popover"]')!;
  const button = Array.from(host.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent === label,
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom omits CSS.escape; the browser boundary escapes our quoted attribute values.
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/["\\]/g, '\\$&') });
  stars = [star()];
  highlights = [highlight()];
  highlightReadFails = false;
  deleteFails = false;
  language = 'en';
  dark = false;
  listeners = new Set();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return dark;
      },
      addEventListener: vi.fn((_event: string, callback: () => void) => {
        schemeChanged = callback;
      }),
      removeEventListener: vi.fn(),
    })),
  );
  vi.mocked(chrome.storage.sync.get).mockImplementation(async () => ({
    [StorageKeys.LANGUAGE]: language,
  }));
  vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({}));
  vi.mocked(chrome.storage.onChanged.addListener).mockImplementation((listener) => {
    listeners.add(listener);
  });
  vi.mocked(chrome.storage.onChanged.removeListener).mockImplementation((listener) => {
    listeners.delete(listener);
  });
  chrome.runtime.sendMessage = vi.fn(
    (
      message: { type: string; payload?: Record<string, unknown> },
      callback?: (value: unknown) => void,
    ) => {
      if (message.type === 'gv.starred.getAll') {
        const messages: Record<string, StarredMessage[]> = {};
        for (const item of stars) (messages[item.conversationId] ??= []).push(item);
        const result = { ok: true, data: { messages } };
        callback?.(result);
        return Promise.resolve(result);
      }
      if (message.type === 'gv.highlight.listAll') {
        return highlightReadFails
          ? Promise.reject(new Error('Unavailable'))
          : Promise.resolve({ ok: true, records: highlights });
      }
      if (message.type === 'gv.starred.remove') {
        const result = { ok: !deleteFails };
        if (!deleteFails) stars = stars.filter((item) => item.turnId !== message.payload?.turnId);
        callback?.(result);
        return Promise.resolve(result);
      }
      if (message.type === 'gv.highlight.deleteStored') {
        if (!deleteFails) highlights = highlights.filter((item) => item.id !== message.payload?.id);
        return Promise.resolve({ ok: !deleteFails });
      }
      throw new Error(`Unexpected message ${message.type}`);
    },
  ) as unknown as typeof chrome.runtime.sendMessage;
  vi.mocked(chrome.tabs.create).mockImplementation(async () => ({}) as chrome.tabs.Tab);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  chrome.runtime.sendMessage = originalRuntimeSend;
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.gvScheme;
  document.documentElement.dir = '';
  document.documentElement.lang = '';
  document.body.classList.remove('gv-rtl');
  document.title = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Saved Library page', () => {
  it('full starred prompts expand independently and search finds words beyond the preview', async () => {
    const text = `First user line\nSecond line with QUASAR and <em>plain text</em>\n${'x'.repeat(200)}`;
    stars = [
      star({ content: 'First user line', text }),
      star({ turnId: 'turn-2', content: 'Another preview', text: 'Another preview\nMore details' }),
      star({ turnId: 'legacy', content: 'Legacy preview' }),
      star({ turnId: 'short', content: 'Short prompt', text: 'Short prompt' }),
    ];
    await mount();
    vi.mocked(chrome.tabs.create).mockClear();
    const toggles = [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];
    expect(toggles).toHaveLength(2);
    const full = document.getElementById(toggles[0].getAttribute('aria-controls')!)!;
    const other = document.getElementById(toggles[1].getAttribute('aria-controls')!)!;
    expect(full.textContent).toBe('First user line');
    expect(other.textContent).toBe('Another preview');
    expect(toggles[0].getAttribute('aria-expanded')).toBe('false');
    expect(toggles[0].textContent).toBe('Show full text');
    await act(async () => toggles[0].click());
    expect(full.textContent).toBe(text);
    expect(
      full.closest('[data-library-item-id]')?.textContent?.match(/First user line/g),
    ).toHaveLength(1);
    expect(full.querySelector('em')).toBeNull();
    expect(toggles[0].getAttribute('aria-expanded')).toBe('true');
    expect(toggles[0].textContent).toBe('Collapse text');
    expect(other.textContent).toBe('Another preview');
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(container.querySelector('button button')).toBeNull();
    await act(async () => toggles[0].click());
    expect(full.textContent).toBe('First user line');
    await query('  quasar  ');
    expect(container.querySelectorAll('[data-library-item-id]')).toHaveLength(1);
    expect(container.querySelector('[data-library-open]')?.textContent).toContain(
      'First user line',
    );
    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-expanded]')
        ?.getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('shows stored previews and notes across sites without inventing full conversation text', async () => {
    stars.push(
      star({
        conversationId: 'claude:conv:two',
        conversationUrl: 'https://claude.ai/chat/two',
        conversationTitle: 'Claude conversation',
        turnId: 'turn-2',
        content: 'Claude saved preview',
        starredAt: 40,
        account: undefined,
      }),
    );
    await mount();
    expect(container.textContent).toContain('Stored preview only');
    expect(container.textContent).toContain('Second preview line');
    expect(container.textContent).toContain('Annotation note');
    expect(container.textContent).toContain('Claude saved preview');
    expect(container.querySelector('button[aria-expanded]')).toBeNull();
    expect(container.querySelectorAll('section')).toHaveLength(3);
    const groupLabels = Array.from(container.querySelectorAll('section p')).map(
      (label) => label.textContent,
    );
    expect(groupLabels).toContain('Gemini·Account 1');
    expect(groupLabels).toContain('Gemini·Account 2');
    expect(groupLabels).toContain('Claude');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'gv.highlight.listAll',
      payload: { includeDeleted: false },
    });
    expect(container.querySelector('button button')).toBeNull();
    expect(container.querySelector('aside')?.getAttribute('aria-label')).toBe('Library filters');
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Saved item type',
    );
    for (const input of container.querySelectorAll('input, select')) {
      expect(container.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    }
  });

  it('combines native-site account, kind and search filters without conflating star keys and highlight hashes', async () => {
    await mount();
    await choose('library-site', 'gemini');
    const options = Array.from(
      container.querySelectorAll<HTMLOptionElement>('#library-account option'),
    );
    expect(options.map((option) => option.textContent)).toEqual([
      'All accounts',
      'Account 1',
      'Account 2',
    ]);
    const starAccount = options.find((option) => option.textContent === 'Account 2')!;
    await choose('library-account', starAccount.value);
    expect(container.textContent).toContain('Stored preview only');
    expect(container.textContent).not.toContain('A saved quotation');
    await choose('library-account', 'all');
    await act(async () => buttons('Highlights')[0].click());
    await query('annotation');
    expect(container.textContent).toContain('Annotation note');
    expect(container.textContent).not.toContain('Stored preview only');
    await query('absent text');
    expect(container.querySelectorAll('[data-library-item-id]')).toHaveLength(0);
  });

  it('opens a saved item in a new tab with its exact deep link', async () => {
    await mount();
    const card = Array.from(container.querySelectorAll<HTMLElement>('[data-library-item-id]')).find(
      (item) => item.textContent?.includes('Stored preview only'),
    )!;
    await act(async () => card.querySelector<HTMLButtonElement>('[data-library-open]')!.click());
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://gemini.google.com/app/one#gv-turn-turn-1',
    });
    const highlightCard = Array.from(
      container.querySelectorAll<HTMLElement>('[data-library-item-id]'),
    ).find((item) => item.textContent?.includes('A saved quotation'))!;
    await act(async () =>
      highlightCard.querySelector<HTMLButtonElement>('[data-library-open]')!.click(),
    );
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://gemini.google.com/app/one#gv-highlight-highlight-one',
    });
  });

  it('the Library keeps a different-account ChatGPT star unopened until Open anyway', async () => {
    vi.mocked(chrome.tabs.create).mockClear();
    stars = [
      star({
        conversationId: 'chatgpt:conv:one',
        conversationUrl: 'https://chatgpt.com/c/one',
        account: `chatgpt:${'a'.repeat(64)}`,
      }),
    ];
    highlights = [];
    vi.mocked(chrome.tabs.query).mockImplementation(async () => [
      { id: 7, url: 'https://chatgpt.com/' } as chrome.tabs.Tab,
    ]);
    vi.mocked(chrome.tabs.sendMessage).mockImplementation(async () => ({
      ok: true,
      account: `chatgpt:${'b'.repeat(64)}`,
    }));
    await mount();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-library-open]')!.click(),
    );
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    const host = document.querySelector<HTMLElement>('[data-gv-layer="popover"]')!;
    expect(host.shadowRoot!.textContent).toContain('This star was saved in Account 1.');
    await answerConfirmation('Open anyway');
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://chatgpt.com/c/one#gv-turn-turn-1',
    });
  });

  it('reports a conversation open failure while keeping the readable saved items', async () => {
    await mount();
    vi.mocked(chrome.tabs.create).mockImplementationOnce(async () => {
      throw new Error('Tab creation unavailable');
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-library-open]')!.click(),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Couldn’t open this conversation',
    );
    expect(container.querySelectorAll('[data-library-item-id]')).toHaveLength(2);
  });

  it('keeps canceled or failed deletions and focuses a neighboring item after acknowledged removal', async () => {
    await mount();
    await act(async () => buttons('Remove from starred')[0].click());
    await answerConfirmation('Cancel');
    expect(container.textContent).toContain('Stored preview only');
    deleteFails = true;
    await act(async () => buttons('Remove from starred')[0].click());
    await answerConfirmation('Remove from starred');
    expect(container.textContent).toContain('Stored preview only');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    deleteFails = false;
    await act(async () => buttons('Remove from starred')[0].click());
    await answerConfirmation('Remove from starred');
    expect(container.textContent).not.toContain('Stored preview only');
    expect(document.activeElement?.textContent).toContain('A saved quotation');
    await act(async () => buttons('Delete')[0].click());
    await answerConfirmation('Delete');
    expect(container.textContent).not.toContain('A saved quotation');
    expect(document.activeElement?.tagName).toBe('H1');
  });

  it('retains readable stars when the all-account highlight read fails', async () => {
    highlightReadFails = true;
    await mount();
    expect(container.textContent).toContain('Stored preview only');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('#library-site')).not.toBeNull();
  });

  it('preserves selected filters when an external storage change refreshes the page', async () => {
    await mount();
    await choose('library-site', 'gemini');
    await act(async () => buttons('Highlights')[0].click());
    highlights.push(
      highlight({
        id: 'new-highlight',
        anchor: {
          ...highlight().anchor,
          quote: { exact: 'New saved quotation', prefix: '', suffix: '' },
        },
        updatedAt: 50,
      }),
    );
    await act(async () => {
      for (const listener of listeners)
        listener({ 'gvAnnotation:bucket:v1:acct:test': { newValue: {} } }, 'local');
    });
    expect(container.textContent).toContain('New saved quotation');
    expect(container.textContent).not.toContain('Stored preview only');
    expect(container.querySelector<HTMLSelectElement>('#library-site')!.value).toBe('gemini');
    expect(buttons('Highlights')[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('follows live system appearance and sets Arabic direction for the page and shared layers', async () => {
    const ar = await loadTranslations('ar');
    language = 'ar';
    await mount();
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.body.classList.contains('gv-rtl')).toBe(true);
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dataset.gvScheme).toBe('light');
    dark = true;
    await act(async () => schemeChanged?.());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.gvScheme).toBe('dark');
    const removeButton = buttons(ar.removeFromStarred)[0];
    await act(async () => removeButton.click());
    const host = document.querySelector<HTMLElement>('[data-gv-layer="popover"]')!;
    expect(host.dataset.gvScheme).toBe('dark');
    expect(host.hasAttribute('data-gv-rtl')).toBe(true);
    await act(async () => host.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click());
  });
});
