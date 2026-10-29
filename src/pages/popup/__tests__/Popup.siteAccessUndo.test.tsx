import { act } from 'react';

import { describe, expect, it } from 'vitest';

import { PLATFORM_LOGOS } from '@/core/icons/platformLogos';
import { StorageKeys } from '@/core/types/common';

import { en, extensionApi, mount, sync } from './popupHarness';
import {
  buttonWithText,
  coverage,
  coverageGrants,
  grant,
  granted,
  otherWebsiteRows,
  otherWebsites,
  siteRow,
  toast,
} from './siteAccessHarness';

const named = (text: string, site: string) => text.replace('{site}', site);
/** Lets every pending browser answer and storage write land. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const undoButton = () => buttonWithText(en.pluginToggleUndo, toast());
const removeSite = async (id: string) => {
  await act(async () => buttonWithText(en.siteAccessRemove, siteRow(id))!.click());
  await settle();
};
const removeWebsite = async (website: string) => {
  const row = otherWebsiteRows().find(
    (item) => item.querySelector(':scope > bdi')?.textContent === website,
  )!;
  await act(async () => row.querySelector('button')!.click());
  await settle();
};
const clickUndo = async () => {
  await act(async () => undoButton()!.click());
  await settle();
};

describe('Removing site access', () => {
  it('keeps a grant a remaining website still runs on, and says the site stays allowed', async () => {
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['openai.com', 'platform.openai.com'];
    grant('https://*.openai.com/*');
    await mount();

    await removeSite('chatgpt');

    expect(extensionApi.permissions.remove).not.toHaveBeenCalled();
    expect([...granted]).toEqual(['https://*.openai.com/*']);
    expect(coverage()).toEqual(['platform.openai.com']);
    expect(siteRow('chatgpt').textContent).toContain(en.siteAccessAllowed);
    expect(toast().textContent).toContain(named(en.siteAccessKept, 'ChatGPT'));

    await clickUndo();

    expect(coverage()).toEqual(['openai.com', 'platform.openai.com']);
    expect(extensionApi.permissions.request).not.toHaveBeenCalled();
  });

  it('revoking a site covered through a parent domain removes that entry too, and undo puts both back in place', async () => {
    const stored = ['qwen.ai', 'deepseek.com', 'notebooklm.google.com', 'chat.deepseek.com'];
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = stored;
    grant(...stored.flatMap(coverageGrants));
    await mount();

    await removeSite('deepseek');

    expect(coverage()).toEqual(['qwen.ai', 'notebooklm.google.com']);
    expect(siteRow('deepseek').textContent).toContain(en.siteAccessNotAllowed);

    await clickUndo();

    expect(coverage()).toEqual(stored);
    expect([...extensionApi.permissions.request.mock.calls[0][0].origins].sort()).toEqual(
      [...coverageGrants('deepseek.com'), ...coverageGrants('chat.deepseek.com')].sort(),
    );
    expect(siteRow('deepseek').textContent).toContain(en.siteAccessAllowed);
  });

  it('removing an added website removes exactly the grant it held', async () => {
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['qwen.ai', 'example.org'];
    // Only the http half of its pair was ever granted.
    grant(...coverageGrants('qwen.ai'), 'http://*.example.org/*');
    await mount();

    await removeWebsite('example.org');

    expect(extensionApi.permissions.remove).toHaveBeenCalledExactlyOnceWith({
      origins: ['http://*.example.org/*'],
    });
    expect([...granted]).toEqual(coverageGrants('qwen.ai'));
    expect(coverage()).toEqual(['qwen.ai']);
    expect(toast().textContent).toContain(named(en.siteAccessRemoved, 'example.org'));
  });

  it('an added website’s undo asks for exactly what it removed and puts it back in place', async () => {
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['qwen.ai', 'example.org', 'notebooklm.google.com'];
    grant(
      ...coverageGrants('qwen.ai'),
      'http://*.example.org/*',
      ...coverageGrants('notebooklm.google.com'),
    );
    await mount();
    await removeWebsite('example.org');
    expect(coverage()).toEqual(['qwen.ai', 'notebooklm.google.com']);

    await clickUndo();

    expect(extensionApi.permissions.request).toHaveBeenCalledExactlyOnceWith({
      origins: ['http://*.example.org/*'],
    });
    expect(coverage()).toEqual(['qwen.ai', 'example.org', 'notebooklm.google.com']);
    expect(otherWebsites()).toEqual(['qwen.ai', 'example.org', 'notebooklm.google.com']);
  });

  it('reports a removal the browser refused, and changes nothing', async () => {
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['claude.ai', 'qwen.ai'];
    grant(...coverageGrants('claude.ai'), ...coverageGrants('qwen.ai'));
    extensionApi.permissions.remove.mockResolvedValueOnce(false);
    await mount();

    await removeSite('claude');

    expect(coverage()).toEqual(['claude.ai', 'qwen.ai']);
    expect(siteRow('claude').textContent).toContain(en.siteAccessAllowed);
    expect(undoButton()).toBeUndefined();
    expect(toast().textContent).toBe(named(en.siteAccessRemoveFailed, 'Claude'));
  });

  it('reports a removed website whose grant the browser failed to remove, and keeps it listed', async () => {
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['example.org', 'qwen.ai'];
    grant(...coverageGrants('example.org'), ...coverageGrants('qwen.ai'));
    extensionApi.permissions.remove.mockRejectedValueOnce(new Error('not removed'));
    await mount();

    await removeWebsite('example.org');

    expect(coverage()).toEqual(['example.org', 'qwen.ai']);
    expect(otherWebsites()).toEqual(['example.org', 'qwen.ai']);
    expect(undoButton()).toBeUndefined();
    expect(toast().textContent).toBe(named(en.siteAccessRemoveFailed, 'example.org'));
  });

  it.each([
    ['refuses', () => extensionApi.permissions.request.mockResolvedValueOnce(false)],
    ['fails', () => extensionApi.permissions.request.mockRejectedValueOnce(new Error('closed'))],
  ])('reports an undo whose grant the browser %s, and leaves the site off', async (_, answer) => {
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['claude.ai', 'qwen.ai'];
    grant(...coverageGrants('claude.ai'), ...coverageGrants('qwen.ai'));
    await mount();
    await removeSite('claude');
    answer();

    await clickUndo();

    expect(coverage()).toEqual(['qwen.ai']);
    expect(siteRow('claude').textContent).toContain(en.siteAccessNotAllowed);
    // Said, not dropped in silence.
    expect(toast().textContent).not.toBe('');
    expect(undoButton()).toBeUndefined();
    expect(toast().textContent).toBe(named(en.siteAccessRestoreFailed, 'Claude'));
  });
});

describe('Other websites', () => {
  it('shows a website’s bundled logo, or else its initial, and fetches no icon', async () => {
    sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['qwen.ai', 'example.org'];
    grant(...coverageGrants('qwen.ai'), ...coverageGrants('example.org'));
    await mount();

    const [qwen, example] = otherWebsiteRows().map((row) => row.firstElementChild!);
    expect(qwen.querySelector('path')?.getAttribute('d')).toBe(PLATFORM_LOGOS.qwen.paths[0]);
    expect(example.querySelector('svg')).toBeNull();
    expect(example.textContent).toBe('E');
    expect(qwen.closest('section')!.querySelector('img')).toBeNull();
  });
});
