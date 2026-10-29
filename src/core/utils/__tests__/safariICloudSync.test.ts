import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkSafariICloudAccount,
  deleteSafariICloudBackup,
  getSafariICloudRetryDelay,
  readSafariICloudFile,
} from '../safariICloudSync';

const sendNativeMessage = vi.hoisted(() => vi.fn());

vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendNativeMessage } },
}));

afterEach(() => {
  sendNativeMessage.mockReset();
});

describe('Safari iCloud sync bridge', () => {
  it('a successful null download is refused rather than treated as a missing backup', async () => {
    sendNativeMessage.mockResolvedValue({ success: true, data: { found: true, json: 'null' } });
    await expect(readSafariICloudFile('gemini-voyager-stars.json')).rejects.toThrow(
      'invalid null data',
    );
  });

  it('checks the native iCloud account', async () => {
    sendNativeMessage.mockResolvedValue({ success: true, data: { available: true } });

    await expect(checkSafariICloudAccount()).resolves.toBeUndefined();
    expect(sendNativeMessage).toHaveBeenCalledWith('com.yourCompany.Gemini-Voyager', {
      action: 'iCloudAccountStatus',
    });
  });

  it('parses a downloaded sync file', async () => {
    sendNativeMessage.mockResolvedValue({
      success: true,
      data: { found: true, json: '{"items":[1]}' },
    });

    await expect(readSafariICloudFile('prompts.json')).resolves.toEqual({ items: [1] });
  });

  it('returns null when the iCloud record does not exist', async () => {
    sendNativeMessage.mockResolvedValue({ success: true, data: { found: false } });

    await expect(readSafariICloudFile('prompts.json')).resolves.toBeNull();
  });

  it('deletes every native iCloud backup record', async () => {
    sendNativeMessage.mockResolvedValue({ success: true, data: { deleted: 4 } });

    await expect(deleteSafariICloudBackup()).resolves.toBe(4);
    expect(sendNativeMessage).toHaveBeenCalledWith('com.yourCompany.Gemini-Voyager', {
      action: 'iCloudDeleteBackup',
    });
  });

  it('reports partial deletion progress and every native record error', async () => {
    sendNativeMessage.mockResolvedValue({
      success: true,
      data: {
        deleted: 804,
        errors: [
          { recordName: 'history-failed', error: 'Network unavailable', code: 'cloudkit_4' },
          {
            recordName: 'file-failed',
            error: 'Try again',
            code: 'icloud_temporarily_unavailable',
            retryAfterMs: 2500,
          },
        ],
      },
    });
    await expect(deleteSafariICloudBackup()).rejects.toMatchObject({
      deleted: 804,
      errors: [
        {
          recordName: 'history-failed',
          error: 'Network unavailable',
          code: 'cloudkit_4',
          retryAfterMs: null,
        },
        {
          recordName: 'file-failed',
          error: 'Try again',
          code: 'icloud_temporarily_unavailable',
          retryAfterMs: 2500,
        },
      ],
    });
  });

  it('surfaces native CloudKit errors', async () => {
    sendNativeMessage.mockResolvedValue({ success: false, error: 'iCloud is unavailable' });

    await expect(checkSafariICloudAccount()).rejects.toThrow('iCloud is unavailable');
  });

  it('preserves the native CloudKit retry delay', async () => {
    sendNativeMessage.mockResolvedValue({
      success: false,
      code: 'icloud_temporarily_unavailable',
      error: 'Try again shortly',
      retryAfterMs: 2500,
    });

    const error = await readSafariICloudFile('prompts.json').catch((caught) => caught);
    expect(getSafariICloudRetryDelay(error)).toBe(2500);
  });
});
