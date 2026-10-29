import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureCloudSyncSnapshot } from '@/core/services/CloudSyncSnapshotService';
import { confirmDriver } from '@/tests/confirmDriver';
import { createMemoryStorage } from '@/tests/memoryStorage';
import type { TranslationKey } from '@/utils/translations';

import { PromptDataTransfer } from '../../components/PromptDataTransfer';
import { usePromptDataTransfer } from '../usePromptDataTransfer';

const TEMPLATES: Partial<Record<TranslationKey, string>> = {
  promptCloudPullSuccess: 'Pulled {count}',
  promptCloudPushSuccess: 'Pushed {count}',
  syncGuardUnrecognized: '{kind}: unrecognized',
};
const translate = (key: TranslationKey): string => TEMPLATES[key] ?? key;

function Card() {
  return <PromptDataTransfer t={translate} transfer={usePromptDataTransfer(translate, 'en')} />;
}

describe('Prompt Manager card cloud transfers', () => {
  let root: Root;
  let container: HTMLDivElement;
  const sendMessage = vi.fn<(message: { type: string; payload?: unknown }) => Promise<unknown>>();
  const button = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent?.trim() === label,
    );
  const status = () => container.querySelector('[role="status"]')?.textContent ?? '';
  const pushes = () =>
    sendMessage.mock.calls
      .filter(([message]) => message.type === 'gv.sync.pushPromptsMerge')
      .map(([message]) => message.payload);

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const memory = createMemoryStorage();
    vi.stubGlobal('chrome', {
      ...chrome,
      runtime: { ...chrome.runtime, id: 'test', lastError: null, sendMessage },
      storage: memory.api,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Card />));
  });
  afterEach(async () => {
    confirmDriver.pressEscape();
    await act(async () => root.unmount());
    container.remove();
    sendMessage.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('asks before replacing an unreadable cloud copy, and asks again on a new refusal', async () => {
    let refusals = 0;
    sendMessage.mockImplementation(async ({ payload }) => {
      const { guardToken } = payload as { guardToken?: string };
      if (guardToken === 'guard-2') return { ok: true, count: 3 };
      refusals += 1;
      return {
        ok: false,
        error: 'upload_guard_refused',
        guardToken: `guard-${refusals}`,
        refusedFiles: [
          { kind: 'prompts', localCount: 3, cloudCount: null, reason: 'unrecognized' },
        ],
      };
    });
    await act(async () => button('promptCloudPush')!.click());
    for (const round of [1, 2]) {
      await vi.waitFor(() => expect(confirmDriver.isOpen()).toBe(true));
      // Push merges, so only Upload anyway is offered.
      expect(confirmDriver.labels()).toEqual(['pm_cancel', 'syncGuardForce']);
      expect(confirmDriver.details()).toEqual(['promptDataMigration: unrecognized']);
      await act(async () => confirmDriver.answer('syncGuardForce'));
      if (round === 1) await vi.waitFor(() => expect(pushes()).toHaveLength(2));
    }
    await vi.waitFor(() => expect(status()).toContain('Pushed 3'));

    expect(pushes()).toEqual([
      { interactive: true },
      { interactive: true, force: true, guardToken: 'guard-1' },
      { interactive: true, force: true, guardToken: 'guard-2' },
    ]);
  });

  it('pushes nothing more when the confirm is cancelled', async () => {
    sendMessage.mockResolvedValue({
      ok: false,
      error: 'upload_guard_refused',
      guardToken: 'guard-1',
      refusedFiles: [{ kind: 'prompts', localCount: 3, cloudCount: null, reason: 'unrecognized' }],
    });
    await act(async () => button('promptCloudPush')!.click());
    await vi.waitFor(() => expect(confirmDriver.isOpen()).toBe(true));
    await act(async () => confirmDriver.answer('pm_cancel'));
    await vi.waitFor(() => expect(button('promptCloudPush')?.disabled).toBe(false));

    expect(pushes()).toHaveLength(1);
    expect(status()).toBe('');
  });

  it('keeps a pull’s result and Undo when only its bookkeeping failed', async () => {
    const snapshot = await captureCloudSyncSnapshot({
      context: { source: 'popup-restore', platform: 'gemini', accountScope: null },
      keys: [],
    });
    sendMessage.mockResolvedValue({
      ok: true,
      imported: 2,
      duplicates: 0,
      snapshotId: snapshot.id,
      warning: 'sync_bookkeeping_failed',
    });
    await act(async () => button('promptCloudPull')!.click());
    await vi.waitFor(() => expect(button('syncUndo')).toBeDefined());

    expect(status()).toContain('Pulled 2');
    expect(status()).toContain('syncReasonStatusRecord');
    expect(status()).not.toContain('sync_bookkeeping_failed');
  });

  it('names a known reason under a short title, without the raw code', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: 'not_authenticated' });
    await act(async () => button('promptCloudPull')!.click());
    await vi.waitFor(() => expect(status()).toContain('promptCloudFailed'));

    expect(status()).toContain('syncReasonSignIn');
    expect(status()).not.toContain('not_authenticated');
    // The generic title also asks to check the sign-in, so beside the reason it would repeat it.
    expect(status()).not.toContain('promptCloudError');
  });
});
