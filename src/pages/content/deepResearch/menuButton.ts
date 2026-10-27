/**
 * Menu button injection module for Deep Research export
 */

import { logger } from '@/core/services/LoggerService';
import { ConversationExportService } from '@/features/export/services/ConversationExportService';
import {
  createContentExtractor,
  extractTurnContent,
} from '@/features/export/services/DOMContentExtractor';
import {
  getSavedImageExportWidth,
  saveImageExportWidth,
} from '@/features/export/services/ImageExportPreferenceService';
import type {
  ConversationMetadata,
  ChatTurn as ExportChatTurn,
  ExportFormat,
} from '@/features/export/types/export';
import { ExportDialog } from '@/features/export/ui/ExportDialog';
import { resolveExportErrorMessage } from '@/features/export/ui/ExportErrorMessage';
import {
  exportingProgressText,
  reportFinishedExport,
  showExportAlert,
  showExportProgress,
} from '@/features/export/ui/exportToasts';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/deep-research-packaged.json';
import type { Dispose, PluginScope } from '@/features/plugins/runtime/pluginScope';
import { getTranslationSync } from '@/utils/i18n';
import type { AppLanguage } from '@/utils/language';
import { TRANSLATIONS } from '@/utils/translations';

import { resolveExportAdapter } from '../export/adapter/platformAdapters';
import {
  type ExportDictionaries,
  createExportTranslator,
  readExportLanguage,
} from '../export/exportLocale';
import {
  createMenuItemFromNativeTemplate,
  updateMenuItemTemplateLabel,
} from '../shared/nativeMenuItemTemplate';
import { downloadMarkdown } from './download';
import { extractThinkingPanels } from './extractor';
import { formatToMarkdown } from './formatter';
import { extractDeepResearchReportTitle, findDeepResearchReportRoot } from './reportExtractor';

const DOWNLOAD_BUTTON_CLASS = 'gv-deep-research-download';
const SAVE_REPORT_BUTTON_CLASS = 'gv-deep-research-save-report';
const INJECTED_BUTTON_CLASSES = [DOWNLOAD_BUTTON_CLASS, SAVE_REPORT_BUTTON_CLASS];
const TEMPLATE_EXCLUDED_CLASS_NAMES = [...INJECTED_BUTTON_CLASSES, 'share-button'];

export interface DeepResearchMenuEntry {
  button: HTMLElement;
  release: Dispose;
}

export function updateDeepResearchMenuLabel(button: HTMLElement): void {
  const download = button.classList.contains(DOWNLOAD_BUTTON_CLASS);
  updateMenuItemTemplateLabel(
    button,
    getTranslationSync(download ? 'deepResearchDownload' : 'deepResearchSaveReport'),
    getTranslationSync(download ? 'deepResearchDownloadTooltip' : 'deepResearchSaveReportTooltip'),
  );
}

/**
 * Handle download button click
 */
async function handleDownload(dict: ExportDictionaries): Promise<void> {
  try {
    logger.debug('Extracting Deep Research thinking content');

    const content = extractThinkingPanels();
    if (!content) {
      console.warn('[Gemini Voyager] No thinking content found');
      // An empty download still needs a visible outcome, in the language selected at click time.
      const t = createExportTranslator(dict, await readExportLanguage());
      showExportAlert(t('deepResearchNoThinkingContent'), t, 'warning');
      return;
    }

    const markdown = await formatToMarkdown(content);
    downloadMarkdown(markdown);
  } catch (error) {
    console.error('[Gemini Voyager] Error handling download:', error);
  }
}

/**
 * Create menu button matching Material Design style
 */
function createMenuButtonFallback({
  text,
  tooltip,
  className,
  iconName,
}: {
  text: string;
  tooltip: string;
  className: string;
  iconName: string;
}): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `mat-mdc-menu-item mat-focus-indicator menu-item-button ${className}`;
  button.setAttribute('mat-menu-item', '');
  button.setAttribute('role', 'menuitem');
  button.setAttribute('tabindex', '0');
  button.setAttribute('aria-disabled', 'false');
  button.setAttribute('aria-label', tooltip);
  button.title = tooltip;

  // Create icon
  const icon = document.createElement('mat-icon');
  icon.className =
    'mat-icon notranslate menu-icon google-symbols mat-ligature-font mat-icon-no-color';
  icon.setAttribute('role', 'img');
  icon.setAttribute('fonticon', iconName);
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '';

  // Create text span
  const span = document.createElement('span');
  span.className = 'mat-mdc-menu-item-text';
  span.textContent = text;

  // Create ripple effect
  const ripple = document.createElement('div');
  ripple.className = 'mat-ripple mat-mdc-menu-ripple';
  ripple.setAttribute('matripple', '');

  button.appendChild(icon);
  button.appendChild(span);
  button.appendChild(ripple);

  return button;
}

function createMenuButton(
  scope: PluginScope,
  menuContent: HTMLElement,
  className: string,
  iconName: string,
  onClick: () => Promise<void>,
): DeepResearchMenuEntry {
  const download = className === DOWNLOAD_BUTTON_CLASS;
  const text = getTranslationSync(download ? 'deepResearchDownload' : 'deepResearchSaveReport');
  const tooltip = getTranslationSync(
    download ? 'deepResearchDownloadTooltip' : 'deepResearchSaveReportTooltip',
  );
  const button =
    createMenuItemFromNativeTemplate({
      menuContent,
      injectedClassName: className,
      iconName,
      label: text,
      tooltip,
      excludedClassNames: TEMPLATE_EXCLUDED_CLASS_NAMES,
    }) ?? createMenuButtonFallback({ text, tooltip, className, iconName });

  const release = scope.on(button, 'click', (event) => {
    if (scope.isDisposed || !button.isConnected) return;
    event.preventDefault();
    event.stopPropagation();
    // Only admission belongs to this scope: an accepted native export must finish after disable.
    void onClick().catch((error: unknown) => {
      console.error('[Gemini Voyager] Failed to start Deep Research export:', error);
    });
  });
  menuContent.appendChild(button);
  return { button, release };
}

function sanitizeFilenamePart(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/\.+$/g, '')
    .slice(0, 80);
  return cleaned || 'deep-research-report';
}

function buildReportFilename(format: ExportFormat, title: string): string {
  const base = sanitizeFilenamePart(title || 'deep-research-report');
  if (format === 'json') return `${base}.json`;
  if (format === 'markdown') return `${base}.md`;
  if (format === 'pdf') return `${base}.pdf`;
  return `${base}.png`;
}

function handleSaveReport(dict: ExportDictionaries, lang: AppLanguage): void {
  void (async () => {
    const reportRoot = findDeepResearchReportRoot();
    if (!reportRoot) {
      console.warn('[Gemini Voyager] Report content root not found');
      return;
    }

    const reportTitle = extractDeepResearchReportTitle(reportRoot);
    const metadata: ConversationMetadata = {
      url: location.href,
      exportedAt: new Date().toISOString(),
      count: 1,
      title: reportTitle,
    };

    const reportTurn: ExportChatTurn = {
      user: '',
      assistant: '',
      starred: false,
      omitEmptySections: true,
      assistantElement: reportRoot,
    };

    const initialImageWidth = await getSavedImageExportWidth();
    const t = createExportTranslator(dict, lang);
    const dialog = new ExportDialog();
    dialog.show({
      onExport: async (format, fontSize, imageWidth) => {
        const progress = showExportProgress(exportingProgressText(t));
        try {
          if (format === 'image') {
            await saveImageExportWidth(imageWidth);
          }
          const filename = buildReportFilename(format, reportTitle);
          // Deep Research is a Gemini-only surface; the Gemini dialect renders its $$ formulas.
          const turns = [
            extractTurnContent(reportTurn, createContentExtractor(resolveExportAdapter())),
          ];
          const resultPromise = ConversationExportService.export(turns, metadata, {
            format,
            filename,
            layout: 'document',
            fontSize,
            imageWidth,
          });
          const minVisiblePromise = new Promise((resolve) => setTimeout(resolve, 420));
          const [result] = await Promise.all([resultPromise, minVisiblePromise]);
          if (!result.success) {
            showExportAlert(resolveExportErrorMessage(result.error, t), t);
          } else {
            reportFinishedExport(result, format, t);
          }
        } catch (error) {
          console.error('[Gemini Voyager] Report export error:', error);
          showExportAlert(resolveExportErrorMessage(error, t), t);
        } finally {
          progress.hide();
        }
      },
      onCancel: () => {},
      initialImageWidth,
      speakerLabelsEnabled: false,
      translations: {
        title: t('deepResearchSaveReport'),
        selectFormat: t('export_dialog_select'),
        warning: '',
        safariCmdpHint: t('export_dialog_safari_cmdp_hint'),
        safariMarkdownHint: t('export_dialog_safari_markdown_hint'),
        cancel: t('pm_cancel'),
        export: t('pm_export'),
        fontSizeLabel: t('export_fontsize_label'),
        fontSizePreview: t('export_fontsize_preview'),
        imageWidthLabel: t('export_image_width_label'),
        imageWidthNarrow: t('export_image_width_narrow'),
        imageWidthMedium: t('export_image_width_medium'),
        imageWidthWide: t('export_image_width_wide'),
        promptHeadingLabel: t('export_markdown_prompt_heading'),
        promptHeadingHint: t('export_markdown_prompt_heading_hint'),
        formatRecommended: t('export_format_recommended'),
        formatDescriptions: {
          json: t('export_format_json_description'),
          markdown: t('export_format_markdown_description'),
          pdf: t('export_format_pdf_description'),
          image: t('export_format_image_description'),
        },
      },
    });
  })().catch((error: unknown) => {
    console.error('[Gemini Voyager] Failed to open report export dialog:', error);
  });
}

export function isDeepResearchReportMenuPanel(menuPanel: HTMLElement): boolean {
  if (!menuPanel.matches(packaged['deepResearch.menuPanel'])) return false;
  const menuContent = menuPanel.querySelector(packaged['deepResearch.menuContent']);
  if (!(menuContent instanceof HTMLElement)) return false;

  const hasReportShareActions = Boolean(
    menuContent.querySelector(packaged['deepResearch.menuShare']),
  );
  const hasReportExportActions = Boolean(
    menuContent.querySelector(packaged['deepResearch.menuExport']),
  );

  return hasReportShareActions && hasReportExportActions;
}

/** Synchronous labels and DOM; native export work begins only after a live click. */
export function injectDownloadButton(
  scope: PluginScope,
  menuPanel: HTMLElement,
): DeepResearchMenuEntry[] {
  if (scope.isDisposed || !menuPanel.isConnected || !isDeepResearchReportMenuPanel(menuPanel)) {
    return [];
  }
  const menuContent = menuPanel.querySelector<HTMLElement>(packaged['deepResearch.menuContent'])!;
  const entries: DeepResearchMenuEntry[] = [];
  if (!menuPanel.querySelector(`.${DOWNLOAD_BUTTON_CLASS}`)) {
    entries.push(
      createMenuButton(scope, menuContent, DOWNLOAD_BUTTON_CLASS, 'download', async () => {
        await handleDownload(TRANSLATIONS);
      }),
    );
  }
  if (!menuPanel.querySelector(`.${SAVE_REPORT_BUTTON_CLASS}`)) {
    entries.push(
      createMenuButton(scope, menuContent, SAVE_REPORT_BUTTON_CLASS, 'description', async () => {
        handleSaveReport(TRANSLATIONS, await readExportLanguage());
      }),
    );
  }
  return entries;
}
