/**
 * What the shared folder tree shows in each of its consumers, pinned through
 * the DOM a user sees before its internals move to open-source packages. Each
 * consumer is mounted through its own entry point (see `treeConsumers`), and
 * every DOM query goes through `treeDriver`, so these cases outlive a markup change.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FolderData } from '../../types';
import { FOLDER_TOGGLE_DELAY_MS } from '../shared';
import { CONSUMERS, type ConsumerId, destroyMountedTrees, mountConsumer } from './treeConsumers';
import { label, settle, treeDriver } from './treeDriver';
import {
  calledSpies,
  conv,
  deepFreeze,
  folder,
  placementFixture,
  sharedFixture,
  spyActions,
} from './treeFixtures';

vi.mock('webextension-polyfill', () => ({ default: chrome }));

afterEach(() => {
  vi.useRealTimers();
  destroyMountedTrees();
  document.body.innerHTML = '';
  document.body.className = '';
  document.documentElement.removeAttribute('data-gv-scheme');
});

/**
 * Default order (floating panel, ChatGPT): root chats first; folders pinned
 * first, then by sortIndex; a folder's subfolders before its own chats;
 * chats starred first, then most recent. Folders on a parent cycle follow the real
 * roots, the first of the cycle in stored order standing in as its root.
 */
const DEFAULT_OUTLINE = [
  '· Loose chat',
  'Mu',
  'Zeta',
  'Alpha',
  '  Child',
  '    Grandchild',
  '      · Deep chat',
  '  · Starred',
  '  · Newest',
  '  · Oldest',
  'Orphan',
  'Loop X',
  '  Loop Y',
];

/**
 * AI Studio: folders pinned first, then oldest first; chats in stored order;
 * root chats after every folder, under an Uncategorized heading.
 */
const AISTUDIO_OUTLINE = [
  'Mu',
  'Alpha',
  '  Child',
  '    Grandchild',
  '      · Deep chat',
  '  · Oldest',
  '  · Starred',
  '  · Newest',
  'Zeta',
  'Orphan',
  'Loop X',
  '  Loop Y',
  '· Loose chat',
];

const EXPECTED: Record<
  ConsumerId,
  { outline: string[]; rootHeading: boolean; emptyLabelKey: string }
> = {
  panel: { outline: DEFAULT_OUTLINE, rootHeading: false, emptyLabelKey: 'floatingPanelEmpty' },
  aistudio: { outline: AISTUDIO_OUTLINE, rootHeading: true, emptyLabelKey: 'floatingPanelEmpty' },
  // Gemini's sidebar wording.
  chatgpt: { outline: DEFAULT_OUTLINE, rootHeading: false, emptyLabelKey: 'folder_empty' },
};

describe.each(CONSUMERS)('$name: what the tree shows', ({ consumer }) => {
  function mount(data: (rootBucketId: string) => FolderData, actions = spyActions()) {
    const rootBucketId = consumer === 'aistudio' ? '__uncategorized__' : '__root_conversations__';
    const tree = mountConsumer(consumer, data(rootBucketId), actions);
    return { tree, view: treeDriver(tree), actions };
  }

  it('places root, orphan and cycle folders, nests them, and orders folders and chats', () => {
    const { view } = mount(placementFixture);
    expect(view.outline()).toEqual(EXPECTED[consumer].outline);
  });

  it('labels root chats with a heading only where the site has one', () => {
    const { view } = mount(placementFixture);
    expect(view.text().includes(label('folder_uncategorized'))).toBe(
      EXPECTED[consumer].rootHeading,
    );
  });

  it('shows a chat once in every folder that holds it, the root included', () => {
    const { tree, view } = mount(sharedFixture);
    expect(view.bucketsShowing('Shared').sort()).toEqual([tree.rootBucketId, 'a', 'b'].sort());
  });

  it('shows the empty state only while there are neither folders nor root chats', () => {
    const { tree, view } = mount(() => ({ folders: [], folderContents: {} }));
    const empty = label(EXPECTED[consumer].emptyLabelKey);
    expect(view.text()).toContain(empty);
    expect(view.outline()).toEqual([]);

    tree.update({ folders: [], folderContents: { [tree.rootBucketId]: [conv('r', 'At root')] } });
    expect(view.text()).not.toContain(empty);
    expect(view.outline()).toEqual(['· At root']);
  });

  it('shows an empty folder with no chats instead of the empty state', () => {
    const { view } = mount(() => ({ folders: [folder('e', 'Empty')], folderContents: { e: [] } }));
    expect(view.outline()).toEqual(['Empty']);
    expect(view.text()).not.toContain(label(EXPECTED[consumer].emptyLabelKey));
  });

  it('names a chat with no title "Untitled"', () => {
    const { view } = mount(() => ({
      folders: [folder('a', 'Alpha')],
      folderContents: { a: [conv('u', '')] },
    }));
    expect(view.outline()).toEqual(['Alpha', '  · Untitled']);
  });

  it('starts collapsed folders closed, hiding their subfolders and chats', () => {
    const { view } = mount(() => ({
      folders: [
        folder('a', 'Alpha', { isExpanded: false }),
        folder('c', 'Child', { parentId: 'a' }),
      ],
      folderContents: { a: [conv('x', 'Hidden chat')], c: [] },
    }));
    expect(view.outline()).toEqual(['Alpha']);
    expect(view.isExpanded('Alpha')).toBe(false);
    expect(view.expandControl('Alpha').getAttribute('aria-label')).toBe(
      label('floatingPanelExpandFolder'),
    );
  });

  it('asks the host to persist expansion and follows the stored value it pushes back', () => {
    const data = placementFixture(
      consumer === 'aistudio' ? '__uncategorized__' : '__root_conversations__',
    );
    const { tree, view, actions } = mount(() => structuredClone(data));

    view.toggle('Alpha');
    expect(actions.onToggleFolderExpanded.mock.calls).toEqual([['a']]);
    expect(calledSpies(actions)).toEqual(['onToggleFolderExpanded']);

    const collapsed = structuredClone(data);
    collapsed.folders.find((f) => f.id === 'a')!.isExpanded = false;
    tree.update(collapsed);
    expect(view.isExpanded('Alpha')).toBe(false);
    expect(view.outline()).not.toContain('  Child');
    expect(view.outline()).not.toContain('  · Oldest');

    view.toggle('Alpha');
    expect(actions.onToggleFolderExpanded.mock.calls).toEqual([['a'], ['a']]);
  });

  // A site that renames on double-click (ChatGPT) toggles once the second click could not come.
  it('toggles a folder from a click on its name too', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { view, actions } = mount(placementFixture);
    view.folderNameElement('Zeta').click();
    vi.advanceTimersByTime(FOLDER_TOGGLE_DELAY_MS);
    expect(actions.onToggleFolderExpanded.mock.calls).toEqual([['z']]);
  });

  it('lets folder names and chat titles take their own direction and keeps the full text', () => {
    const longName = `${'مجلد طويل جدا '.repeat(4)}with English tail`;
    const longTitle = `${'A very long conversation title '.repeat(4)}نهاية`;
    const { view } = mount(() => ({
      folders: [folder('a', longName)],
      folderContents: { a: [conv('c', longTitle)] },
    }));

    const name = view.folderNameElement(longName.trim());
    expect(name.getAttribute('dir')).toBe('auto');
    expect(name.getAttribute('title')).toBe(longName);
    const title = view.titleButton('a', longTitle.trim());
    expect(title.getAttribute('dir')).toBe('auto');
    expect(title.getAttribute('title')).toBe(longTitle);
  });

  it('indents rows with logical properties, so RTL pages mirror them', () => {
    const { view } = mount(placementFixture);
    const rows = [view.folderRow('Child'), view.conversationRow('a', 'Oldest')];
    for (const row of rows) {
      expect(row.style.paddingLeft).toBe('');
      expect(row.style.paddingRight).toBe('');
      expect(row.style.marginLeft).toBe('');
      expect(row.style.marginRight).toBe('');
    }
  });

  it("mirrors the page's RTL direction and color scheme onto its host, live", async () => {
    document.documentElement.setAttribute('data-gv-scheme', 'dark');
    const { tree } = mount(placementFixture);
    expect(tree.host.getAttribute('data-gv-scheme')).toBe('dark');
    expect(tree.host.hasAttribute('data-gv-rtl')).toBe(false);

    document.body.classList.add('gv-rtl');
    document.documentElement.setAttribute('data-gv-scheme', 'light');
    await settle();
    expect(tree.host.hasAttribute('data-gv-rtl')).toBe(true);
    expect(tree.host.getAttribute('data-gv-scheme')).toBe('light');
  });

  it('renders frozen data without writing to it, and raises no data callback', () => {
    const actions = spyActions();
    const { view } = mount((rootBucketId) => deepFreeze(placementFixture(rootBucketId)), actions);
    expect(view.outline()).toEqual(EXPECTED[consumer].outline);
    expect(calledSpies(actions)).toEqual([]);
  });
});

describe('floating panel and AI Studio: expansion without a persistence callback', () => {
  it.each(['panel', 'aistudio'] as const)(
    '%s keeps expansion local and never writes it into the data',
    (consumer) => {
      const rootBucketId = consumer === 'aistudio' ? '__uncategorized__' : '__root_conversations__';
      const { onToggleFolderExpanded: _persisted, ...actions } = spyActions();
      const tree = mountConsumer(consumer, deepFreeze(placementFixture(rootBucketId)), actions);
      const view = treeDriver(tree);

      view.toggle('Alpha');
      expect(view.isExpanded('Alpha')).toBe(false);
      expect(view.outline()).not.toContain('  Child');

      view.toggle('Alpha');
      expect(view.isExpanded('Alpha')).toBe(true);
      expect(view.outline()).toContain('  Child');
    },
  );
});

describe('AI Studio: the open prompt', () => {
  it('marks the rows of the open prompt as the current page and follows navigation', () => {
    const data = sharedFixture('__uncategorized__');
    const tree = mountConsumer('aistudio', data, spyActions(), { activeConversationId: 'shared' });
    const view = treeDriver(tree);
    const current = (bucketId: string, title: string) =>
      view.titleButton(bucketId, title).getAttribute('aria-current');

    expect(current('a', 'Shared')).toBe('page');
    expect(current('b', 'Shared')).toBe('page');
    expect(current('__uncategorized__', 'Shared')).toBe('page');
    expect(current('a', 'Solo')).toBeNull();

    tree.setActiveConversation!('solo');
    expect(current('a', 'Solo')).toBe('page');
    expect(current('a', 'Shared')).toBeNull();
  });
});
