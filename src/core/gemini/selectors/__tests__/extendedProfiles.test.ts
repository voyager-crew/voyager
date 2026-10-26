import { afterEach, describe, expect, it } from 'vitest';

import { getBundledGeminiSelectorView } from '../bundle';
import {
  GeminiSelectorService,
  type GeminiSelectorLifetime,
  resolveGeminiSelectorOperationInView,
} from '../service';
import type { GeminiSelectorView } from '../types';

const lifetimes: GeminiSelectorLifetime[] = [];

afterEach(() => {
  for (const lifetime of lifetimes.splice(0)) lifetime.stop();
  document.body.replaceChildren();
});

async function hydrate(selectors: unknown) {
  const service = new GeminiSelectorService();
  const lifetime = service.initialize({
    host: 'gemini.google.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 1,
    read: async () => ({
      id: 'gemini',
      catalogRevision: 2,
      locators: selectors,
    }),
  });
  lifetimes.push(lifetime);
  await lifetime.ready;
  return service;
}

function readRows(view: GeminiSelectorView) {
  const root = document.querySelector(view.profiles['sidebar.overflow'].join(','));
  const rows = root
    ? Array.from(root.querySelectorAll(view.profiles['sidebar.row'].join(','))).map((node) => ({
        node,
        id: node.getAttribute('data-conversation-id'),
        title: node.querySelector(view.profiles['sidebar.title'].join(','))?.textContent ?? '',
      }))
    : [];
  return { root, rows };
}

function usableRows(value: ReturnType<typeof readRows>): boolean {
  return value.rows.length > 0 && value.rows.every((row) => row.id && row.title.trim());
}

describe('Gemini page profiles', () => {
  it('keeps sidebar nodes, order and IDs identical through both profiles', async () => {
    document.body.innerHTML = `
      <nav data-test-id="overflow-container" class="online-sidebar">
        <a data-test-id="conversation" class="online-row" data-conversation-id="b">
          <span class="title-text online-title">Second chat</span>
        </a>
        <a data-test-id="conversation" class="online-row" data-conversation-id="a">
          <span class="title-text online-title">First chat</span>
        </a>
      </nav>`;
    const bundled = readRows(getBundledGeminiSelectorView());
    const service = await hydrate({
      'sidebar.overflow': ['.online-sidebar'],
      'sidebar.row': ['.online-row'],
      'sidebar.title': ['.online-title'],
    });
    const result = service.resolve(readRows, usableRows);
    expect(result.value).toEqual(bundled);
    expect(result.value.rows.map((row) => row.id)).toEqual(['b', 'a']);
    expect(result.value.rows.map((row) => row.title)).toEqual(['Second chat', 'First chat']);
  });

  it('rereads the whole sidebar when a remote root has rows without usable titles', async () => {
    document.body.innerHTML = `
      <nav data-test-id="overflow-container">
        <a data-test-id="conversation" data-conversation-id="saved">
          <span class="title-text">Saved title</span>
        </a>
      </nav>
      <section class="wrong-root">
        <a class="wrong-row" data-conversation-id="other"></a>
      </section>`;
    const service = await hydrate({
      'sidebar.overflow': ['.wrong-root'],
      'sidebar.row': ['.wrong-row'],
      'sidebar.title': ['.missing-title'],
    });
    const result = resolveGeminiSelectorOperationInView(service.getView(), readRows, usableRows);
    expect(result.value).toEqual(readRows(getBundledGeminiSelectorView()));
    expect(result.value.rows[0]?.title).toBe('Saved title');
    expect(result.value.root).toBe(document.querySelector('nav'));
  });

  it.each([
    { extra: { 'sidebar.deleteButton': ['button'] } },
    { extra: { 'account.identity': ['.account'] } },
    { extra: { 'sidebar.row': '.wrong-row' } },
    {
      extra: { 'sidebar.row': Array.from({ length: 33 }, () => '.wrong-row') },
    },
    { extra: { 'sidebar.row': ['x'.repeat(2049)] } },
    { extra: { 'sidebar.row': ['.row\u0000'] } },
  ])(
    'keeps bundled turns usable when an invalid patch carries a new locator: $extra',
    async ({ extra }) => {
      document.body.innerHTML = `
      <div class="user-query-container">Bundled question</div>
      <div class="remote-user">Unaccepted question</div>`;
      const service = await hydrate({ 'turn.user': ['.remote-user'], ...extra });
      const users = service.resolve(
        (view) => Array.from(document.querySelectorAll(view.profiles['turn.user'].join(','))),
        (nodes) => nodes.length > 0,
      );
      expect(users.value.map((node) => node.textContent)).toEqual(['Bundled question']);
    },
  );

  it('keeps the turn fix and the other sidebar fixes when one surface has an unparsable locator', async () => {
    document.body.innerHTML = `
      <div class="remote-user">Question only the fix finds</div>
      <nav class="online-sidebar">
        <a data-test-id="conversation" class="online-row" data-conversation-id="kept">
          <span class="title-text">Kept chat</span>
        </a>
      </nav>`;
    const service = await hydrate({
      'turn.user': ['.remote-user'],
      'sidebar.overflow': ['.online-sidebar'],
      'sidebar.row': ['.online-row'],
      'modelPicker.items': ['['],
    });
    const users = service.resolve(
      (view) => Array.from(document.querySelectorAll(view.profiles['turn.user'].join(','))),
      (nodes) => nodes.length > 0,
    );
    expect(users.value.map((node) => node.textContent)).toEqual(['Question only the fix finds']);
    expect(service.resolve(readRows, usableRows).value.rows.map((row) => row.id)).toEqual(['kept']);

    const broken = await hydrate({ 'turn.user': ['.remote-user'], 'sidebar.row': ['['] });
    expect(broken.resolve(readRows, usableRows).value.rows).toEqual([]);
    expect(
      broken
        .resolve(
          (view) => Array.from(document.querySelectorAll(view.profiles['turn.user'].join(','))),
          (nodes) => nodes.length > 0,
        )
        .value.map((node) => node.textContent),
    ).toEqual(['Question only the fix finds']);
  });
});
