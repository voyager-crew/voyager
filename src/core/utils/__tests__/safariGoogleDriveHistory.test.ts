import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSafariGoogleDriveFile,
  downloadSafariGoogleDriveFile,
  downloadSafariGoogleDriveText,
  listSafariGoogleDriveHistory,
  trashSafariGoogleDriveFile,
} from '../safariGoogleDrive';

const sendNativeMessage = vi.hoisted(() => vi.fn());
vi.mock('webextension-polyfill', () => ({ default: { runtime: { sendNativeMessage } } }));

interface NativeFile {
  name: string;
  appProperties: Record<string, string>;
  body: string;
  trashed: boolean;
}

const source = 'gemini-voyager-prompts.json';
const original = '  { future-or-invalid media, preserved verbatim }\n';
const createdTime = '2026-10-29T01:30:00.000Z';
let files: Map<string, NativeFile>;

beforeEach(() => {
  files = new Map([
    ['current', { name: source, appProperties: {}, body: original, trashed: false }],
  ]);
  sendNativeMessage.mockImplementation(async (_app: string, message: Record<string, unknown>) => {
    const id = typeof message.fileID === 'string' ? message.fileID : '';
    const file = files.get(id);
    switch (message.action) {
      case 'googleDriveCreateFile': {
        const next = `file-${files.size}`;
        if (
          typeof message.fileName !== 'string' ||
          typeof message.appProperties !== 'object' ||
          message.appProperties === null ||
          typeof message.json !== 'string'
        )
          throw new Error('Invalid native create request');
        const properties = Object.fromEntries(
          Object.entries(message.appProperties).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        );
        files.set(next, {
          name: message.fileName,
          appProperties: properties,
          body: message.json,
          trashed: false,
        });
        return { success: true, data: { fileID: next, name: message.fileName, createdTime } };
      }
      case 'googleDriveUploadFile':
        if (!file || typeof message.json !== 'string') throw new Error('Invalid native upload');
        file.body = message.json;
        return { success: true, data: { saved: true } };
      case 'googleDriveDownloadFile':
        return { success: true, data: { found: Boolean(file), json: file?.body } };
      case 'googleDriveListHistory':
        return {
          success: true,
          data: {
            files: [...files].flatMap(([fileID, entry]) =>
              !entry.trashed && entry.appProperties.voyagerHistorySource === message.sourceFileName
                ? [{ fileID, name: entry.name, createdTime }]
                : [],
            ),
          },
        };
      case 'googleDriveTrashFile':
        if (!file) throw new Error('Missing native file');
        file.trashed = true;
        return { success: true, data: { trashed: true } };
      default:
        throw new Error(`Unexpected native action ${String(message.action)}`);
    }
  });
});
afterEach(() => {
  sendNativeMessage.mockReset();
  vi.useRealTimers();
});

describe('Safari history media and metadata boundary', () => {
  it('keeps raw BOM bytes while parsed downloads remove only the leading BOM', async () => {
    const payload = { format: 'gemini-voyager.prompts.v1', items: [{ text: '\uFEFFinside text' }] };
    const body = `\uFEFF${JSON.stringify(payload, null, 2)}`;
    files.set('current', { name: source, appProperties: {}, body, trashed: false });

    await expect(downloadSafariGoogleDriveText('current')).resolves.toBe(body);
    await expect(downloadSafariGoogleDriveFile('current')).resolves.toEqual(payload);
  });

  it('preserves unknown old media exactly, discovers by source property, and trashes without deleting', async () => {
    const body = await downloadSafariGoogleDriveText('current');
    expect(body).toBe(original);
    if (body === null) throw new Error('Expected current media');
    const history = await createSafariGoogleDriveFile(
      'arbitrary-history-name.json',
      { voyagerHistorySource: source },
      body,
    );
    files.set('unmarked', {
      name: 'gemini-voyager-prompts.backup-2026-10-29-013000.json',
      appProperties: {},
      body: 'unrelated',
      trashed: false,
    });
    files.set('other-source', {
      name: 'arbitrary-second-name.json',
      appProperties: { voyagerHistorySource: 'another-source.json' },
      body: 'keep',
      trashed: false,
    });

    expect(files.get(history.id)).toMatchObject({
      appProperties: { voyagerHistorySource: source },
      body: original,
    });
    await expect(listSafariGoogleDriveHistory(source)).resolves.toEqual([
      { id: history.id, name: 'arbitrary-history-name.json', createdTime },
    ]);
    await trashSafariGoogleDriveFile(history.id);
    await expect(listSafariGoogleDriveHistory(source)).resolves.toEqual([]);
    expect(files.get(history.id)).toMatchObject({ body: original, trashed: true });
    expect(files.get('current')).toMatchObject({ body: original, trashed: false });
    expect(files.get('unmarked')).toMatchObject({ body: 'unrelated', trashed: false });
    expect(files.get('other-source')).toMatchObject({ body: 'keep', trashed: false });
  });

  it('keeps the server creation time when the client clock is behind existing backups', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2001-01-01T00:00:00.000Z'));

    await expect(
      createSafariGoogleDriveFile('history.json', { voyagerHistorySource: source }, original),
    ).resolves.toEqual({ id: 'file-1', name: 'history.json', createdTime });
    expect(sendNativeMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    { success: true, data: [] },
    { success: true, data: { files: 'invalid' } },
    { success: true, data: { files: [{ fileID: 'a', name: 'a', createdTime: false }] } },
    { success: true, data: { files: [{ fileID: 'a', name: 'a', createdTime: 'invalid' }] } },
  ])(
    'refuses malformed native history results before they can become a prune plan',
    async (response) => {
      sendNativeMessage.mockResolvedValue(response);
      await expect(listSafariGoogleDriveHistory(source)).rejects.toThrow();
      expect(files.get('current')).toMatchObject({ body: original, trashed: false });
    },
  );

  it.each([
    null,
    { success: true, data: [] },
    { success: true, data: { fileID: 'history' } },
    { success: true, data: { fileID: null, name: 'history.json', createdTime } },
    { success: true, data: { fileID: '', name: 'history.json', createdTime } },
    { success: true, data: { fileID: 'history', name: false, createdTime } },
    { success: true, data: { fileID: 'history', name: '', createdTime } },
    { success: true, data: { fileID: 'history', name: 'history.json', createdTime: false } },
    { success: true, data: { fileID: 'history', name: 'history.json', createdTime: 'invalid' } },
  ])('refuses a created history file without complete server metadata', async (response) => {
    sendNativeMessage.mockResolvedValue(response);
    await expect(
      createSafariGoogleDriveFile('history.json', { voyagerHistorySource: source }, original),
    ).rejects.toThrow();
  });

  it('does not treat an unsuccessful trash acknowledgement as success', async () => {
    sendNativeMessage.mockResolvedValueOnce({ success: true, data: { trashed: false } });
    await expect(trashSafariGoogleDriveFile('current')).rejects.toThrow();
  });
});
