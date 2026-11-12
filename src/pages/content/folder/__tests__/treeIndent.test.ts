import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { FOLDER_INDENT_PROPERTY } from '../folderDisplay';
import { SIDEBAR_TREE_HOST_CLASS } from '../sidebarTree';
import { createFolderViewHarness, resetFolderViewBrowserMocks } from './folderViewHarness';
import { sidebarTree } from './sidebarTreeDriver';

vi.mock('webextension-polyfill', () => ({ default: chrome }));

vi.mock('@/utils/i18n', () => ({
  getTranslationSync: (key: string) => key,
  getTranslationSyncUnsafe: (key: string) => key,
  initI18n: () => Promise.resolve(),
}));

describe('folder tree indentation', () => {
  let harness: Awaited<ReturnType<typeof createFolderViewHarness>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    resetFolderViewBrowserMocks();
    harness = await createFolderViewHarness({
      folders: ['root', 'child', 'legacy-deep'].map((id, index, ids) => ({
        id,
        name: id,
        parentId: index ? ids[index - 1] : null,
        isExpanded: true,
        createdAt: 1,
        updatedAt: 1,
      })),
      folderContents: {
        child: [{ conversationId: 'a', title: 'A', url: '/app/a', addedAt: 1 }],
        'legacy-deep': [{ conversationId: 'b', title: 'B', url: '/app/b', addedAt: 1 }],
      },
    });
  });

  afterEach(() => {
    harness?.destroy();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** The indent each tree level adds to its rows' padding. */
  const indent = () =>
    harness.runtime
      .panel!.querySelector<HTMLElement>(`.${SIDEBAR_TREE_HOST_CLASS}`)!
      .style.getPropertyValue(FOLDER_INDENT_PROPERTY);

  it('starts at the default -8px indent', () => {
    expect(indent()).toBe('-8px');
  });

  // The setting runs from -8 to 32.
  it.each([
    [-40, '-8px'],
    [64, '32px'],
    [0, '0px'],
    [16, '16px'],
    ['invalid', '-8px'],
  ])('clamps indent %s to %s without touching data', (setting, expected) => {
    const originalData = structuredClone(harness.store.data);
    harness.treeView.applySettings(
      { [StorageKeys.GV_FOLDER_TREE_INDENT]: { newValue: setting } },
      'sync',
    );

    expect(indent()).toBe(expected);
    expect(sidebarTree(harness.runtime.panel).outline()).toEqual([
      'root',
      '  child',
      '    legacy-deep',
      '      · B',
      '    · A',
    ]);
    expect(harness.store.data).toEqual(originalData);
  });
});
