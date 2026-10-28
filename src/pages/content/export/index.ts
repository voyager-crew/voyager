// Static imports to avoid CSP issues with dynamic imports in content scripts
import { StorageKeys } from '@/core/types/common';
import type { AppLanguage } from '@/utils/language';

import {
  getSavedImageExportWidth,
  saveImageExportWidth,
} from '../../../features/export/services/ImageExportPreferenceService';
import {
  SpeakerLabelPreferenceSaver,
  getSavedSpeakerLabelOverrides,
} from '../../../features/export/services/SpeakerLabelPreferenceService';
import { type ExportSpeakerLabels } from '../../../features/export/types/export';
import { ExportDialog } from '../../../features/export/ui/ExportDialog';
import { watchRouteChanges } from '../utils/routeWatcher';
import { watchConversationMenusForExport } from './conversationMenuExportObserver';
import { waitForElement } from './domWait';
import { startExportEntryGate } from './exportEntryGate';
import {
  type ExportDictionaries,
  createExportTranslator,
  loadExportDictionaries,
  readExportLanguage,
  translateExportOr,
  watchExportLanguage,
} from './exportLocale';
import { resolveExportLogoAnchor } from './exportLogoAnchor';
import { createExportRunner } from './exportRun';
import type { ExportEntryPoints, ExportSite } from './exportSite';
import { ensureGeneratedUiScreenshotPermission } from './generatedUiScreenshots';
import { type LogoExportButton, mountLogoExportButton } from './logoExportButton';
import { mountPersistentExportToolbar } from './persistentExportToolbar';
import { startResponseCopyImageActions } from './responseCopyImageAction';
import { openSidebarConversationForExport } from './sidebarConversationNavigation';
import { resolveExportSite } from './sites/resolveExportSite';

/** Mounts one export site's entry points and owns its dialog and active run. */
export function createExportEntrypoint(exportSite: ExportSite) {
  const exportRunner = createExportRunner({ site: exportSite });

  let activeExportDialog: ExportDialog | null = null;
  // A run cut by Gemini's preload reload resumes on the first mount of the page
  // only: a remount (the plugin switched off and on) must not restart a run the
  // switch abandoned.
  let pendingRunChecked = false;

  /**
   * Mount the export entry point for the current platform.
   *
   * The returned cleanup is platform-agnostic: the official plugin that owns
   * export on this host (ChatGPT's, Gemini's) calls it when it unmounts, and it
   * also ends the active run. Gemini's resume of a reloaded run starts here.
   */
  async function startExportButton(options: { signal?: AbortSignal } = {}): Promise<() => void> {
    // A mount aborted before it finished owns nothing; its late cleanup must not
    // touch the runner, which a newer mount may already be using.
    const noCleanup = () => {};
    if (options.signal?.aborted) return noCleanup;
    // Check for pending export immediately; the mount's abort ends the resumed run.
    if (exportSite.history && !pendingRunChecked) {
      pendingRunChecked = true;
      void exportRunner.resumePending(options.signal);
    }

    let lang = await readExportLanguage();
    if (options.signal?.aborted) return noCleanup;
    const dict = await loadExportDictionaries(lang);
    if (options.signal?.aborted) return noCleanup;
    const entryPoints = exportSite.entryPoints;

    if (entryPoints.kind === 'toolbar') {
      let toolbarHandle: ReturnType<typeof mountPersistentExportToolbar> | null = null;
      const mountToolbar = () => {
        const [label, tooltip] = entryPointTexts(dict, lang);
        toolbarHandle = mountPersistentExportToolbar({
          label,
          tooltip,
          onClick: () => void showExportDialog(dict, lang, { signal: options.signal }),
          siteId: exportSite.id,
          turnSelector: entryPoints.turnSelector,
        });
      };
      const unmountToolbar = () => {
        exportRunner.cancel();
        toolbarHandle?.remove();
        toolbarHandle = null;
        activeExportDialog?.hide();
        activeExportDialog = null;
      };
      // A host whose chat UI shares the origin with unrelated pages only gets
      // the entry point where a conversation can exist, and loses it again when
      // the SPA navigates away from one.
      const isConversationPage = entryPoints.isConversationPage;
      let stopEntryGate: () => void;
      if (isConversationPage) {
        stopEntryGate = startExportEntryGate({
          isEligible: () => isConversationPage(document, location.href),
          mount: mountToolbar,
          unmount: unmountToolbar,
          watchRoute: watchRouteChanges,
          root: document.body,
        });
      } else {
        mountToolbar();
        stopEntryGate = unmountToolbar;
      }
      const stopLanguage = watchExportLanguage((next) => {
        lang = next;
        toolbarHandle?.setText(...entryPointTexts(dict, next));
      });
      let stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        options.signal?.removeEventListener('abort', stop);
        stopEntryGate();
        stopLanguage();
      };
      options.signal?.addEventListener('abort', stop, { once: true });
      return stop;
    }

    return mountGeminiEntryPoints(entryPoints, dict, lang, options.signal);
  }

  /**
   * Gemini's entry points: the conversation / sidebar / response menu items, the
   * copy-as-image buttons, and the logo dropdown or, where the logo is gone, the
   * persistent toolbar. The returned stop removes all of them, ends the active
   * run and closes the dialog; the official plugin calls it when it unmounts.
   */
  async function mountGeminiEntryPoints(
    entryPoints: Extract<ExportEntryPoints, { kind: 'gemini' }>,
    dict: ExportDictionaries,
    initialLang: AppLanguage,
    signal: AbortSignal | undefined,
  ): Promise<() => void> {
    let lang = initialLang;
    const stops: Array<() => void> = [];
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      signal?.removeEventListener('abort', stop);
      exportRunner.cancel();
      activeExportDialog?.hide();
      activeExportDialog = null;
      for (const stopOne of stops.splice(0).reverse()) stopOne();
    };
    // Tear down the moment the plugin unmounts, not when this mount's startup
    // (the logo wait) settles: a remount in between would otherwise reuse the
    // page-wide watchers this late stop then disconnects.
    signal?.addEventListener('abort', stop, { once: true });
    const openDialog = (initialSelectedMessageId?: string | null) =>
      showExportDialog(dict, lang, { initialSelectedMessageId, signal });

    stops.push(
      watchConversationMenusForExport({
        label: () => translateExportOr(dict, lang, 'exportChatJson', 'Export conversation history'),
        onExport: (context) => {
          if (context.menuType === 'sidebar' && context.trigger) {
            const trigger = context.trigger;
            void (async () => {
              const opened = await openSidebarConversationForExport(
                trigger,
                entryPoints.userSelectors,
                createExportTranslator(dict, lang),
              );
              if (!opened) {
                return;
              }
              await openDialog();
            })();
            return;
          }
          if (context.menuType === 'message') {
            void openDialog(entryPoints.assistantMessageIdFor(context.trigger));
            return;
          }
          void openDialog();
        },
      }),
    );
    const copyImageActions = startResponseCopyImageActions({
      dict,
      language: () => lang,
      site: exportSite,
      assistantMessageIdFor: entryPoints.assistantMessageIdFor,
    });
    stops.push(copyImageActions.stop);

    let toolbarHandle: ReturnType<typeof mountPersistentExportToolbar> | null = null;
    let logoButton: LogoExportButton | null = null;
    stops.push(
      watchExportLanguage((next) => {
        lang = next;
        const [label, title] = entryPointTexts(dict, next);
        toolbarHandle?.setText(label, title);
        logoButton?.relabel({ title, label });
        copyImageActions.relabel();
      }),
    );

    // The lr26 UI removed the logo entirely; resolveExportLogoAnchor short-circuits
    // there instead of waiting out the full timeout (which delayed this fallback
    // toolbar by several seconds on every conversation load).
    const logo = await resolveExportLogoAnchor((selector, timeoutMs) =>
      waitForElement(selector, timeoutMs, signal),
    );
    if (signal?.aborted) return stop;
    if (logo) {
      logoButton = mountLogoExportButton(logo, {
        texts: () => {
          const [label, title] = entryPointTexts(dict, lang);
          return { title, label };
        },
        onClick: () => void openDialog(),
      });
      if (logoButton) stops.push(logoButton.remove);
      return stop;
    }

    // Fallback for lr26+ Gemini UI where the logo has been removed: mount a
    // persistent top-right toolbar so users still have an always-visible
    // export entry point. Menu injection (conversation ⋮ / response ⋮) still
    // runs in parallel via the observers above.
    const ensureToolbarVisibility = (enabled: boolean) => {
      if (enabled && !toolbarHandle) {
        const [label, tooltip] = entryPointTexts(dict, lang);
        toolbarHandle = mountPersistentExportToolbar({
          label,
          tooltip,
          onClick: () => void openDialog(),
          siteId: exportSite.id,
        });
      } else if (!enabled && toolbarHandle) {
        toolbarHandle.remove();
        toolbarHandle = null;
      }
    };
    stops.push(() => ensureToolbarVisibility(false));

    const onToolbarSettingChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'sync') return;
      const toolbarChange = changes[StorageKeys.PERSISTENT_EXPORT_TOOLBAR_ENABLED];
      if (toolbarChange && 'newValue' in toolbarChange) {
        ensureToolbarVisibility(toolbarChange.newValue !== false);
      }
    };
    const toolbarEnabled = await readToolbarEnabled();
    if (signal?.aborted || stopped) return stop;
    ensureToolbarVisibility(toolbarEnabled);
    try {
      chrome.storage?.onChanged?.addListener(onToolbarSettingChange);
      stops.push(() => {
        try {
          chrome.storage?.onChanged?.removeListener(onToolbarSettingChange);
        } catch {}
      });
    } catch {}
    return stop;
  }

  async function readToolbarEnabled(): Promise<boolean> {
    try {
      const stored = await new Promise<Record<string, unknown>>((resolve) => {
        try {
          chrome.storage?.sync?.get([StorageKeys.PERSISTENT_EXPORT_TOOLBAR_ENABLED], (items) =>
            resolve(items || {}),
          );
        } catch {
          resolve({});
        }
      });
      return stored[StorageKeys.PERSISTENT_EXPORT_TOOLBAR_ENABLED] !== false;
    } catch {
      return true;
    }
  }

  /** The export entry point's label and tooltip. */
  function entryPointTexts(dict: ExportDictionaries, lang: AppLanguage): [string, string] {
    return [
      translateExportOr(dict, lang, 'pm_export', 'Export'),
      translateExportOr(dict, lang, 'exportChatJson', 'Export chat history'),
    ];
  }

  async function showExportDialog(
    dict: ExportDictionaries,
    lang: AppLanguage,
    options?: {
      initialSelectedMessageId?: string | null;
      signal?: AbortSignal;
    },
  ): Promise<void> {
    if (options?.signal?.aborted) return;
    const t = createExportTranslator(dict, lang);
    const speakerDefaults: ExportSpeakerLabels = {
      user: t('export_speaker_user_default'),
      assistant: t('export_speaker_assistant_default'),
    };
    const [initialImageWidth, savedSpeakerLabelOverrides] = await Promise.all([
      getSavedImageExportWidth(),
      getSavedSpeakerLabelOverrides(),
    ]);
    if (options?.signal?.aborted) return;

    // We defer collection until after the export sequence (scrolling/refresh checks)

    const dialog = new ExportDialog();
    const speakerLabelPreferenceSaver = new SpeakerLabelPreferenceSaver();
    activeExportDialog = dialog;

    dialog.show({
      onExport: (format, fontSize, imageWidth, usePromptAsTurnHeading, speakerLabels) =>
        exportRunner.run(
          {
            format,
            fontSize,
            imageWidth,
            usePromptAsTurnHeading,
            speakerLabels,
            initialSelectedMessageId: options?.initialSelectedMessageId || undefined,
          },
          { dict, lang },
          async (signal) => {
            await speakerLabelPreferenceSaver.flush();
            if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
            await ensureGeneratedUiScreenshotPermission();
            if (format === 'image') {
              await saveImageExportWidth(imageWidth);
            }
          },
        ),

      onCancel: () => {
        void speakerLabelPreferenceSaver.flush();
        if (activeExportDialog === dialog) activeExportDialog = null;
      },
      onSpeakerLabelOverridesChange: (speakerLabelOverrides) => {
        speakerLabelPreferenceSaver.schedule(speakerLabelOverrides);
      },
      initialImageWidth,
      showPromptHeadingOption: true,
      initialSpeakerLabelOverrides: savedSpeakerLabelOverrides,
      speakerNames: {
        title: t('export_speaker_names'),
        userLabel: t('export_speaker_user_label'),
        assistantLabel: t('export_speaker_ai_label'),
        userDefault: speakerDefaults.user,
        assistantDefault: speakerDefaults.assistant,
      },
      translations: {
        title: t('export_dialog_title'),
        selectFormat: t('export_dialog_select'),
        warning: t('export_dialog_warning'),
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
  }

  return startExportButton;
}

// Resolve only when a native exporter mounts: importing export code on another
// host must not resolve that page using Gemini's DOM adapter.
let nativeEntrypoint: ReturnType<typeof createExportEntrypoint> | undefined;

/** Native exporters retain one runner and one preload-resume check per page. */
export async function startExportButton(
  options: { signal?: AbortSignal } = {},
): Promise<() => void> {
  if (options.signal?.aborted) return () => {};
  nativeEntrypoint ??= createExportEntrypoint(resolveExportSite());
  return nativeEntrypoint(options);
}

export default { startExportButton };
