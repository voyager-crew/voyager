// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/u/3/app/abc" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExportFormat } from '@/features/export/types/export';

import {
  FIXED_TIME,
  type GeminiAcceptancePage,
  beginExport,
  button,
  chooseFormat,
  confirmSelection,
  fileHex,
  fileText,
  imageInputs,
  markdownFile,
  openGeminiPage,
  until,
} from './__tests__/geminiAcceptanceHarness';

let page: GeminiAcceptancePage | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_TIME);
  history.replaceState(null, '', '/u/3/app/abc');
  document.body.replaceChildren();
  sessionStorage.clear();
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
  document.body.className = '';
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Gemini exports through its official PluginHost entry', () => {
  it.each([ExportFormat.JSON, ExportFormat.MARKDOWN])(
    'preserves the raw %s bytes',
    async (format) => {
      page = await openGeminiPage({ report: true });
      page.fixture.removeCanvasOnPreload();
      await beginExport(format);
      await confirmSelection();
      await until(() => page!.files.length === 1);
      const output =
        format === ExportFormat.MARKDOWN
          ? await markdownFile(page.files[0].blob)
          : await fileText(page.files[0].blob);
      await expect(output).toMatchFileSnapshot(`./goldens/gemini.${format}.golden`);
      if (format === ExportFormat.MARKDOWN)
        await expect(await fileHex(page.files[0].blob)).toMatchFileSnapshot(
          './goldens/gemini.markdown.zip.hex.golden',
        );
      expect(page.files[0].filename).toBe(`Voyager-测试.${format === 'json' ? 'json' : 'zip'}`);
    },
  );

  it('preserves the complete PDF print DOM', async () => {
    page = await openGeminiPage({ report: true });
    await beginExport(ExportFormat.PDF);
    await confirmSelection();
    await until(() => page!.printed.length === 1);
    await expect(page.printed[0]).toMatchFileSnapshot('./goldens/gemini.print.html.golden');
    expect(page.files).toEqual([]);
  });

  it('preserves the complete DOM handed to the image renderer', async () => {
    page = await openGeminiPage({ report: true });
    await beginExport(ExportFormat.IMAGE);
    await confirmSelection();
    await until(() => page!.files.length === 1);
    expect(imageInputs).toHaveLength(1);
    await expect(imageInputs[0]).toMatchFileSnapshot('./goldens/gemini.image.html.golden');
    expect(page.files[0].filename).toBe('Voyager-测试.png');
    expect(page.files[0].blob.type).toBe('image/png');
  });

  it.each(['conversation', 'sidebar'] as const)(
    'exports from the %s menu on an account route',
    async (entry) => {
      page = await openGeminiPage();
      if (entry === 'sidebar') history.pushState(null, '', '/u/3/app/other');
      const menu =
        entry === 'sidebar' ? page.fixture.openSidebarMenu() : page.fixture.openConversationMenu();
      await until(() => !!menu.querySelector('.gv-export-conversation-menu-btn'));
      button('.gv-export-conversation-menu-btn').click();
      await chooseFormat(ExportFormat.JSON);
      await confirmSelection();
      await until(() => page!.files.length === 1);
      expect(location.pathname).toBe('/u/3/app/abc');
      await expect(await fileText(page.files[0].blob)).toMatchFileSnapshot(
        './goldens/gemini.json.golden',
      );
    },
  );

  it('exports only the response selected from its menu', async () => {
    page = await openGeminiPage();
    const menu = page.fixture.openResponseMenu();
    await until(() => !!menu.querySelector('.gv-export-response-menu-btn'));
    button('.gv-export-response-menu-btn').click();
    await chooseFormat(ExportFormat.JSON);
    await confirmSelection(false);
    await until(() => page!.files.length === 1);
    await expect(await fileText(page.files[0].blob)).toMatchFileSnapshot(
      './goldens/gemini-response.json.golden',
    );
  });
});

describe('Gemini Deep Research exported report through PluginHost', () => {
  it.each([ExportFormat.JSON, ExportFormat.MARKDOWN, ExportFormat.PDF, ExportFormat.IMAGE])(
    'preserves %s output',
    async (format) => {
      page = await openGeminiPage({ report: true });
      const menu = page.fixture.openReportMenu();
      await until(() => !!menu.querySelector('.gv-deep-research-save-report'));
      vi.setSystemTime(FIXED_TIME);
      button('.gv-deep-research-save-report').click();
      await chooseFormat(format);
      if (format === ExportFormat.PDF) {
        await until(() => page!.printed.length === 1);
        await expect(page.printed[0]).toMatchFileSnapshot(
          './goldens/gemini-research.print.html.golden',
        );
      } else {
        await until(() => page!.files.length === 1);
        if (format === ExportFormat.IMAGE) {
          await expect(imageInputs[0]).toMatchFileSnapshot(
            './goldens/gemini-research.image.html.golden',
          );
        } else {
          const output =
            format === ExportFormat.MARKDOWN
              ? await markdownFile(page.files[0].blob)
              : await fileText(page.files[0].blob);
          await expect(output).toMatchFileSnapshot(`./goldens/gemini-research.${format}.golden`);
          if (format === ExportFormat.MARKDOWN)
            await expect(await fileHex(page.files[0].blob)).toMatchFileSnapshot(
              './goldens/gemini-research.markdown.zip.hex.golden',
            );
        }
      }
    },
  );
});
