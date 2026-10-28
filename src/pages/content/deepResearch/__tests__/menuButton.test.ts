import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { ConversationExportService } from '@/features/export/services/ConversationExportService';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { toastDriver } from '@/tests/toastDriver';
import { setCachedLanguage } from '@/utils/i18n';
import * as translations from '@/utils/translations';

import { isDeepResearchReportMenuPanel } from '../menuButton';
import { activateGeminiDeepResearchExport } from '../pluginHandler';

let scope: PluginScope;
beforeEach(async () => {
  scope = new PluginScope();
  await setCachedLanguage('en');
});
afterEach(async () => {
  await scope.dispose();
  document.body.replaceChildren();
});

async function injectDownloadButton(panel: HTMLElement): Promise<void> {
  if (!document.querySelector('deep-research-immersive-panel')) {
    document.body.append(document.createElement('deep-research-immersive-panel'));
  }
  activateGeminiDeepResearchExport(scope);
  await vi.waitFor(() =>
    expect(panel.querySelector('.gv-deep-research-save-report')).not.toBeNull(),
  );
}

vi.mock('@/features/export/services/ImageExportPreferenceService', () => ({
  getSavedImageExportWidth: async () => 800,
  saveImageExportWidth: async () => {},
}));

function createNativeMenuButton({
  testId,
  label,
  iconName,
  buttonClassName,
  iconClassName,
}: {
  testId: string;
  label: string;
  iconName: string;
  buttonClassName: string;
  iconClassName: string;
}): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = buttonClassName;
  button.setAttribute('role', 'menuitem');
  button.setAttribute('tabindex', '0');
  button.setAttribute('data-test-id', testId);

  const icon = document.createElement('mat-icon');
  icon.className = iconClassName;
  icon.setAttribute('fonticon', iconName);
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '';

  const text = document.createElement('span');
  text.className = 'mat-mdc-menu-item-text';
  text.textContent = label;

  const ripple = document.createElement('div');
  ripple.className = 'mat-ripple mat-mdc-menu-ripple';
  ripple.setAttribute('matripple', '');

  button.appendChild(icon);
  button.appendChild(text);
  button.appendChild(ripple);
  return button;
}

function createDeepResearchReportMenuPanel(
  shareMarker = 'share-button-tooltip-container',
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'mat-mdc-menu-panel';
  panel.setAttribute('role', 'menu');

  const content = document.createElement('div');
  content.className = 'mat-mdc-menu-content';

  const shareContainer = document.createElement('div');
  shareContainer.setAttribute('data-test-id', shareMarker);
  const shareButtonWrapper = document.createElement('share-button');
  const shareButton = createNativeMenuButton({
    testId: 'share-button',
    label: 'Share',
    iconName: 'share',
    buttonClassName:
      'mat-mdc-menu-item mat-focus-indicator share-button menu-item-button ng-star-inserted',
    iconClassName:
      'mat-icon notranslate gds-icon-l google-symbols mat-ligature-font mat-icon-no-color',
  });
  shareButtonWrapper.appendChild(shareButton);
  shareContainer.appendChild(shareButtonWrapper);
  content.appendChild(shareContainer);

  const exportToDocs = document.createElement('export-to-docs-button');
  exportToDocs.setAttribute('data-test-id', 'export-to-docs-button');
  const docsButton = createNativeMenuButton({
    testId: 'export-to-docs-button',
    label: 'Export to Docs',
    iconName: 'docs',
    buttonClassName: 'mat-mdc-menu-item mat-focus-indicator menu-item-button ng-star-inserted',
    iconClassName:
      'mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color ng-star-inserted',
  });
  exportToDocs.appendChild(docsButton);
  content.appendChild(exportToDocs);

  const copyButton = document.createElement('copy-button');
  copyButton.setAttribute('data-test-id', 'copy-button');
  const nativeCopyButton = createNativeMenuButton({
    testId: 'copy-button',
    label: 'Copy contents',
    iconName: 'content_copy',
    buttonClassName:
      'mat-mdc-menu-item mat-focus-indicator copy-button menu-item-button ng-star-inserted',
    iconClassName: 'mat-icon notranslate google-symbols mat-ligature-font mat-icon-no-color',
  });
  copyButton.appendChild(nativeCopyButton);
  content.appendChild(copyButton);

  panel.appendChild(content);
  document.body.appendChild(panel);
  return panel;
}

describe('Deep Research export menu handler', () => {
  it('identifies deep research report share/export menu panel', () => {
    const panel = document.createElement('div');
    panel.className = 'mat-mdc-menu-panel';
    panel.setAttribute('role', 'menu');

    const content = document.createElement('div');
    content.className = 'mat-mdc-menu-content';

    const shareContainer = document.createElement('div');
    shareContainer.setAttribute('data-test-id', 'share-button-tooltip-container');
    content.appendChild(shareContainer);

    const exportToDocs = document.createElement('export-to-docs-button');
    exportToDocs.setAttribute('data-test-id', 'export-to-docs-button');
    content.appendChild(exportToDocs);

    const copyButton = document.createElement('copy-button');
    copyButton.setAttribute('data-test-id', 'copy-button');
    content.appendChild(copyButton);

    panel.appendChild(content);

    expect(isDeepResearchReportMenuPanel(panel)).toBe(true);
  });

  it.each([
    ['share-drive-button', 'export-to-docs-button'],
    ['share-classroom-button', 'copy-button'],
  ])('identifies report menu with %s and %s', (shareTestId, exportTestId) => {
    const panel = document.createElement('div');
    panel.className = 'mat-mdc-menu-panel';
    panel.setAttribute('role', 'menu');

    const content = document.createElement('div');
    content.className = 'mat-mdc-menu-content';

    for (const testId of [shareTestId, exportTestId]) {
      const action = document.createElement('button');
      action.setAttribute('data-test-id', testId);
      content.appendChild(action);
    }

    panel.appendChild(content);

    expect(isDeepResearchReportMenuPanel(panel)).toBe(true);
  });

  it('rejects report share actions without an export action', () => {
    const panel = document.createElement('div');
    panel.className = 'mat-mdc-menu-panel';
    panel.setAttribute('role', 'menu');

    const content = document.createElement('div');
    content.className = 'mat-mdc-menu-content';

    const shareAction = document.createElement('button');
    shareAction.setAttribute('data-test-id', 'share-drive-button');
    content.appendChild(shareAction);
    panel.appendChild(content);

    expect(isDeepResearchReportMenuPanel(panel)).toBe(false);
  });

  it('rejects generic export menu without deep research share actions', () => {
    const panel = document.createElement('div');
    panel.className = 'mat-mdc-menu-panel';
    panel.setAttribute('role', 'menu');

    const content = document.createElement('div');
    content.className = 'mat-mdc-menu-content';

    for (const testId of ['export-to-docs-button', 'copy-button']) {
      const action = document.createElement('button');
      action.setAttribute('data-test-id', testId);
      content.appendChild(action);
    }

    panel.appendChild(content);

    expect(isDeepResearchReportMenuPanel(panel)).toBe(false);
  });

  it('rejects sidebar conversation menu panel for deep research injection', () => {
    const panel = document.createElement('div');
    panel.className = 'mat-mdc-menu-panel';
    panel.setAttribute('role', 'menu');

    const content = document.createElement('div');
    content.className = 'mat-mdc-menu-content';

    const pin = document.createElement('button');
    pin.setAttribute('data-test-id', 'pin-button');
    content.appendChild(pin);

    const rename = document.createElement('button');
    rename.setAttribute('data-test-id', 'rename-button');
    content.appendChild(rename);

    panel.appendChild(content);

    expect(isDeepResearchReportMenuPanel(panel)).toBe(false);
  });

  it('updates both labels and tooltips from the cached language while the menu is open', async () => {
    const panel = createDeepResearchReportMenuPanel();
    await injectDownloadButton(panel);
    await setCachedLanguage('zh');
    const download = panel.querySelector<HTMLElement>('.gv-deep-research-download')!;
    const report = panel.querySelector<HTMLElement>('.gv-deep-research-save-report')!;
    expect(download.textContent).toContain('下载');
    expect(download.getAttribute('aria-label')).toBe(download.title);
    expect(report.textContent).toContain('保存报告');
    expect(report.getAttribute('aria-label')).toBe(report.title);
  });

  it('injects deep research export buttons using native menu item style baseline', async () => {
    const w = window as unknown as {
      chrome?: {
        storage?: {
          sync?: {
            get: (key: string, cb: (result: Record<string, unknown>) => void) => void;
          };
          onChanged?: {
            addListener: (fn: (...args: unknown[]) => void) => void;
            removeListener: (fn: (...args: unknown[]) => void) => void;
          };
        };
      };
    };
    w.chrome = {
      storage: {
        sync: {
          get: (_key, cb) => cb({}),
        },
        onChanged: {
          addListener: () => {},
          removeListener: () => {},
        },
      },
    };

    const panel = createDeepResearchReportMenuPanel();
    const templateButton = panel.querySelector(
      'export-to-docs-button button.mat-mdc-menu-item',
    ) as HTMLElement;
    const templateIcon = templateButton.querySelector('mat-icon') as HTMLElement;
    const templateText = templateButton.querySelector('.mat-mdc-menu-item-text') as HTMLElement;

    await injectDownloadButton(panel);

    const download = panel.querySelector('.gv-deep-research-download') as HTMLElement | null;
    const saveReport = panel.querySelector('.gv-deep-research-save-report') as HTMLElement | null;
    expect(download).toBeTruthy();
    expect(saveReport).toBeTruthy();

    const downloadIcon = download?.querySelector('mat-icon') as HTMLElement | null;
    const saveReportIcon = saveReport?.querySelector('mat-icon') as HTMLElement | null;
    const downloadText = download?.querySelector('.mat-mdc-menu-item-text') as HTMLElement | null;
    const saveReportText = saveReport?.querySelector(
      '.mat-mdc-menu-item-text',
    ) as HTMLElement | null;

    expect(downloadIcon?.className).toBe(templateIcon.className);
    expect(saveReportIcon?.className).toBe(templateIcon.className);
    expect(downloadText?.className).toBe(templateText?.className);
    expect(saveReportText?.className).toBe(templateText?.className);
    expect(saveReport?.textContent?.toLowerCase()).not.toContain('description');
  });

  it('injects both export actions into a report menu with direct share actions', async () => {
    const w = window as unknown as {
      chrome?: {
        storage?: {
          sync?: {
            get: (key: string, cb: (result: Record<string, unknown>) => void) => void;
          };
        };
      };
    };
    w.chrome = {
      storage: {
        sync: {
          get: (_key, cb) => cb({}),
        },
      },
    };

    const panel = createDeepResearchReportMenuPanel('share-drive-button');

    await injectDownloadButton(panel);

    expect(panel.querySelector('.gv-deep-research-download')).toBeTruthy();
    expect(panel.querySelector('.gv-deep-research-save-report')).toBeTruthy();
  });
});

describe('downloading Deep Research thinking content', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('shows the English empty-download warning when the export language cannot load', async () => {
    vi.spyOn(chrome.storage.sync, 'get').mockImplementation(
      (_keys: unknown, callback?: (result: Record<string, unknown>) => void) => {
        const stored = { [StorageKeys.LANGUAGE]: 'ja' };
        callback?.(stored);
        return Promise.resolve(stored);
      },
    );
    const panel = createDeepResearchReportMenuPanel();
    await injectDownloadButton(panel);
    vi.spyOn(translations, 'loadTranslations').mockRejectedValue(
      new Error('locale chunk unavailable'),
    );

    panel.querySelector<HTMLElement>('.gv-deep-research-download')!.click();

    await vi.waitFor(() =>
      expect(toastDriver.all()).toMatchObject([
        { message: 'No thinking content found to download.', tone: 'warning' },
      ]),
    );
    toastDriver.press(toastDriver.all()[0], 'Close');
  });

  it.each([
    { language: 'zh', message: '未找到可下载的 Thinking 内容。', close: '关闭' },
    {
      language: 'ja',
      message: 'ダウンロードできる思考内容が見つかりませんでした。',
      close: '閉じる',
    },
  ])(
    'an empty thinking download shows a visible warning in $language',
    async ({ language, message, close }) => {
      let currentLanguage = 'en';
      vi.spyOn(chrome.storage.sync, 'get').mockImplementation(
        (_keys: unknown, callback?: (result: Record<string, unknown>) => void) => {
          callback?.({ [StorageKeys.LANGUAGE]: currentLanguage });
          return Promise.resolve({ [StorageKeys.LANGUAGE]: currentLanguage });
        },
      );
      document.body.innerHTML = '<deep-research-immersive-panel></deep-research-immersive-panel>';
      const panel = createDeepResearchReportMenuPanel();
      await injectDownloadButton(panel);
      // A menu can remain open while the language changes; the notice follows the click's language.
      currentLanguage = language;
      panel.querySelector<HTMLElement>('.gv-deep-research-download')!.click();

      await vi.waitFor(() =>
        expect(toastDriver.all()).toMatchObject([{ message, tone: 'warning' }]),
      );
      toastDriver.press(toastDriver.all()[0], close);
      expect(toastDriver.all()).toEqual([]);
    },
  );
});

describe('saving a Deep Research report', () => {
  const SAFARI_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  async function exportReportAs(format: string): Promise<void> {
    (window as unknown as { chrome: unknown }).chrome = {
      storage: { sync: { get: (_key: string, cb: (result: object) => void) => cb({}) } },
    };
    document.body.innerHTML = `
      <deep-research-immersive-panel>
        <div class="markdown"><h1>Solar report</h1><p>Findings</p></div>
      </deep-research-immersive-panel>`;
    const panel = createDeepResearchReportMenuPanel();
    await injectDownloadButton(panel);
    panel.querySelector<HTMLElement>('.gv-deep-research-save-report')!.click();

    await vi.waitFor(() => expect(document.querySelector('.gv-export-dialog')).not.toBeNull());
    const radio = document.querySelector<HTMLInputElement>(`input[value="${format}"]`)!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    document.querySelector<HTMLButtonElement>('.gv-export-dialog-btn-primary')!.click();
  }

  it('opens the report dialog in the selected export language while the menu stays English', async () => {
    vi.spyOn(chrome.storage.sync, 'get').mockImplementation(
      (_keys: unknown, callback?: (result: Record<string, unknown>) => void) => {
        const stored = { [StorageKeys.LANGUAGE]: 'ja' };
        callback?.(stored);
        return Promise.resolve(stored);
      },
    );
    document.body.innerHTML = `
      <deep-research-immersive-panel>
        <div class="markdown"><h1>Solar report</h1><p>Findings</p></div>
      </deep-research-immersive-panel>`;
    const panel = createDeepResearchReportMenuPanel();
    await injectDownloadButton(panel);
    const button = panel.querySelector<HTMLElement>('.gv-deep-research-save-report')!;
    expect(button.textContent).toContain('Save Report');

    button.click();

    await vi.waitFor(() =>
      expect(document.querySelector('.gv-export-dialog')?.textContent).toContain('レポートを保存'),
    );
    expect(button.textContent).toContain('Save Report');
  });

  it('opens the report dialog in English when the export language cannot load', async () => {
    vi.spyOn(chrome.storage.sync, 'get').mockImplementation(
      (_keys: unknown, callback?: (result: Record<string, unknown>) => void) => {
        const stored = { [StorageKeys.LANGUAGE]: 'ja' };
        callback?.(stored);
        return Promise.resolve(stored);
      },
    );
    document.body.innerHTML = `
      <deep-research-immersive-panel>
        <div class="markdown"><h1>Solar report</h1><p>Findings</p></div>
      </deep-research-immersive-panel>`;
    const panel = createDeepResearchReportMenuPanel();
    await injectDownloadButton(panel);
    vi.spyOn(translations, 'loadTranslations').mockRejectedValue(
      new Error('locale chunk unavailable'),
    );

    panel.querySelector<HTMLElement>('.gv-deep-research-save-report')!.click();

    await vi.waitFor(() =>
      expect(document.querySelector('.gv-export-dialog')?.textContent).toContain('Save Report'),
    );
    expect(document.querySelector('.gv-export-dialog-btn-primary')?.textContent).toBe('Export');
  });

  it('shows a pending progress toast until the report export settles', async () => {
    let finish: (
      result: Awaited<ReturnType<typeof ConversationExportService.export>>,
    ) => void = () => {};
    vi.spyOn(ConversationExportService, 'export').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    await exportReportAs('json');

    await vi.waitFor(() =>
      expect(toastDriver.all()).toMatchObject([{ pending: true, role: 'status' }]),
    );
    finish({ success: true, format: 'json' } as Awaited<
      ReturnType<typeof ConversationExportService.export>
    >);
    await vi.waitFor(() => expect(toastDriver.all()).toEqual([]));
  });

  it('shows why the report export failed', async () => {
    vi.spyOn(ConversationExportService, 'export').mockResolvedValue({
      success: false,
      format: 'json',
      error: 'disk full',
    } as Awaited<ReturnType<typeof ConversationExportService.export>>);

    await exportReportAs('json');

    await vi.waitFor(() =>
      expect(toastDriver.all()).toMatchObject([
        { message: expect.stringContaining('disk full'), tone: 'error' },
      ]),
    );
  });

  it('guides Safari through saving the finished report PDF', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(SAFARI_UA);
    vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.');
    vi.spyOn(ConversationExportService, 'export').mockResolvedValue({
      success: true,
      format: 'pdf',
    } as Awaited<ReturnType<typeof ConversationExportService.export>>);

    await exportReportAs('pdf');

    await vi.waitFor(() =>
      expect(toastDriver.messages()).toEqual(['You can now press Command + P to export PDF.']),
    );
    expect(ConversationExportService.export).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ title: 'Solar report' }),
      expect.objectContaining({ format: 'pdf', filename: 'Solar-report.pdf' }),
    );
  });
});
