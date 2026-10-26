import { afterEach, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { findSidebarMount } from '../sidebarMountDom';
import { createSidebarRuntimeHarness, mountSidebar } from './sidebarRuntimeHarness';

vi.mock('webextension-polyfill', () => ({ default: chrome }));
vi.mock('@/utils/i18n', () => ({ getTranslationSyncUnsafe: (key: string) => key }));
let retire = () => {};
let harness: ReturnType<typeof createSidebarRuntimeHarness> | null = null;
afterEach(() => {
  harness?.runtime.stop();
  harness = null;
  retire();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const KEYS = [
  'sidebar.notebooks',
  'sidebar.recents',
  'sidebar.allConversations',
  'sidebar.history',
  'sidebar.section',
  'sidebar.rowContainer',
] as const;
it.each(KEYS)(
  '%s moves the real folder panel and falls back for missing or editable targets',
  async (key) => {
    vi.useFakeTimers();
    const { sectionParent, recentsSection, notebooksSection } = mountSidebar();
    const remote = document.createElement('section');
    remote.id = 'remote';
    sectionParent.append(remote);
    let original: HTMLElement = recentsSection;
    if (key === 'sidebar.notebooks') original = notebooksSection;
    else if (key !== 'sidebar.recents') {
      recentsSection.remove();
      if (key === 'sidebar.allConversations' || key === 'sidebar.history') {
        original = document.createElement('div');
        if (key === 'sidebar.allConversations')
          original.setAttribute('data-test-id', 'all-conversations');
        else original.className = 'chat-history';
        sectionParent.prepend(original);
      } else {
        original = document.createElement(key === 'sidebar.section' ? 'expandable-section' : 'div');
        if (key === 'sidebar.rowContainer') original.className = 'conversation-wrapper';
        const row = document.createElement('div');
        row.setAttribute('data-test-id', 'conversation');
        row.innerHTML = '<a href="/app/abcdef1234"><span class="title-text">Chat</span></a>';
        remote.append(row);
        original.append(remote);
        sectionParent.append(original);
      }
    }
    const preference = key === 'sidebar.notebooks' ? 'above-notebooks' : 'above-recents';
    expect(findSidebarMount(preference)?.anchor).toBe(original);
    retire = await installGeminiSelectorPatch({ [key]: ['#remote'] });
    const show = async (anchor: HTMLElement) => {
      harness?.runtime.stop();
      harness = createSidebarRuntimeHarness();
      harness.runtime.setAnchor(preference);
      await harness.runtime.start('sidebar');
      expect(harness.runtime.panel?.classList.contains('gv-folder-container')).toBe(true);
      expect(harness.runtime.panel?.nextElementSibling).toBe(anchor);
      harness.runtime.stop();
      harness = null;
    };
    await show(remote);
    remote.id = 'missing';
    await show(original);
    remote.id = 'remote';
    remote.setAttribute('contenteditable', 'true');
    await show(original);
    remote.removeAttribute('contenteditable');
    await show(remote);
  },
);
