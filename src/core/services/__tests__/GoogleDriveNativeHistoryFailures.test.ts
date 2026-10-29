import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createGuardDevice,
  guardEnvelope,
  guardFiles,
  guardPrompt,
  GUARD_TIME,
} from '@/pages/background/__tests__/fixtures/uploadGuardDevice';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(GUARD_TIME));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function unreadableNativeFolder(status: 503 | 401) {
  const d = await createGuardDevice({ safari: true });
  d.setLocal('prompts', 1);
  d.putCloud('prompts', 2);
  const history = 'gemini-voyager-prompts.backup-2026-10-29-110000.json';
  d.drive.put(history, guardEnvelope('prompts', [guardPrompt('previous')]));
  d.drive.metadata.set(history, {
    id: history,
    name: history,
    parents: ['sync-test-folder'],
    createdTime: GUARD_TIME,
    appProperties: { voyagerHistorySource: guardFiles.prompts },
  });
  await d.service.authenticate(false);

  const fetchDrive = d.drive.fetch;
  vi.spyOn(d.drive, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.searchParams.get('q')?.includes("mimeType='application/vnd.google-apps.folder'"))
      return new Response(null, { status });
    return fetchDrive(input, init);
  });
  const { default: browser } = await import('webextension-polyfill');
  const native = vi.mocked(browser.runtime.sendNativeMessage);
  const send = native.getMockImplementation();
  if (!send) throw new Error('Expected the native Drive fixture');
  native.mockImplementation(async (app, message: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'action' in message &&
      message.action === 'googleDriveListHistory'
    ) {
      // Model the native folder HTTP boundary; the Swift resolver is verified separately.
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q', "mimeType='application/vnd.google-apps.folder' and trashed=false");
      const discovery = await d.drive.fetch(url);
      if (!discovery.ok)
        return {
          success: false,
          error: `Google Drive folder discovery failed (${discovery.status})`,
          code: discovery.status === 401 ? 'drive_auth_required' : 'drive_temporarily_unavailable',
        };
    }
    return send(app, message);
  });
  return d;
}

describe('Safari native history discovery failures through the real service', () => {
  it('reports a 503 as read_failed without changing current media, history or local data', async () => {
    const d = await unreadableNativeFolder(503);
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);

    await expect(
      d.request('gv.sync.restorePreviousVersion', { files: [guardFiles.prompts] }),
    ).resolves.toMatchObject({
      ok: false,
      files: [{ name: guardFiles.prompts, status: 'read_failed' }],
    });
    await expect(d.service.getState()).resolves.toMatchObject({ isAuthenticated: true });
    expect(d.drive.files).toEqual(cloud);
    expect(d.drive.trashed.size).toBe(0);
    expect(d.values).toEqual(local);
  });

  it('ends the authenticated session on a 401 before any restore or history write', async () => {
    const d = await unreadableNativeFolder(401);
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);

    await expect(
      d.request('gv.sync.restorePreviousVersion', { files: [guardFiles.prompts] }),
    ).rejects.toMatchObject({ code: 'drive_auth_required' });
    await expect(d.service.getState()).resolves.toMatchObject({
      isAuthenticated: false,
      error: expect.stringContaining('401'),
    });
    expect(d.drive.files).toEqual(cloud);
    expect(d.drive.trashed.size).toBe(0);
    expect(d.values).toEqual(local);
  });
});
