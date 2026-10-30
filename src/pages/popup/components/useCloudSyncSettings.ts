import { useCallback, useEffect, useState } from 'react';

import { readHighlightCloudSyncEnabled } from '@/core/services/highlightCloudSyncSetting';
import { StorageKeys } from '@/core/types/common';
import type { SyncMode, SyncPlatform, SyncProvider, SyncState } from '@/core/types/sync';
import { DEFAULT_SYNC_STATE } from '@/core/types/sync';
import { getVoyagerBuildTarget, isSafari } from '@/core/utils/browser';
import { googleDriveUnavailableOn } from '@/core/utils/googleDriveSignIn';
import { SafariICloudSyncError, deleteSafariICloudBackup } from '@/core/utils/safariICloudSync';
import { FOLDER_PLATFORMS, getFolderPlatformForHost } from '@/features/folder/platforms';
import type { TranslationKey } from '@/utils/translations';

import { useLanguage } from '../../../contexts/LanguageContext';
import { usePopupFormFactor } from '../hooks/usePopupFormFactor';
import { type CloudSyncStatus, useCloudSyncActions } from './useCloudSyncActions';
import { useCloudSyncTransfer } from './useCloudSyncTransfer';

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
  const { t, language } = useLanguage();
  const supportsICloud = getVoyagerBuildTarget() === 'safari' || isSafari();
  // Firefox for Android has no identity.launchWebAuthFlow, so Drive cannot sign in there.
  const googleDriveUnavailable = googleDriveUnavailableOn(usePopupFormFactor());

  const [syncState, setSyncState] = useState<SyncState>(DEFAULT_SYNC_STATE);
  const [statusMessage, setStatusMessage] = useState<CloudSyncStatus | null>(null);
  const [isDeletingICloudBackup, setIsDeletingICloudBackup] = useState(false);
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

  const transfer = useCloudSyncTransfer(platform, highlightSyncEnabled, getTargetTab);
  const { isUploading, isDownloading, downloadMode, undo, handleSyncNow, handleDownloadFromDrive } =
    useCloudSyncActions({ t, language, platform, transfer, setSyncState, setStatusMessage });

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

  // Safari signs in to Drive in the Voyager app, outside this popup: ask the native side again.
  const refreshNativeAuthorization = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'gv.sync.refreshAuthorization' });
      if (response?.ok && response.state) setSyncState(response.state);
    } catch (error) {
      console.warn('[CloudSyncSettings] Failed to refresh Drive authorization:', error);
    }
  }, []);

  // Fetch sync state and detect platform on mount
  useEffect(() => {
    const fetchState = async () => {
      try {
        // The reader never rejects, so a failed setting read keeps the sync state.
        const [response, highlightsEnabled] = await Promise.all([
          chrome.runtime.sendMessage({ type: 'gv.sync.getState' }),
          readHighlightCloudSyncEnabled(),
        ]);
        if (response?.ok && response.state) {
          setSyncState(response.state);
        }
        setHighlightSyncEnabled(highlightsEnabled);
      } catch (error) {
        console.error('[CloudSyncSettings] Failed to get sync state:', error);
      }
      // After the stored state, so its older answer never replaces the native one.
      if (supportsICloud) await refreshNativeAuthorization();
    };
    const initPlatform = async () => {
      const detected = await detectPlatform();
      setHasFolderPlatform(detected !== null);
      if (detected) setPlatform(detected);
    };
    fetchState();
    initPlatform();
  }, [detectPlatform, supportsICloud, refreshNativeAuthorization]);

  // The connect handoff leaves for the Voyager app; a popup still open asks again on return.
  useEffect(() => {
    if (!supportsICloud) return;
    const handleReturn = () => {
      if (document.visibilityState === 'visible') void refreshNativeAuthorization();
    };
    window.addEventListener('focus', handleReturn);
    document.addEventListener('visibilitychange', handleReturn);
    return () => {
      window.removeEventListener('focus', handleReturn);
      document.removeEventListener('visibilitychange', handleReturn);
    };
  }, [supportsICloud, refreshNativeAuthorization]);

  // The link itself opens the app; the background remembers that this connect was asked for.
  const handleConnectGoogleDrive = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'gv.sync.connectStarted' });
    } catch (error) {
      console.warn('[CloudSyncSettings] Failed to record the Drive connect:', error);
    }
  }, []);

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
      const progress =
        error instanceof SafariICloudSyncError && error.deleted !== null && error.deleted > 0
          ? `${t('syncDeleteICloudSuccess').replace('{count}', String(error.deleted))}\n`
          : '';
      setStatusMessage({
        text: progress + t('syncDeleteICloudFailed').replace('{error}', message),
        kind: 'err',
      });
    } finally {
      setIsDeletingICloudBackup(false);
    }
  }, [t]);

  // A plain success clears after 3 seconds; reasons, warnings and an Undo stay until the next action.
  const transient = statusMessage?.kind === 'ok' && !statusMessage.lines && !undo.offered;
  useEffect(() => {
    if (!transient) return;
    const timer = setTimeout(() => setStatusMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [statusMessage, transient]);

  return {
    syncState,
    statusMessage,
    supportsICloud,
    googleDriveUnavailable,
    hasFolderPlatform,
    platform,
    highlightSyncEnabled,
    isUploading,
    isDownloading,
    isDeletingICloudBackup,
    downloadMode,
    undo,
    lastUploadText: formatSyncTime(
      syncState[FOLDER_PLATFORMS[platform].lastUploadTimeField] ?? null,
      'upload',
      t,
    ),
    lastSyncText: formatSyncTime(
      syncState[FOLDER_PLATFORMS[platform].lastSyncTimeField] ?? null,
      'download',
      t,
    ),
    handleModeChange,
    handleProviderChange,
    handleHighlightSyncChange,
    handleSignOut,
    handleConnectGoogleDrive,
    handleDeleteICloudBackup,
    handleSyncNow,
    handleDownloadFromDrive,
  };
}
