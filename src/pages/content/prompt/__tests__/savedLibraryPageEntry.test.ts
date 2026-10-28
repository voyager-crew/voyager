import { afterEach, expect, it, vi } from 'vitest';

import { LIBRARY_OPEN_MESSAGE } from '@/features/savedLibrary/openLibraryPage';
import { loadTranslations } from '@/utils/translations';

import { createSavedLibraryView } from '../savedLibraryView';

const en = await loadTranslations('en');

vi.mock('webextension-polyfill', () => ({ default: chrome }));

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function createEntry() {
  const notice = vi.fn();
  const view = createSavedLibraryView({
    list: document.createElement('div'),
    t: (key) => en[key],
    getQuery: () => '',
    isActive: () => true,
    setNotice: notice,
    beforeRender: () => {},
    onBack: () => {},
    rememberView: async () => {},
    onNavigated: () => {},
    highlightPlatform: 'gemini',
  });
  document.body.append(view.toolbar);
  view.setActive(true);
  return {
    view,
    notice,
    button: view.toolbar.querySelector<HTMLButtonElement>('.gv-pm-saved-open-full')!,
  };
}

it('launches the full Library from the active in-page Library toolbar only', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((async () => ({
    ok: true,
  })) as typeof chrome.runtime.sendMessage);
  const { view, button, notice } = createEntry();
  expect(button.textContent).toBe(en.savedLibraryOpenFull);
  expect(view.toolbar.classList.contains('gv-hidden')).toBe(false);

  button.click();
  await vi.waitFor(() =>
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: LIBRARY_OPEN_MESSAGE }),
  );
  expect(notice).not.toHaveBeenCalled();

  view.setActive(false);
  expect(view.toolbar.classList.contains('gv-hidden')).toBe(true);
});

it('reports a refused full Library launch through the existing in-page notice', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((async () => ({
    ok: false,
  })) as typeof chrome.runtime.sendMessage);
  const { button, notice } = createEntry();
  button.click();
  await vi.waitFor(() => expect(notice).toHaveBeenCalledWith(en.savedLibraryOpenFailed, 'err'));
});
