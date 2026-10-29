import { type ChangeEvent, type RefObject, useCallback, useRef, useState } from 'react';

import type { SyncScopeRow } from '@/core/services/CloudSyncScope';
import { reasonLines, undoNotice } from '@/core/services/cloudSyncNotices';
import { canUndoCloudSync } from '@/core/services/cloudSyncUndoOffer';
import type { UploadGuardRefusedFile } from '@/core/types/syncUploadGuard';
import { askUploadGuard } from '@/core/ui/cloudSyncGuardConfirm';
import { googleDriveUnavailableOn } from '@/core/utils/googleDriveSignIn';
import { PromptImportExportService } from '@/features/backup/services/PromptImportExportService';
import { createRuntimePromptLibraryClient } from '@/features/prompt/library/promptLibraryMessages';
import type { TranslationKey } from '@/utils/translations';

import { type CloudSyncUndo, useCloudSyncUndo } from '../components/useCloudSyncUndo';
import { popupConfirmTheme } from '../utils/popupConfirmTheme';
import { usePopupFormFactor } from './usePopupFormFactor';

type CloudResponse = {
  ok?: boolean;
  error?: string;
  excludedRows?: SyncScopeRow[];
  refusedFiles?: UploadGuardRefusedFile[];
  guardToken?: string;
};

export interface PromptDataTransferController {
  /** `lines` lists reasons, present only when there are any. */
  status: { kind: 'ok' | 'warn' | 'err'; text: string; lines?: string[] } | null;
  busy: boolean;
  /** Undo for the cloud pull that just ran. */
  undo: CloudSyncUndo;
  /** True where Google Drive cannot sign in (Firefox for Android); the cloud actions stay off. */
  cloudUnavailable: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onExport: () => Promise<void>;
  onImport: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onCloudPull: () => Promise<void>;
  /** `anchor` is the button the upload confirmation opens beside. */
  onCloudPush: (anchor?: HTMLElement) => Promise<void>;
}

function isEmptyPromptImportPayload(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (!value || typeof value !== 'object') return false;
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) && items.length === 0;
}

/** Keep this in the popup so a hidden panel retains pending operations and their status. */
export function usePromptDataTransfer(
  t: (key: TranslationKey) => string,
  language = 'en',
): PromptDataTransferController {
  const [status, setStatus] = useState<PromptDataTransferController['status']>(null);
  const [busy, setBusy] = useState(false);
  const undo = useCloudSyncUndo((result) => {
    const notice = undoNotice(t, result);
    setStatus({
      kind: notice.tone,
      text: notice.headline,
      ...(notice.lines.length ? { lines: [...notice.lines] } : {}),
    });
  });
  const { offer, withdraw } = undo;
  /**
   * A cloud failure. A known reason goes on its own line under a short title; without one the
   * card's generic error, which asks to check the Google Drive sign-in, stands alone.
   */
  const cloudError = useCallback(
    (error: unknown, excludedRows?: SyncScopeRow[]) => {
      const lines = reasonLines(t, error, excludedRows);
      setStatus(
        lines.length
          ? { kind: 'err', text: t('promptCloudFailed'), lines }
          : { kind: 'err', text: t('promptCloudError') },
      );
    },
    [t],
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Firefox for Android has no identity.launchWebAuthFlow, so Drive cannot sign in there.
  const cloudUnavailable = googleDriveUnavailableOn(usePopupFormFactor());

  const onExport = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await PromptImportExportService.loadPrompts();
      if (!result.success) throw result.error;

      const prompts = result.data;
      PromptImportExportService.downloadJSON(PromptImportExportService.exportToPayload(prompts));
      setStatus({
        kind: 'ok',
        text: t('promptExportSuccess').replace('{count}', String(prompts.length)),
      });
    } catch (error) {
      console.error('[Gemini Voyager] Failed to export prompts:', error);
      setStatus({ kind: 'err', text: t('promptExportError') });
    } finally {
      setBusy(false);
    }
  }, [t]);

  const onImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setBusy(true);
      setStatus(null);
      try {
        const readResult = await PromptImportExportService.readJSONFile(file);
        if (!readResult.success) throw readResult.error;

        const payloadResult = PromptImportExportService.validatePayload(readResult.data);
        if (!payloadResult.success) {
          setStatus({
            kind: 'err',
            text: isEmptyPromptImportPayload(readResult.data)
              ? t('pm_import_empty')
              : t('pm_import_invalid'),
          });
          return;
        }

        // The background owner merges it into the library as stored at that
        // moment, so a prompt or template saved on a tab meanwhile is kept.
        const { added, skipped, nameConflicts } = await createRuntimePromptLibraryClient().apply({
          kind: 'import',
          items: payloadResult.data.items,
        });
        setStatus({
          kind: nameConflicts > 0 ? 'warn' : 'ok',
          text:
            nameConflicts > 0
              ? t('promptNameConflictsDetected').replace('{count}', String(nameConflicts))
              : t('pm_import_success').replace('{count}', String(added + skipped)),
        });
      } catch (error) {
        console.error('[Gemini Voyager] Failed to import prompts:', error);
        setStatus({ kind: 'err', text: t('promptImportError') });
      } finally {
        event.target.value = '';
        setBusy(false);
      }
    },
    [t],
  );

  // The background owns the whole prompts-only Drive merge so opening the
  // Google account picker can close the popup without abandoning the operation.
  const onCloudPull = useCallback(async () => {
    if (cloudUnavailable) return;
    setBusy(true);
    setStatus(null);
    withdraw();
    let snapshotId: string | undefined;
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'gv.sync.pullPromptsMerge',
        payload: { interactive: true },
      })) as
        | (CloudResponse & {
            empty?: boolean;
            imported?: number;
            duplicates?: number;
            nameConflicts?: number;
            snapshotId?: string;
            /** The prompts landed; only recording the sync did not. */
            warning?: string;
          })
        | undefined;
      snapshotId = response?.snapshotId;
      const warnings = response?.warning ? [t('syncReasonStatusRecord')] : [];

      if (!response?.ok) {
        console.error('[Gemini Voyager] Cloud prompt pull failed:', response?.error);
        cloudError(response?.error ?? null, response?.excludedRows);
        return;
      }
      if (response.empty) {
        setStatus({
          kind: warnings.length ? 'warn' : 'ok',
          text: t('promptCloudPullEmpty'),
          ...(warnings.length ? { lines: warnings } : {}),
        });
        return;
      }

      const processed = (response.imported ?? 0) + (response.duplicates ?? 0);
      setStatus({
        ...(warnings.length ? { lines: warnings } : {}),
        kind: (response.nameConflicts ?? 0) > 0 || warnings.length ? 'warn' : 'ok',
        text:
          (response.nameConflicts ?? 0) > 0
            ? t('promptNameConflictsDetected').replace(
                '{count}',
                String(response.nameConflicts ?? 0),
              )
            : t('promptCloudPullSuccess').replace('{count}', String(processed)),
      });
    } catch (error) {
      console.error('[Gemini Voyager] Failed to pull prompts from cloud:', error);
      cloudError(error);
    } finally {
      setBusy(false);
      if (snapshotId && (await canUndoCloudSync(snapshotId))) offer(snapshotId);
    }
  }, [cloudError, cloudUnavailable, offer, t, withdraw]);

  const onCloudPush = useCallback(
    async (anchor?: HTMLElement) => {
      if (cloudUnavailable) return;
      setBusy(true);
      setStatus(null);
      withdraw();
      try {
        const push = (extra: Record<string, unknown> = {}) =>
          chrome.runtime.sendMessage({
            type: 'gv.sync.pushPromptsMerge',
            payload: { interactive: true, ...extra },
          }) as Promise<(CloudResponse & { count?: number; nameConflicts?: number }) | undefined>;
        let response = await push();
        // Push merges, so only a cloud file this build cannot read is refused: no merge to offer.
        // A token that no longer matches brings a new refusal, which asks again.
        while (response?.error === 'upload_guard_refused' && response.refusedFiles?.length) {
          const answer = await askUploadGuard({
            t,
            platform: 'gemini',
            refusedFiles: response.refusedFiles,
            anchor,
            ...popupConfirmTheme(language),
            allowMerge: false,
          });
          if (answer !== 'force') return;
          response = await push({
            force: true,
            ...(response.guardToken ? { guardToken: response.guardToken } : {}),
          });
        }

        if (!response?.ok) {
          console.error('[Gemini Voyager] Cloud prompt push failed:', response?.error);
          cloudError(response?.error ?? null, response?.excludedRows);
          return;
        }
        setStatus({
          kind: (response.nameConflicts ?? 0) > 0 ? 'warn' : 'ok',
          text:
            (response.nameConflicts ?? 0) > 0
              ? t('promptNameConflictsDetected').replace(
                  '{count}',
                  String(response.nameConflicts ?? 0),
                )
              : t('promptCloudPushSuccess').replace('{count}', String(response.count ?? 0)),
        });
      } catch (error) {
        console.error('[Gemini Voyager] Failed to push prompts to cloud:', error);
        cloudError(error);
      } finally {
        setBusy(false);
      }
    },
    [cloudError, cloudUnavailable, language, t, withdraw],
  );

  return {
    status,
    busy,
    undo,
    cloudUnavailable,
    inputRef,
    onExport,
    onImport,
    onCloudPull,
    onCloudPush,
  };
}
