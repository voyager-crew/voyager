import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { type TranslationKey, loadTranslations } from '@/utils/translations';

import { LocalPluginsPanel } from '../LocalPluginsPanel';
import { AUTHORED, button, fenced, field, flush, setValue } from './createModeTestKit';

const t = (key: string) => key;
const en = await loadTranslations('en');
const english = (key: string) => en[key as TranslationKey] ?? key;

describe('Create mode: one sentence → copied for an AI → pasted reply → preview → import', () => {
  let container: HTMLDivElement;
  let root: Root;
  let memory: Record<string, unknown>;
  let writeText: Mock;
  let fetchSpy: Mock;
  let openSpy: Mock;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    memory = {};
    (chrome.storage.local.get as unknown as Mock).mockImplementation(
      async (defaults: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const [key, fallback] of Object.entries(defaults)) {
          out[key] = key in memory ? structuredClone(memory[key]) : fallback;
        }
        return out;
      },
    );
    (chrome.storage.local.set as unknown as Mock).mockImplementation(
      async (items: Record<string, unknown>) => {
        Object.assign(memory, structuredClone(items));
      },
    );
    writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    openSpy = vi.fn();
    vi.stubGlobal('open', openSpy);
    (chrome.tabs.create as unknown as Mock).mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    // Voyager never sends, opens or fetches anything in this flow.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    (chrome.storage.local.get as unknown as Mock).mockReset();
    (chrome.storage.local.set as unknown as Mock).mockReset();
  });

  async function openComposer(activeUrl?: string, translate = t): Promise<void> {
    await act(async () => root.render(<LocalPluginsPanel t={translate} activeUrl={activeUrl} />));
    await flush();
  }

  async function checkReply(reply: string): Promise<void> {
    await act(async () => setValue(field(container, 'localPluginDescribeReplyPlaceholder'), reply));
    await act(async () => button(container, 'localPluginDescribeCheck').click());
    await flush();
  }

  async function writeRequest(request: string): Promise<void> {
    await act(async () =>
      setValue(field(container, 'localPluginDescribeRequestPlaceholder'), request),
    );
  }

  async function copy(label: string): Promise<void> {
    await act(async () => button(container, label).click());
    await flush();
  }

  it('shows the request field at rest and copies the chat message for the active tab’s site', async () => {
    await openComposer('https://claude.ai/chat/abc', english);
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toBe('Claude');
    expect(button(container, english('createModeCopyForChat')).disabled).toBe(true);

    await act(async () =>
      setValue(
        field(container, english('localPluginDescribeRequestPlaceholder')),
        'Make my messages narrower',
      ),
    );
    await copy(english('createModeCopyForChat'));
    const message = String(writeText.mock.lastCall?.[0]);
    expect(message).toContain('Make my messages narrower');
    expect(message).toContain('https://voyager.nagi.fun/create/claude.md');
    expect(message).toContain('```json');
    expect(container.textContent).toContain(english('localPluginDescribeCopied'));

    // A new site makes the copied text stale, so the button offers to copy again.
    await act(async () => setValue(select, 'chatgpt'));
    expect(container.textContent).not.toContain(english('localPluginDescribeCopied'));
    await copy(english('createModeCopyForChat'));
    expect(String(writeText.mock.lastCall?.[0])).toContain(
      'https://voyager.nagi.fun/create/chatgpt.md',
    );
  });

  it('copies a coding agent handoff that names the skill, the check and the files to import', async () => {
    await openComposer('https://chat.deepseek.com/', english);
    await act(async () =>
      setValue(field(container, english('localPluginDescribeRequestPlaceholder')), 'Hide the logo'),
    );
    await copy(english('createModeCopyForAgent'));
    const handoff = String(writeText.mock.lastCall?.[0]);
    expect(handoff).toContain('Hide the logo');
    expect(handoff).toContain('DeepSeek');
    expect(handoff).toContain('https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md');
    expect(handoff).toContain('npx create-voyager-plugin@latest check');
    expect(container.textContent).toContain(english('localPluginsImportFiles'));
    expect(container.textContent).toContain(english('createModeMoreWays'));
  });

  it('leaves the text on screen to copy by hand when the clipboard refuses it', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    await openComposer('https://claude.ai/new');
    await writeRequest('Narrower messages');
    await copy('createModeCopyForAgent');
    const fallback = container.querySelector<HTMLTextAreaElement>('textarea[readonly]');
    expect(fallback?.value).toBe(String(writeText.mock.lastCall?.[0]));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'localPluginDescribeCopyFailed',
    );
    expect(container.textContent).not.toContain('localPluginDescribeCopied');
  });

  it('shows why a reply was refused and stores nothing', async () => {
    await openComposer();

    await checkReply(`${fenced(AUTHORED)}\n\nOr this variant:\n${fenced(AUTHORED)}`);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'localPluginReplyMultipleJson',
    );

    await checkReply(
      fenced({
        ...AUTHORED,
        contributes: {
          domOps: [
            {
              op: 'setAttribute',
              target: 'a',
              name: 'href',
              value: 'https://example.com',
            },
          ],
        },
      }),
    );
    const alert = container.querySelector('[data-testid="local-plugin-reply-error"]');
    expect(alert?.textContent).toContain('localPluginsRejected');
    expect(alert?.textContent).toContain('contributes.domOps[0].name');
    expect(container.querySelector('[data-testid="local-plugin-preview"]')).toBeNull();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('previews a pasted reply in a fresh popup, imports it off, and warns on a re-import', async () => {
    // Nothing copied in this session: the popup closed while the user was in their AI tab.
    await openComposer();
    await checkReply(fenced(AUTHORED));

    const preview = container.querySelector('[data-testid="local-plugin-preview"]');
    expect(preview?.textContent).toContain('Narrow messages');
    expect(preview?.textContent).toContain('local.me.narrow · v1.0.0');
    expect(preview?.textContent).toContain('Claude');
    expect(preview?.textContent).toContain('localPluginChangeCss');
    expect(preview?.textContent).toContain('localPluginChangeAddClass');
    expect(preview?.textContent).toContain('localPluginPreviewLandsOff');
    // CSS is shown in full and flagged as not summarized.
    expect(preview?.querySelector('[data-testid="local-plugin-css"]')?.textContent).toContain(
      '.gv-plugin-narrow{max-width:640px}',
    );
    expect(container.querySelector('[data-testid="local-plugin-warnings"]')?.textContent).toBe(
      'localPluginPreviewWarningslocalPluginWarnCss',
    );
    // The technical inspect view is the same one shown after import.
    await act(async () => button(preview as HTMLElement, 'localPluginsInspect').click());
    expect(
      container.querySelector('[data-testid="local-plugin-inspection"]')?.textContent,
    ).toContain('addClass gv-plugin-narrow → semantic:userTurn');
    expect(
      container
        .querySelector('[data-testid="local-plugin-inspection"]')
        ?.querySelector('[data-testid="local-plugin-css"]')?.textContent,
    ).toContain('.gv-plugin-narrow{max-width:640px}');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    await act(async () => button(container, 'localPluginDescribeImport').click());
    await flush();
    const state = memory[StorageKeys.PLUGINS_STATE] as Record<string, { enabled: boolean }>;
    expect(state['local.me.narrow'].enabled).toBe(false);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'localPluginsImported',
    );
    expect(container.querySelector('[data-testid="local-plugin-preview"]')).toBeNull();

    // The same id again: the preview says it replaces the installed version.
    await checkReply(fenced({ ...AUTHORED, version: '1.1.0' }));
    expect(container.querySelector('[data-testid="local-plugin-warnings"]')?.textContent).toContain(
      'localPluginWarnReplaces',
    );
    await act(async () => button(container, 'localPluginDescribeImport').click());
    await flush();
    const stored = memory[StorageKeys.PLUGIN_LOCAL_MANIFESTS] as Record<
      string,
      { manifest: { version: string } }
    >;
    expect(stored['local.me.narrow'].manifest.version).toBe('1.1.0');
    expect(
      (memory[StorageKeys.PLUGINS_STATE] as Record<string, { enabled: boolean }>)['local.me.narrow']
        .enabled,
    ).toBe(false);
  });

  it('compares a pasted reply with the selected site, live, with nothing copied in this popup', async () => {
    // Fresh popup on Gemini: the site defaults to the active tab, nothing was copied here.
    await openComposer('https://gemini.google.com/app');
    await checkReply(fenced(AUTHORED));
    const warnings = () =>
      container.querySelector('[data-testid="local-plugin-warnings"]')?.textContent ?? '';
    expect(warnings()).toContain('localPluginWarnNotOnSite');

    // Picking the reply's own site clears the mismatch; the preview stays.
    const select = container.querySelector('select') as HTMLSelectElement;
    await act(async () => setValue(select, 'claude'));
    expect(container.querySelector('[data-testid="local-plugin-preview"]')).not.toBeNull();
    expect(warnings()).not.toContain('localPluginWarnNotOnSite');

    await act(async () => setValue(select, 'chatgpt'));
    expect(warnings()).toContain('localPluginWarnNotOnSite');
  });

  it('does not claim a mismatch with a site nobody picked', async () => {
    // No supported active tab and an untouched picker.
    await openComposer('chrome://newtab/');
    await checkReply(fenced(AUTHORED));
    expect(container.querySelector('[data-testid="local-plugin-preview"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="local-plugin-warnings"]')?.textContent,
    ).not.toContain('localPluginWarnNotOnSite');
  });

  it('does not overwrite a plugin installed after the preview; it asks for a new review', async () => {
    await openComposer();
    await checkReply(fenced(AUTHORED));
    expect(
      container.querySelector('[data-testid="local-plugin-warnings"]')?.textContent,
    ).not.toContain('localPluginWarnReplaces');

    // Another popup installs the same id while this preview is open.
    memory[StorageKeys.PLUGIN_LOCAL_MANIFESTS] = {
      'local.me.narrow': {
        manifest: { ...AUTHORED, id: 'local.me.narrow', version: '0.5.0' },
        importedAt: 1,
        updatedAt: 1,
      },
    };
    memory[StorageKeys.PLUGINS_STATE] = { 'local.me.narrow': { enabled: true, installedAt: 1 } };
    (chrome.storage.local.set as unknown as Mock).mockClear();

    await act(async () => button(container, 'localPluginDescribeImport').click());
    await flush();

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(container.textContent).toContain('localPluginChangedSinceReview');
    // The refreshed preview now names the version an import would replace.
    expect(container.querySelector('[data-testid="local-plugin-warnings"]')?.textContent).toContain(
      'localPluginWarnReplaces',
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  /** Hold every storage read until the returned release runs, as a slow storage would. */
  function holdStorageReads(): () => void {
    const read = (chrome.storage.local.get as unknown as Mock).getMockImplementation();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    (chrome.storage.local.get as unknown as Mock).mockImplementation(async (keys: unknown) => {
      await gate;
      return read?.(keys);
    });
    return release;
  }

  it('drops a changed-record import result once the reply was edited while it ran', async () => {
    await openComposer();
    await checkReply(fenced(AUTHORED));
    memory[StorageKeys.PLUGIN_LOCAL_MANIFESTS] = {
      'local.me.narrow': {
        manifest: { ...AUTHORED, id: 'local.me.narrow', version: '0.5.0' },
        importedAt: 1,
        updatedAt: 1,
      },
    };
    (chrome.storage.local.set as unknown as Mock).mockClear();

    const release = holdStorageReads();
    await act(async () => button(container, 'localPluginDescribeImport').click());
    await act(async () =>
      setValue(field(container, 'localPluginDescribeReplyPlaceholder'), 'a different reply'),
    );
    await act(async () => release());
    await flush();
    await flush();

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(field(container, 'localPluginDescribeReplyPlaceholder').value).toBe('a different reply');
    // No preview of the old reply under the new text, and no request to review it again.
    expect(container.querySelector('[data-testid="local-plugin-preview"]')).toBeNull();
    expect(container.textContent).not.toContain('localPluginChangedSinceReview');
    // Nothing was written, so no refusal shows under a reply that was never checked.
    expect(container.textContent).not.toContain('localPluginsRejected');
    expect(container.textContent).not.toContain('changed since it was reviewed');
    expect(button(container, 'localPluginDescribeCheck').disabled).toBe(false);
  });

  it('does not let Cancel race a pending import into bringing the preview back', async () => {
    await openComposer();
    await checkReply(fenced(AUTHORED));
    memory[StorageKeys.PLUGIN_LOCAL_MANIFESTS] = {
      'local.me.narrow': {
        manifest: { ...AUTHORED, id: 'local.me.narrow', version: '0.5.0' },
        importedAt: 1,
        updatedAt: 1,
      },
    };

    const release = holdStorageReads();
    await act(async () => button(container, 'localPluginDescribeImport').click());
    const cancel = button(container, 'localPluginsCancel');
    expect(cancel.disabled).toBe(true);
    await act(async () => cancel.click());
    await act(async () => release());
    await flush();
    await flush();

    // The import was refused, so the preview is refreshed and asks for a new review.
    expect(container.textContent).toContain('localPluginChangedSinceReview');
    await act(async () => button(container, 'localPluginsCancel').click());
    expect(container.querySelector('[data-testid="local-plugin-preview"]')).toBeNull();
  });

  it('lets the reply be checked again after Cancel closed a check that was still running', async () => {
    await openComposer();
    await checkReply(fenced(AUTHORED));

    const release = holdStorageReads();
    await act(async () => button(container, 'localPluginDescribeCheck').click());
    await act(async () => button(container, 'localPluginsCancel').click());
    await act(async () => release());
    await flush();
    await flush();

    expect(container.querySelector('[data-testid="local-plugin-preview"]')).toBeNull();
    expect(button(container, 'localPluginDescribeCheck').disabled).toBe(false);
  });

  it('keeps a reply edited while a successful import ran', async () => {
    await openComposer();
    await checkReply(fenced(AUTHORED));

    const release = holdStorageReads();
    await act(async () => button(container, 'localPluginDescribeImport').click());
    await act(async () =>
      setValue(field(container, 'localPluginDescribeReplyPlaceholder'), 'my next idea'),
    );
    await act(async () => release());
    await flush();
    await flush();

    expect(memory[StorageKeys.PLUGIN_LOCAL_MANIFESTS]).toHaveProperty(['local.me.narrow']);
    expect(field(container, 'localPluginDescribeReplyPlaceholder').value).toBe('my next idea');
    expect(container.querySelector('[data-testid="local-plugin-preview"]')).toBeNull();
    expect(button(container, 'localPluginDescribeCheck').disabled).toBe(false);
  });

  it('warns when the reply does not run on the site the message was copied for', async () => {
    await openComposer('https://chatgpt.com/');
    await writeRequest('Narrower messages');
    await copy('createModeCopyForChat');
    await checkReply(fenced(AUTHORED));
    expect(container.querySelector('[data-testid="local-plugin-warnings"]')?.textContent).toContain(
      'localPluginWarnNotOnSite',
    );
  });

  it('shows a long inline style in full, with its hiding warning, in the preview and inspect view', async () => {
    const value = `--gv-plugin-pad:${'0 '.repeat(150)};display:none`;
    const fill = (key: string) =>
      key === 'localPluginChangeSetAttribute' ? `${key} {name}="{value}"` : key;
    await openComposer(undefined, fill);
    await checkReply(
      fenced({
        ...AUTHORED,
        contributes: {
          domOps: [
            {
              op: 'setAttribute',
              target: { kind: 'semantic', key: 'composer' },
              name: 'style',
              value,
            },
          ],
        },
      }),
    );

    const preview = container.querySelector('[data-testid="local-plugin-preview"]');
    expect(preview?.textContent).toContain(`style="${value}"`);
    expect(container.querySelector('[data-testid="local-plugin-warnings"]')?.textContent).toContain(
      'localPluginWarnHides',
    );
    await act(async () => button(container, 'localPluginsInspect').click());
    expect(preview?.textContent).toContain(`setAttribute style="${value}"`);
  });
});
