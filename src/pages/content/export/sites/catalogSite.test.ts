import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExportFormat } from '@/features/export/types/export';
import deepseekData from '@/features/plugins/catalog/sites/deepseek/site.json';
import { validateSiteAdapterData } from '@/features/plugins/sites/siteAdapterData';
import type { SiteAdapter } from '@/features/plugins/types';
import { toastDriver } from '@/tests/toastDriver';

import { buildCatalogExportAdapter } from '../adapter/platform/catalog';
import { loadExportDictionaries } from '../exportLocale';
import { createExportRunner } from '../exportRun';
import { startExportSelectionSession } from '../exportSelectionSession';
import { readCatalogConversation } from './catalogReader';
import { createCatalogExportSite } from './catalogSite';

const sites: SiteAdapter[] = [
  {
    id: 'fixture-alpha',
    label: 'Alpha',
    matches: ['https://example.org/*'],
    selectors: { userTurn: '.prompt', assistantTurn: '.reply', scrollContainer: 'main' },
    theme: { hostSelector: 'body', lightSelector: 'body', darkSelector: '.dark' },
    capabilities: new Set(['chat']),
    conversationIdPattern: '^/chat/([^/?#]+)',
    turnKeyAttributes: ['data-id'],
    export: { version: 1, read: 'mounted', title: 'h1' },
  },
  {
    id: 'fixture-beta',
    label: 'Beta',
    matches: ['https://example.net/*'],
    selectors: {
      userTurn: '[data-role="user"]',
      assistantTurn: '[data-role="assistant"]',
      scrollContainer: '#thread',
    },
    theme: { hostSelector: 'body', lightSelector: 'body', darkSelector: '.dark' },
    capabilities: new Set(['chat']),
    conversationIdPattern: '^/session/([^/?#]+)',
    turnKeyAttributes: ['data-id'],
    export: { version: 1, read: 'mounted', title: 'h1' },
  },
];

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** DeepSeek initially mounts keys 3..10; reaching the top loads the two older messages. */
function deepseekFixture(lateScrollCorrection = false, hydrateAnswer = false) {
  const validated = validateSiteAdapterData(deepseekData);
  if (!validated.success) throw new Error(JSON.stringify(validated.error));
  const site = validated.data;
  document.body.innerHTML = '<main class="ds-virtual-list ds-scroll-area"></main>';
  const scroller = document.querySelector<HTMLElement>('main')!;
  const items: HTMLElement[] = [];
  let historyLoaded = false;
  let historyScheduled = false;
  for (let index = 0; index < 10; index++) {
    const item = document.createElement('div');
    item.setAttribute('data-virtual-list-item-key', String(index + 1));
    item.innerHTML =
      index % 2 === 0
        ? `<div class="ds-message"><div class="ds-collapsible-text">${index === 2 || index === 4 ? '继续' : `Prompt ${index}`}</div></div>`
        : `<div class="ds-message"><div class="ds-think-content">Thinking ${index}</div><div class="ds-assistant-message-main-content markdown"><p>Answer ${index}</p></div></div>`;
    items.push(item);
    item.querySelector<HTMLElement>('.ds-message')!.getBoundingClientRect = () =>
      new DOMRect(0, index * 1800 - top, 800, 1800);
  }
  scroller.append(...items.slice(2));
  const height = () => (historyLoaded ? 18416 : 14816);
  let top = 2300;
  let changes = 0;
  let busy = false;
  let correctionScheduled = false;
  const scrolls: number[] = [];
  Object.defineProperties(scroller, {
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        const next = Math.max(0, Math.min(height() - 1213, value));
        const moved = top !== next;
        top = next;
        scrolls.push(top);
        if (next === 0 && !historyScheduled) {
          historyScheduled = true;
          setTimeout(() => {
            scroller.prepend(...items.slice(0, 2));
            historyLoaded = true;
          }, 5);
        }
        if (
          lateScrollCorrection &&
          next === 2300 &&
          scrolls.some((value) => value !== 2300) &&
          !correctionScheduled
        ) {
          correctionScheduled = true;
          setTimeout(() => {
            top = height() - 1213;
          }, 1);
        }
        if (!moved || busy) return;
        busy = true;
        let remaining = 4;
        const mutate = () => {
          scroller.querySelectorAll('.ds-think-content').forEach((thought) => {
            thought.textContent = `Thinking elapsed ${++changes}`;
          });
          const reply = scroller.querySelector('.ds-assistant-message-main-content')!;
          if (hydrateAnswer && top >= 600)
            reply.querySelector('p')!.textContent = 'Hydrated answer 1';
          let control = reply.querySelector('.gv-runtime-status');
          if (!control) {
            control = document.createElement('span');
            control.className = 'gv-runtime-status';
            control.setAttribute('data-gv-component', 'runtime-status');
            reply.append(control);
          }
          control.textContent = `UI counter ${changes}`;
          if (--remaining) queueMicrotask(mutate);
          else busy = false;
        };
        queueMicrotask(mutate);
      },
    },
    scrollHeight: { configurable: true, get: height },
    clientHeight: { configurable: true, value: 1213 },
  });
  return { site, scroller, scrolls };
}

describe('DeepSeek conversation export regression', () => {
  it('loads the two missing DeepSeek messages at the top and exports keys 1..10 without duplicates', async () => {
    vi.useFakeTimers();
    const { site, scroller, scrolls } = deepseekFixture(false, true);
    expect(
      Array.from(scroller.children, (item) => item.getAttribute('data-virtual-list-item-key')),
    ).toEqual(['3', '4', '5', '6', '7', '8', '9', '10']);
    const pending = readCatalogConversation(
      site,
      buildCatalogExportAdapter(site),
      {},
      {
        pollMs: 10,
        stableSamples: 2,
        topTimeoutMs: 80,
        timeoutMs: 1000,
      },
    );
    await vi.advanceTimersByTimeAsync(1100);
    const result = await pending;
    expect(scrolls).toContain(17203);
    expect(result.snapshots).toHaveLength(10);
    expect(result.snapshots.map(({ nativeId }) => nativeId)).toEqual(
      Array.from({ length: 10 }, (_, index) => `data-virtual-list-item-key:${index + 1}`),
    );
    expect(result.snapshots.map((snapshot) => snapshot.text)).toEqual([
      'Prompt 0',
      'Hydrated answer 1',
      '继续',
      'Answer 3',
      '继续',
      'Answer 5',
      'Prompt 6',
      'Answer 7',
      'Prompt 8',
      'Answer 9',
    ]);
    // The shipped DeepSeek descriptor has no verified generating selector yet.
    expect(result.completeness).toBe('unknown');
    expect(scroller.scrollTop).toBe(2300);
  });

  it('shows one checkbox on each real DeepSeek message and keeps the restored scroll position', async () => {
    vi.useFakeTimers();
    const { site: adapter, scroller } = deepseekFixture();
    const site = createCatalogExportSite(adapter);
    const pending = site.turns.prepare?.({ expectedUrl: location.href });
    await vi.advanceTimersByTimeAsync(6000);
    const prepared = await pending;
    if (!prepared) throw new Error('No prepared session');
    const selection = startExportSelectionSession({
      t: (key) => (key === 'export_select_mode_count' ? 'Selected {count}' : key),
      readMessages: prepared.messages,
      initialSelectedMessageId: null,
      anchors: site.page,
      isSameConversation: () => true,
      abortExport: () => {},
      onConfirm: async () => {},
    });
    try {
      expect(document.querySelectorAll('.ds-message > .gv-export-msg-selector')).toHaveLength(10);
      expect(document.querySelectorAll('.ds-message.gv-export-msg-host')).toHaveLength(10);
      document.querySelector<HTMLButtonElement>('[data-gv-export-action="selectAll"]')!.click();
      expect(document.querySelector('.gv-export-select-count')?.textContent).toBe('Selected 10');
      await vi.advanceTimersByTimeAsync(500);
      expect(document.querySelectorAll('.ds-message > .gv-export-msg-selector')).toHaveLength(10);
      expect(scroller.scrollTop).toBe(2300);
    } finally {
      selection.cancel();
      await selection.done;
      prepared.release();
    }
  });

  it('restores the original position after a virtualizer applies a delayed scroll correction', async () => {
    vi.useFakeTimers();
    const { site, scroller } = deepseekFixture(true);
    const pending = readCatalogConversation(
      site,
      buildCatalogExportAdapter(site),
      {},
      {
        pollMs: 10,
        stableSamples: 2,
        topTimeoutMs: 80,
        timeoutMs: 1000,
      },
    );
    await vi.advanceTimersByTimeAsync(1100);
    await pending;
    expect(scroller.scrollTop).toBe(2300);
  });

  it('does not lose the restored position to a delayed correction after cancellation', async () => {
    vi.useFakeTimers();
    const { site, scroller } = deepseekFixture(true);
    const controller = new AbortController();
    const pending = readCatalogConversation(
      site,
      buildCatalogExportAdapter(site),
      { signal: controller.signal },
      {
        pollMs: 10,
        stableSamples: 2,
        topTimeoutMs: 80,
        timeoutMs: 1000,
      },
    );
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(200);
    controller.abort();
    await vi.advanceTimersByTimeAsync(200);
    await rejected;
    expect(scroller.scrollTop).toBe(2300);
  });

  it('keeps the incomplete warning visible when an uncertain read opens selection', async () => {
    const dict = await loadExportDictionaries('en');
    vi.useFakeTimers();
    const { site: adapter, scroller } = deepseekFixture();
    const site = createCatalogExportSite({ ...adapter, export: { version: 1, read: 'mounted' } });
    const runner = createExportRunner({ site });
    const running = runner.run({ format: ExportFormat.MARKDOWN }, { dict, lang: 'en' });
    try {
      await vi.advanceTimersByTimeAsync(500);
      expect(document.querySelector('.gv-export-select-bar')).not.toBeNull();
      expect(document.querySelectorAll('.ds-message > .gv-export-msg-selector')).toHaveLength(8);
      expect(toastDriver.all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: dict.en.export_read_incomplete, tone: 'warning' }),
        ]),
      );
      expect(scroller.scrollTop).toBe(2300);
    } finally {
      runner.cancel();
      await running;
    }
  });
});

it('does not bind two checkboxes to one keyed message after its body changes', async () => {
  document.body.innerHTML =
    '<main><div class="prompt" data-id="1">A</div><div class="prompt" data-id="2">B</div></main>';
  const site = createCatalogExportSite(sites[0]);
  const prepared = await site.turns.prepare?.({});
  if (!prepared) throw new Error('No prepared session');
  document.querySelector('main')!.innerHTML = '<div class="prompt" data-id="1">B</div>';
  const selection = startExportSelectionSession({
    t: (key) => key,
    readMessages: prepared.messages,
    initialSelectedMessageId: null,
    anchors: site.page,
    isSameConversation: () => true,
    abortExport: () => {},
    onConfirm: async () => {},
  });
  try {
    const live = document.querySelector('.prompt')!;
    expect(live.querySelectorAll('.gv-export-msg-selector')).toHaveLength(1);
    expect(
      live.querySelector<HTMLElement>('.gv-export-msg-selector')?.dataset.gvExportMessageId,
    ).toBe('user:data-id:1');
    const messages = prepared.messages();
    const turns = await prepared.build(new Set(messages.map(({ messageId }) => messageId)), {});
    expect(turns.map(({ user }) => user)).toEqual(['A', 'B']);
  } finally {
    selection.cancel();
    await selection.done;
    prepared.release();
  }
});

it('keeps ambiguous remounted repeats selectable by role/all without checkboxes on offline clones', async () => {
  document.body.innerHTML =
    '<main id="thread"><div class="prompt">继续</div><div class="prompt">继续</div><div class="prompt">继续</div></main>';
  const site = createCatalogExportSite({ ...sites[0], turnKeyAttributes: undefined });
  const prepared = await site.turns.prepare?.({});
  if (!prepared) throw new Error('No prepared session');
  document.querySelector('main')!.innerHTML =
    '<div class="prompt">继续</div><div class="prompt">继续</div>';
  const messages = prepared.messages();
  const selection = startExportSelectionSession({
    t: (key) => (key === 'export_select_mode_count' ? 'Selected {count}' : key),
    readMessages: prepared.messages,
    initialSelectedMessageId: null,
    anchors: site.page,
    isSameConversation: () => true,
    abortExport: () => {},
    onConfirm: async () => {},
  });
  try {
    expect(messages).toHaveLength(3);
    expect(document.querySelectorAll('.gv-export-msg-selector')).toHaveLength(0);
    expect(
      messages.flatMap(({ hostElement }) =>
        Array.from(hostElement.querySelectorAll('.gv-export-msg-selector')),
      ),
    ).toHaveLength(0);
    document.querySelector<HTMLButtonElement>('[data-gv-export-action="selectAll"]')!.click();
    expect(document.querySelector('.gv-export-select-count')?.textContent).toBe('Selected 3');
    document.querySelector<HTMLButtonElement>('[data-gv-export-action="selectAll"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-gv-export-action="selectUser"]')!.click();
    expect(document.querySelector('.gv-export-select-count')?.textContent).toBe('Selected 3');
    const turns = await prepared.build(new Set(messages.map(({ messageId }) => messageId)), {});
    expect(turns.map(({ user }) => user)).toEqual(['继续', '继续', '继续']);
  } finally {
    selection.cancel();
    await selection.done;
    prepared.release();
  }
});

describe.each(sites)('catalog export on $label', (adapter) => {
  it('exports immutable rich bodies, keeps consecutive prompts and reanchors remounted selection', async () => {
    document.body.innerHTML = `<h1>Snapshot title</h1><main id="thread">
      <div class="prompt" data-role="user" data-id="1">continue</div>
      <div class="prompt" data-role="user" data-id="2">continue</div>
      <div class="reply" data-role="assistant" data-id="3"><p>Saved <strong>reply</strong></p><pre><code class="language-js">const n = 1;</code></pre></div>
    </main>`;
    const site = createCatalogExportSite(adapter);
    const session = await site.turns.prepare?.({ expectedUrl: location.href });
    if (!session) throw new Error('No prepared session');
    try {
      expect(site.label).toBe(adapter.label);
      expect(site.title()).toBe('Snapshot title');
      const initial = session.messages();
      const ids = new Set(initial.map((message) => message.messageId));
      expect(ids.size).toBe(3);
      const old = document.querySelector('[data-id="3"]')!;
      const remounted = old.cloneNode(true);
      old.replaceWith(remounted);
      expect(session.messages()[2].hostElement).toBe(remounted);
      remounted.textContent = 'Recycled DOM';
      const turns = await session.build(ids, { expectedUrl: location.href });
      expect(turns.map((turn) => turn.user)).toEqual(['continue', 'continue']);
      expect(turns[1].assistantContent?.text).toContain('Saved **reply**');
      expect(turns[1].assistantContent?.text).toContain('```js\nconst n = 1;');
      expect(turns[1].assistantContent?.text).not.toContain('Recycled DOM');
      const replyOnly = await session.build(new Set([initial[2].messageId]), {});
      expect(replyOnly).toHaveLength(1);
      expect(replyOnly[0].userContent).toBeUndefined();
    } finally {
      session.release();
    }
    expect(session.messages()).toEqual([]);
  });

  it('shows the toolbar only on the adapter conversation route', () => {
    const entry = createCatalogExportSite(adapter).entryPoints;
    if (entry.kind !== 'toolbar') throw new Error('Expected toolbar');
    const prefix = adapter.id === 'fixture-alpha' ? 'chat' : 'session';
    expect(entry.isConversationPage?.(document, `https://example.org/${prefix}/123`)).toBe(true);
    expect(entry.isConversationPage?.(document, 'https://example.org/settings')).toBe(false);
  });
});
