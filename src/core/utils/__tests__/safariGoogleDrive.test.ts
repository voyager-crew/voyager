import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SafariGoogleDriveError,
  downloadSafariGoogleDriveFile,
  ensureSafariGoogleDriveFile,
  findSafariGoogleDriveFile,
  getSafariGoogleDriveRetryDelay,
  isSafariGoogleDriveAuthError,
  requestSafariGoogleDriveSession,
  signOutSafariGoogleDrive,
  uploadSafariGoogleDriveText,
} from '../safariGoogleDrive';

const sendNativeMessage = vi.hoisted(() => vi.fn());

vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendNativeMessage } },
}));

afterEach(() => {
  sendNativeMessage.mockReset();
});

describe('Safari Google Drive native transport', () => {
  it('a successful null download is refused rather than treated as a missing backup', async () => {
    sendNativeMessage.mockResolvedValue({ success: true, data: { found: true, json: 'null' } });
    await expect(downloadSafariGoogleDriveFile('gemini-voyager-stars.json')).rejects.toThrow(
      'invalid null data',
    );
  });

  it('gets native session state without receiving an access token', async () => {
    sendNativeMessage.mockResolvedValue({
      success: true,
      data: { signedIn: true, requiresAppLaunch: false },
    });

    await expect(requestSafariGoogleDriveSession(false)).resolves.toEqual({
      signedIn: true,
      requiresAppLaunch: false,
    });
    expect(sendNativeMessage).toHaveBeenCalledWith('com.yourCompany.Gemini-Voyager', {
      action: 'googleDriveGetSession',
      interactive: false,
    });
  });

  it('finds and prepares files through native messages', async () => {
    sendNativeMessage
      .mockResolvedValueOnce({ success: true, data: { fileID: null } })
      .mockResolvedValueOnce({ success: true, data: { fileID: 'file-1' } });

    await expect(findSafariGoogleDriveFile('prompts.json')).resolves.toBeNull();
    await expect(ensureSafariGoogleDriveFile('prompts.json', 'cached-1')).resolves.toBe('file-1');
    expect(sendNativeMessage).toHaveBeenLastCalledWith('com.yourCompany.Gemini-Voyager', {
      action: 'googleDriveEnsureFile',
      fileName: 'prompts.json',
      cachedFileID: 'cached-1',
    });
  });

  it('preserves history text uploads and parses downloads at the bridge boundary', async () => {
    sendNativeMessage
      .mockResolvedValueOnce({ success: true, data: { saved: true } })
      .mockResolvedValueOnce({
        success: true,
        data: { found: true, json: '{"items":[1,2]}' },
      });

    await expect(uploadSafariGoogleDriveText('file-1', '{"items":[1,2]}')).resolves.toBeUndefined();
    expect(sendNativeMessage).toHaveBeenNthCalledWith(1, 'com.yourCompany.Gemini-Voyager', {
      action: 'googleDriveUploadFile',
      fileID: 'file-1',
      json: '{"items":[1,2]}',
    });
    await expect(downloadSafariGoogleDriveFile<{ items: number[] }>('file-1')).resolves.toEqual({
      items: [1, 2],
    });
  });

  it('returns null when the native download reports a missing file', async () => {
    sendNativeMessage.mockResolvedValue({
      success: true,
      data: { found: false },
    });

    await expect(downloadSafariGoogleDriveFile('missing')).resolves.toBeNull();
  });

  it('signs out through the native Google Sign-In session', async () => {
    sendNativeMessage.mockResolvedValue({ success: true, data: { signedOut: true } });

    await expect(signOutSafariGoogleDrive()).resolves.toBeUndefined();
    expect(sendNativeMessage).toHaveBeenCalledWith('com.yourCompany.Gemini-Voyager', {
      action: 'googleDriveSignOut',
    });
  });

  it('surfaces native configuration errors', async () => {
    sendNativeMessage.mockResolvedValue({ success: false, error: 'Missing client ID' });

    await expect(requestSafariGoogleDriveSession(true)).rejects.toThrow('Missing client ID');
  });

  it('preserves structured auth failure codes from the native bridge', async () => {
    sendNativeMessage.mockResolvedValue({
      success: false,
      error: 'Google Drive access must be authorized again. Open Voyager to reconnect.',
      code: 'drive_auth_required',
    });

    const failure = await uploadSafariGoogleDriveText('file-1', '{}').catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SafariGoogleDriveError);
    expect(isSafariGoogleDriveAuthError(failure)).toBe(true);
    expect(getSafariGoogleDriveRetryDelay(failure)).toBeNull();
  });

  it('exposes native retry hints for rate-limited requests', async () => {
    sendNativeMessage.mockResolvedValue({
      success: false,
      error: 'Google Drive is rate limiting requests. Try again shortly.',
      code: 'drive_rate_limited',
      retryAfterMs: 2500,
    });

    const failure = await downloadSafariGoogleDriveFile('file-1').catch((error: unknown) => error);
    expect(isSafariGoogleDriveAuthError(failure)).toBe(false);
    expect(getSafariGoogleDriveRetryDelay(failure)).toBe(2500);
  });
});
