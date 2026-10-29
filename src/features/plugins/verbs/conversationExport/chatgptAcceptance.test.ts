// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/abc" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExportFormat } from '@/features/export/types/export';

import {
  type AcceptancePage,
  FIXED_TIME,
  beginExport,
  confirmAll,
  fileText,
  openAcceptancePage,
  until,
} from './__tests__/chatgptAcceptanceHarness';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    runtime: { id: 'test-extension-id', getURL: (path: string) => path },
    i18n: { getUILanguage: () => 'en' },
  },
}));

let page: AcceptancePage | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_TIME);
  history.replaceState(null, '', '/c/abc');
  document.body.replaceChildren();
  const localeString = Date.prototype.toLocaleString;
  vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(
    function (this: Date, locales, options) {
      return localeString.call(this, locales, { ...options, timeZone: 'UTC' });
    },
  );
});

afterEach(async () => {
  await page?.close();
  page = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ChatGPT exported files through PluginHost', () => {
  it.each([ExportFormat.JSON, ExportFormat.MARKDOWN])('preserves raw %s bytes', async (format) => {
    page = await openAcceptancePage();
    await beginExport(format);
    await confirmAll();
    await until(() => page!.files.length === 1);
    const output = await fileText(page.files[0].blob);
    await expect(output).toMatchFileSnapshot(`./goldens/chatgpt-thread.${format}.golden`);
    expect(page.files[0].filename).toBe(`Voyager-测试.${format === 'json' ? 'json' : 'md'}`);
  });

  it('preserves the browser print DOM for PDF', async () => {
    page = await openAcceptancePage();
    await beginExport(ExportFormat.PDF);
    await confirmAll();
    await until(() => page!.printed.length === 1);
    await expect(page.printed[0]).toMatchFileSnapshot('./goldens/chatgpt-thread.print.html.golden');
    expect(page.files).toEqual([]);
  });
});
