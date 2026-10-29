import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CloudUploadWrittenFile } from '@/core/types/syncUploadReceipt';

import { isSafariICloudConflictError } from '../safariICloudSync';
import {
  readICloudUploadVersion,
  undoICloudUpload,
  writeICloudUpload,
} from '../safariICloudUploadReceipt';

const sendNativeMessage = vi.hoisted(() => vi.fn());
vi.mock('webextension-polyfill', () => ({ default: { runtime: { sendNativeMessage } } }));

afterEach(() => sendNativeMessage.mockReset());

const name = 'gemini-voyager-prompts.json';
const written: CloudUploadWrittenFile = {
  name,
  fileId: name,
  md5Checksum: 'a'.repeat(32),
  replaced: { kind: 'history', historyId: 'history-exact-before-image' },
};

describe('Safari iCloud upload receipts', () => {
  it('reads exact bytes and the version from the same native read', async () => {
    const json = '\uFEFF  {"future":true}\r\n';
    sendNativeMessage.mockResolvedValue({
      success: true,
      data: { found: true, json, version: 'record-tag-7' },
    });
    await expect(readICloudUploadVersion(name)).resolves.toEqual({ json, version: 'record-tag-7' });
    expect(sendNativeMessage).toHaveBeenCalledExactlyOnceWith('com.yourCompany.Gemini-Voyager', {
      action: 'iCloudReadUploadVersion',
      fileName: name,
    });
  });

  it('distinguishes a missing record from an existing payload without a version', async () => {
    sendNativeMessage.mockResolvedValueOnce({ success: true, data: { found: false } });
    await expect(readICloudUploadVersion(name)).resolves.toEqual({ json: null, version: null });
    sendNativeMessage.mockResolvedValueOnce({ success: true, data: { found: true, json: '{}' } });
    await expect(readICloudUploadVersion(name)).rejects.toThrow('invalid');
  });

  it('binds a write to the preread version and never substitutes a later current-file read for its receipt', async () => {
    sendNativeMessage.mockResolvedValueOnce({ success: true, data: written });
    // History cleanup may read archives; it must never replace the receipt with a current-file GET.
    sendNativeMessage.mockResolvedValueOnce({
      success: true,
      data: {
        files: [{ id: 'history-exact-before-image', json: '{future format}', createdTime: 1 }],
      },
    });
    await expect(writeICloudUpload(name, { items: ['🛟'] }, 'record-tag-7')).resolves.toEqual(
      written,
    );
    expect(sendNativeMessage).toHaveBeenCalledWith('com.yourCompany.Gemini-Voyager', {
      action: 'iCloudWriteUpload',
      fileName: name,
      json: '{"items":["🛟"]}',
      expectedVersion: 'record-tag-7',
    });
    expect(sendNativeMessage).not.toHaveBeenCalledWith(
      'com.yourCompany.Gemini-Voyager',
      expect.objectContaining({ action: 'iCloudReadUploadVersion' }),
    );
  });

  it('keeps the original absence in a first-create request and receipt', async () => {
    const created = { ...written, replaced: { kind: 'created' } };
    sendNativeMessage.mockResolvedValue({ success: true, data: created });
    await expect(writeICloudUpload(name, {}, null)).resolves.toEqual(created);
    expect(sendNativeMessage.mock.calls[0]?.[1]).toMatchObject({ expectedVersion: null });
  });

  it.each([
    { ...written, name: 'another-account.json' },
    { ...written, fileId: 'another-account.json' },
    { ...written, md5Checksum: '' },
    { ...written, replaced: { kind: 'history' } },
    { saved: true },
  ])('rejects a success without a reversible receipt for this exact file', async (data) => {
    sendNativeMessage.mockResolvedValue({ success: true, data });
    await expect(writeICloudUpload(name, {}, 'record-tag-7')).rejects.toMatchObject({
      code: 'icloud_invalid_payload',
    });
    expect(sendNativeMessage).toHaveBeenCalledOnce();
  });

  it('preserves conflict and retry information for the parent upload planner', async () => {
    sendNativeMessage.mockResolvedValue({
      success: false,
      code: 'icloud_conflict',
      error: 'newer record',
      retryAfterMs: 2500,
    });
    const error = await writeICloudUpload(name, {}, 'old').catch((error: unknown) => error);
    expect(isSafariICloudConflictError(error)).toBe(true);
    expect(error).toMatchObject({ retryAfterMs: 2500 });
  });

  it.each([
    {
      name,
      status: 'restored',
      historyId: written.replaced.kind === 'history' ? written.replaced.historyId : '',
    },
    { name, status: 'kept' },
    { name, status: 'write_failed' },
  ])(
    'passes the exact receipt to native Undo and preserves its per-file result',
    async (result) => {
      sendNativeMessage.mockImplementation(async (_app, message) => ({
        success: true,
        data: message.action === 'iCloudReadHistory' ? { files: [] } : result,
      }));
      await expect(undoICloudUpload(written)).resolves.toEqual(result);
      expect(sendNativeMessage).toHaveBeenCalledWith('com.yourCompany.Gemini-Voyager', {
        action: 'iCloudUndoUpload',
        receipt: written,
      });
    },
  );

  it('returns removal of a first-created file', async () => {
    sendNativeMessage.mockResolvedValue({ success: true, data: { name, status: 'removed' } });
    await expect(undoICloudUpload({ ...written, replaced: { kind: 'created' } })).resolves.toEqual({
      name,
      status: 'removed',
    });
  });

  it('rejects Undo results that refer to a different file or before-image', async () => {
    sendNativeMessage.mockResolvedValueOnce({
      success: true,
      data: { name: 'other.json', status: 'kept' },
    });
    await expect(undoICloudUpload(written)).rejects.toThrow('invalid');
    sendNativeMessage.mockResolvedValueOnce({
      success: true,
      data: { name, status: 'restored', historyId: 'newest-unrelated-history' },
    });
    await expect(undoICloudUpload(written)).rejects.toThrow('invalid');
  });
});
