import { afterEach, describe, expect, it, vi } from 'vitest';

import { readHighlightCloudSyncEnabled } from '../highlightCloudSyncSetting';

describe('readHighlightCloudSyncEnabled', () => {
  afterEach(() => {
    vi.mocked(chrome.storage.local.get).mockReset();
  });

  it('treats a failed read as off, so highlights the person may have kept out stay local', async () => {
    vi.mocked(chrome.storage.local.get).mockRejectedValue(new Error('storage unavailable'));

    await expect(readHighlightCloudSyncEnabled()).resolves.toBe(false);
  });
});
