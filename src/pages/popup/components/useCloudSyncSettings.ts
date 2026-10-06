import { useCallback, useEffect, useState } from 'react';

import { StorageKeys } from '@/core/types/common';
import type { SyncMode, SyncPlatform, SyncProvider, SyncState } from '@/core/types/sync';
import { DEFAULT_SYNC_STATE } from '@/core/types/sync';
import { getVoyagerBuildTarget, isSafari } from '@/core/utils/browser';
import { deleteSafariICloudBackup } from '@/core/utils/safariICloudSync';
import { FOLDER_PLATFORMS, getFolderPlatformForHost } from '@/features/folder/platforms';
import { pushCatalogTimeline } from '@/features/timeline/catalogTimelineCloud';
import type { TranslationKey } from '@/utils/translations';

import { useLanguage } from '../../../contexts/LanguageContext';
import { type CloudRestoreMode, cloudRestoreFailureText } from './cloudRestore';
import { type CloudDownloadData, useCloudSyncTransfer } from './useCloudSyncTransfer';

function formatSyncTime(
  timestamp: number | null,
  direction: 'upload' | 'download',
  t: (key: TranslationKey) => string,
): string {
  if (!timestamp)
    return direction === 'upload' ? t('neverUploaded') || 'Never uploaded' : t('neverSynced');
  const date = new Date(timestamp);
  const diffMs = new Date().getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const time =
    diffMins < 1
      ? t('justNow')
      : diffMins < 60
        ? `${diffMins} ${t('minutesAgo')}`
        : diffHours < 24
          ? `${diffHours} ${t('hoursAgo')}`
          : diffDays === 1
            ? t('yesterday')
            : date.toLocaleDateString();
  const label = direction === 'upload' ? t('lastUploaded') || 'Uploaded {time}' : t('lastSynced');
  return label.replace('{time}', time);
}

/** Own popup sync state and user actions; Drive work stays in background messages. */
export function useCloudSyncSettings(sourceTabId?: number) {
  const { t } = useLanguage();
  const supportsICloud = getVoyagerBuildTarget() === 'safari' || isSafari();

  const [syncState, setSyncState] = useState<SyncState>(DEFAULT_SYNC_STATE);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    kind: 'ok' | 'warn' | 'err';
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDeletingICloudBackup, setIsDeletingICloudBackup] = useState(false);
  const [downloadMode, setDownloadMode] = useState<CloudRestoreMode | null>(null);
  const [platform, setPlatform] = useState<SyncPlatform>('gemini');
  // Tabs without a folder bucket render no sync controls.
  const [hasFolderPlatform, setHasFolderPlatform] = useState(true);
  const [highlightSyncEnabled, setHighlightSyncEnabled] = useState(true);

  const getTargetTab = useCallback(async (): Promise<chrome.tabs.Tab | undefined> => {
    if (typeof sourceTabId === 'number') {
      try {
        return await chrome.tabs.get(sourceTabId);
      } catch {}
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }, [sourceTabId]);

  const { prepareUpload, prepareDownload } = useCloudSyncTransfer(
    platform,
    highlightSyncEnabled,
    getTargetTab,
  );

  // Detect current platform from active tab URL
  const detectPlatform = useCallback(async (): Promise<SyncPlatform | null> => {
    try {
      const tab = await getTargetTab();
      if (!tab?.url) return 'gemini';
      const url = new URL(tab.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'gemini';
      return getFolderPlatformForHost(url.hostname);
    } catch (e) {
      console.warn('[CloudSyncSettings] Failed to detect platform:', e);
    }
    return 'gemini';
  }, [getTargetTab]);

  // Fetch sync state and detect platform on mount
  useEffect(() => {
    const fetchState = async () => {
      try {
        const [response, highlightSetting] = await Promise.all([
          chrome.runtime.sendMessage({ type: 'gv.sync.getState' }),
          chrome.storage.local.get({ [StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED]: true }),
        ]);
        if (response?.ok && response.state) {
          setSyncState(response.state);
        }
        setHighlightSyncEnabled(
          highlightSetting[StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED] !== false,
        );
      } catch (error) {
        console.error('[CloudSyncSettings] Failed to get sync state:', error);
      }
    };
    const initPlatform = async () => {
      const detected = await detectPlatform();
      setHasFolderPlatform(detected !== null);
      if (detected) setPlatform(detected);
    };
    fetchState();
    initPlatform();
  }, [detectPlatform]);

  // Handle mode change
  const handleModeChange = useCallback(async (mode: SyncMode) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'gv.sync.setMode',
        payload: { mode },
      });
      if (response?.ok && response.state) {
        setSyncState(response.state);
      }
    } catch (error) {
      console.error('[CloudSyncSettings] Failed to set sync mode:', error);
    }
  }, []);

  const handleProviderChange = useCallback(async (provider: SyncProvider) => {
    setStatusMessage(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'gv.sync.setProvider',
        payload: { provider },
      });
      if (response?.ok && response.state) {
        setSyncState(response.state);
      }
    } catch (error) {
      console.error('[CloudSyncSettings] Failed to set sync provider:', error);
    }
  }, []);

  const handleHighlightSyncChange = useCallback(async (enabled: boolean) => {
    setHighlightSyncEnabled(enabled);
    try {
      await chrome.storage.local.set({
        [StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED]: enabled,
      });
    } catch (error) {
      setHighlightSyncEnabled(!enabled);
      console.error('[CloudSyncSettings] Failed to save highlight sync setting:', error);
    }
  }, []);

  // Handle sign out
  const handleSignOut = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'gv.sync.signOut' });
      if (response?.ok && response.state) {
        setSyncState(response.state);
      }
    } catch (error) {
      console.error('[CloudSyncSettings] Sign out failed:', error);
    }
  }, []);

  const handleDeleteICloudBackup = useCallback(async () => {
    if (!window.confirm(t('syncDeleteICloudConfirm'))) return;

    setStatusMessage(null);
    setIsDeletingICloudBackup(true);
    try {
      const deleted = await deleteSafariICloudBackup();
      setStatusMessage({
        text: t('syncDeleteICloudSuccess').replace('{count}', String(deleted)),
        kind: 'ok',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage({
        text: t('syncDeleteICloudFailed').replace('{error}', message),
        kind: 'err',
      });
    } finally {
      setIsDeletingICloudBackup(false);
    }
  }, [t]);

  // Handle sync now (upload current data)
  const handleSyncNow = useCallback(async () => {
    setStatusMessage(null);
    setIsUploading(true);

    try {
      const payload = await prepareUpload();

      const response = (await chrome.runtime.sendMessage({
        type: 'gv.sync.upload',
        payload,
      })) as
        | {
            ok?: boolean;
            error?: string;
            state?: SyncState;
            highlights?: { synced?: boolean; skipped?: boolean };
          }
        | undefined;

      if (response?.state) {
        setSyncState(response.state);
      }

      if (response?.ok) {
        await pushCatalogTimeline((message) => chrome.runtime.sendMessage(message));
        setStatusMessage({
          text: t(response.highlights?.skipped ? 'syncSuccessHighlightsSkipped' : 'syncSuccess'),
          kind: response.highlights?.skipped ? 'warn' : 'ok',
        });
      } else {
        throw new Error(response?.error || response?.state?.error || t('syncUploadFailed'));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sync failed';
      console.error('[CloudSyncSettings] Sync failed:', error);
      setStatusMessage({ text: t('syncError').replace('{error}', errorMessage), kind: 'err' });
    } finally {
      setIsUploading(false);
    }
  }, [prepareUpload, t]);

  // Handle download from Drive (restore data) with merge as the default safe path.
  const handleDownloadFromDrive = useCallback(
    async (mode: CloudRestoreMode = 'merge') => {
      if (mode === 'overwrite' && !window.confirm(t('syncOverwriteConfirm'))) {
        return;
      }

      setStatusMessage(null);
      setIsDownloading(true);
      setDownloadMode(mode);

      try {
        const download = await prepareDownload();

        const response = (await chrome.runtime.sendMessage({
          type: 'gv.sync.download',
          payload: download.payload,
        })) as
          | {
              ok?: boolean;
              error?: string;
              state?: SyncState;
              highlights?: {
                synced?: boolean;
                skipped?: boolean;
                count?: number;
                empty?: boolean;
              };
              data?: CloudDownloadData | null;
            }
          | undefined;

        if (response?.state) {
          setSyncState(response.state);
        }

        if (!response?.ok) {
          throw new Error(response?.error || response?.state?.error || t('syncDownloadFailed'));
        }

        if (!response.data) {
          if (response.highlights?.synced) {
            setStatusMessage({ text: t('syncSuccess'), kind: 'ok' });
            return;
          }
          setStatusMessage({ text: t('syncNoData'), kind: 'err' });
          return;
        }

        const { foldersMissing, nameConflicts } = await download.restore(
          response.data,
          mode,
          response.highlights?.synced === true,
        );
        setStatusMessage({
          text:
            nameConflicts > 0
              ? t('promptNameConflictsDetected').replace('{count}', String(nameConflicts))
              : t(
                  foldersMissing
                    ? 'syncSuccessFoldersMissing'
                    : response.highlights?.skipped
                      ? 'syncSuccessHighlightsSkipped'
                      : 'syncSuccess',
                ),
          kind: foldersMissing || response.highlights?.skipped || nameConflicts > 0 ? 'warn' : 'ok',
        });
      } catch (error) {
        console.error('[CloudSyncSettings] Download failed:', error);
        setStatusMessage({ text: cloudRestoreFailureText(t, error), kind: 'err' });
      } finally {
        setIsDownloading(false);
        setDownloadMode(null);
      }
    },
    [prepareDownload, t],
  );

  // Clear status message after 3 seconds
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  return {
    syncState,
    statusMessage,
    supportsICloud,
    hasFolderPlatform,
    platform,
    highlightSyncEnabled,
    isUploading,
    isDownloading,
    isDeletingICloudBackup,
    downloadMode,
    lastUploadText: formatSyncTime(
      syncState[FOLDER_PLATFORMS[platform].lastUploadTimeField],
      'upload',
      t,
    ),
    lastSyncText: formatSyncTime(
      syncState[FOLDER_PLATFORMS[platform].lastSyncTimeField],
      'download',
      t,
    ),
    handleModeChange,
    handleProviderChange,
    handleHighlightSyncChange,
    handleSignOut,
    handleDeleteICloudBackup,
    handleSyncNow,
    handleDownloadFromDrive,
  };
}
