import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { findGemsSidebarLocation } from '../location';
import { createGemsSidebarView } from '../sidebar';

function mountEntry() {
  const overflow = document.createElement('div');
  overflow.dataset.testId = 'overflow-container';
  overflow.className = 'online-sidebar';
  const entry = document.createElement('gem-nav-list-item');
  entry.dataset.testId = 'gems-side-nav-entry-button';
  vi.spyOn(entry, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 40 } as DOMRect);
  overflow.append(entry);
  document.body.append(overflow);
  return { overflow, entry };
}

describe('Gems list keeps its native anchor when the sidebar root is updated online', () => {
  let stopSnapshot: (() => void) | undefined;
  let view: ReturnType<typeof createGemsSidebarView> | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });

  afterEach(() => {
    view?.stop();
    view = undefined;
    stopSnapshot?.();
    stopSnapshot = undefined;
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('finds the same root and native entry through equivalent online names', async () => {
    const { overflow, entry } = mountEntry();
    const bundled = findGemsSidebarLocation();
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.overflow': ['.online-sidebar'] });

    const online = findGemsSidebarLocation();

    expect(online?.overflow).toBe(bundled?.overflow);
    expect(online?.entry).toBe(bundled?.entry);
    expect(online?.overflow).toBe(overflow);
    expect(online?.entry).toBe(entry);
  });

  it('places the real Gems list after its native entry when a matching online root has no usable anchor', async () => {
    const { entry } = mountEntry();
    const wrongRoot = document.createElement('div');
    wrongRoot.className = 'online-decoy';
    document.body.prepend(wrongRoot);
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.overflow': ['.online-decoy'] });
    view = createGemsSidebarView(
      () => 3,
      () => true,
      () => [{ id: 'writer', href: '/gem/writer', name: 'Writer' }],
      async () => {},
    );

    view.refresh();

    const list = entry.nextElementSibling;
    expect(list?.classList.contains('gv-gems-inline-list')).toBe(true);
    expect(list?.querySelector('.gv-gems-item-name')?.textContent).toBe('Writer');
    expect(list?.querySelector<HTMLAnchorElement>('.gv-gems-item')?.href).toBe(
      'https://gemini.google.com/gem/writer',
    );
    expect(document.querySelectorAll('.gv-gems-inline-list')).toHaveLength(1);
  });
});
