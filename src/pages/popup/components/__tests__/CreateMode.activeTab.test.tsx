import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type TranslationKey, loadTranslations } from '@/utils/translations';

import { LocalPluginsPanel } from '../LocalPluginsPanel';
import { AUTHORED, button, fenced, field, flush, setValue } from './createModeTestKit';

const en = await loadTranslations('en');
const english = (key: string) => en[key as TranslationKey] ?? key;

describe('the Create card on a tab the popup resolves after it mounts', () => {
  let container: HTMLDivElement;
  let root: Root;
  let writeText: Mock;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (chrome.storage.local.get as unknown as Mock).mockImplementation(
      async (defaults: Record<string, unknown>) => ({ ...defaults }),
    );
    writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (chrome.storage.local.get as unknown as Mock).mockReset();
  });

  // The popup knows the active tab only after the card is already on screen.
  async function render(activeUrl: string): Promise<void> {
    await act(async () => root.render(<LocalPluginsPanel t={english} activeUrl={activeUrl} />));
    await flush();
  }

  const select = () => container.querySelector('select') as HTMLSelectElement;

  it('copies the request for the resolved site, and keeps a site the user picked', async () => {
    await render('');
    await render('https://aistudio.google.com/prompts/new_chat');
    expect(select().value).toBe('aistudio');

    await act(async () =>
      setValue(
        field(container, english('localPluginDescribeRequestPlaceholder')),
        'Make my messages narrower',
      ),
    );
    await act(async () => button(container, english('createModeCopyForChat')).click());
    await flush();
    expect(String(writeText.mock.lastCall?.[0])).toContain('/create/aistudio.md');

    await act(async () => setValue(select(), 'claude'));
    await render('https://gemini.google.com/app');
    expect(select().value).toBe('claude');
  });

  it('compares a pasted reply with the resolved site', async () => {
    await render('');
    await render('https://aistudio.google.com/prompts/new_chat');
    await act(async () =>
      setValue(field(container, english('localPluginDescribeReplyPlaceholder')), fenced(AUTHORED)),
    );
    await act(async () => button(container, english('localPluginDescribeCheck')).click());
    await flush();
    expect(container.querySelector('[data-testid="local-plugin-warnings"]')?.textContent).toContain(
      english('localPluginWarnNotOnSite').replace('{site}', 'AI Studio'),
    );
  });
});
