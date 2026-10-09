import React from 'react';

import type { SyncPlatform } from '@/core/types/sync';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';
import type { TranslationKey } from '@/utils/translations';

import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardTitle } from '../../../components/ui/card';
import { Label } from '../../../components/ui/label';
import { Switch } from '../../../components/ui/switch';
import { useLanguage } from '../../../contexts/LanguageContext';
import { IconChatGPT } from './WebsiteLogos';
import { useCloudSyncSettings } from './useCloudSyncSettings';

/**
 * CloudSyncSettings component for popup
 * Allows users to configure Google Drive sync settings
 */
interface CloudSyncSettingsProps {
  sourceTabId?: number;
}

const PLATFORM_PRESENTATION: Record<
  SyncPlatform,
  {
    labelKey: TranslationKey;
    logo: string | React.ComponentType;
  }
> = {
  gemini: {
    labelKey: 'platformGemini',
    logo: 'https://www.gstatic.com/lamda/images/gemini_sparkle_4g_512_lt_f94943af3be039176192d.png',
  },
  aistudio: {
    labelKey: 'platformAIStudio',
    logo: 'https://www.gstatic.com/images/branding/productlogos/ai_studio/v1/web-512dp/logo_ai_studio_color_1x_web_512dp.png',
  },
  chatgpt: { labelKey: 'platformChatGPT', logo: IconChatGPT },
};

export function CloudSyncSettings({ sourceTabId }: CloudSyncSettingsProps = {}) {
  const { t } = useLanguage();
  const {
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
    lastUploadText,
    lastSyncText,
    handleModeChange,
    handleProviderChange,
    handleHighlightSyncChange,
    handleSignOut,
    handleDeleteICloudBackup,
    handleSyncNow,
    handleDownloadFromDrive,
  } = useCloudSyncSettings(sourceTabId);

  const { labelKey, logo: Logo } = PLATFORM_PRESENTATION[platform];
  if (!hasFolderPlatform) return null;
  return (
    <Card className="p-3 transition-all hover:shadow-md">
      <CardTitle className="mb-2">{t('cloudSync')}</CardTitle>
      <CardContent className="space-y-3 p-0">
        {/* Description */}
        <p className="text-muted-foreground text-xs">
          {t(
            !FOLDER_PLATFORMS[platform].syncsSharedData
              ? syncState.provider === 'icloud'
                ? 'cloudSyncFoldersDescriptionICloud'
                : 'cloudSyncFoldersDescription'
              : syncState.provider === 'icloud'
                ? 'cloudSyncDescriptionICloud'
                : 'cloudSyncDescription',
          )}
        </p>

        {supportsICloud && (
          <div className="grid grid-cols-[auto_1fr] items-center gap-3">
            <Label className="text-sm font-medium">{t('syncProvider')}</Label>
            <div className="bg-secondary/60 grid grid-cols-2 gap-1 rounded-xl p-1">
              {(['googleDrive', 'icloud'] as const).map((provider) => (
                <button
                  key={provider}
                  className={`rounded-lg px-2 py-1.5 text-xs font-bold transition-colors ${
                    syncState.provider === provider
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => void handleProviderChange(provider)}
                  aria-pressed={syncState.provider === provider}
                >
                  {provider === 'icloud' ? t('syncProviderICloud') : t('syncProviderGoogleDrive')}
                </button>
              ))}
            </div>
          </div>
        )}

        {supportsICloud && syncState.provider === 'googleDrive' && !syncState.isAuthenticated && (
          <a
            className="border-primary/25 bg-primary/5 text-primary hover:bg-primary/10 flex h-9 w-full items-center justify-center rounded-lg border text-xs font-semibold transition-colors"
            href="gemini-voyager://google-drive-auth"
          >
            {t('syncConnectGoogleDrive')}
          </a>
        )}

        {/* Sync Mode Toggle */}
        <div className="grid grid-cols-[auto_1fr] items-center gap-3">
          <Label className="text-sm font-medium">{t('syncMode')}</Label>
          <div className="bg-secondary/60 relative grid grid-cols-2 gap-1 rounded-xl p-1">
            <div
              className="bg-primary pointer-events-none absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-lg shadow-sm transition-all duration-300 ease-out"
              style={{
                left: syncState.mode === 'disabled' ? '4px' : 'calc(50% + 2px)',
              }}
            />
            <button
              className={`relative z-10 rounded-lg px-2 py-1.5 text-xs font-bold transition-all duration-200 ${
                syncState.mode === 'disabled'
                  ? 'text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => handleModeChange('disabled')}
            >
              {t('syncModeDisabled')}
            </button>
            <button
              className={`relative z-10 rounded-lg px-2 py-1.5 text-xs font-bold transition-all duration-200 ${
                syncState.mode === 'manual'
                  ? 'text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => handleModeChange('manual')}
            >
              {t('syncModeManual')}
            </button>
          </div>
        </div>

        {FOLDER_PLATFORMS[platform].syncsConversationExtras && (
          <div className="highlight-cloud-sync-row border-border/70 bg-muted/30 gap-3 rounded-lg border px-3 py-2">
            <div className="min-w-0">
              <Label htmlFor="highlight-cloud-sync" className="cursor-pointer text-sm font-medium">
                {t('highlightCloudSync')}
              </Label>
              <p
                id="highlight-cloud-sync-hint"
                className="text-muted-foreground mt-0.5 text-xs leading-snug"
              >
                {t('highlightCloudSyncHint')}
              </p>
            </div>
            <div className="highlight-cloud-sync-control">
              <Switch
                id="highlight-cloud-sync"
                checked={highlightSyncEnabled}
                onChange={(event) => void handleHighlightSyncChange(event.target.checked)}
                aria-describedby="highlight-cloud-sync-hint"
              />
            </div>
          </div>
        )}

        {/* Sync Actions - Only show if not disabled */}
        {syncState.mode !== 'disabled' && (
          <>
            {/* Upload/Download Buttons */}
            <div className="grid gap-2">
              {/* Upload Button (Local → Drive) */}
              <Button
                variant="outline"
                size="sm"
                className="group hover:border-primary/50 w-full"
                onClick={handleSyncNow}
                disabled={isUploading || isDownloading}
              >
                <span className="flex items-center gap-1 text-xs transition-transform group-hover:scale-105">
                  {isUploading ? (
                    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  ) : (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                    </svg>
                  )}
                  {t('syncUpload')}
                </span>
              </Button>

              <div className="grid grid-cols-2 gap-2">
                {/* Sync Button (Drive → Local) */}
                <Button
                  variant="outline"
                  size="sm"
                  className="group hover:border-primary/50"
                  onClick={() => handleDownloadFromDrive('merge')}
                  disabled={isUploading || isDownloading}
                >
                  <span className="flex items-center gap-1 text-xs transition-transform group-hover:scale-105">
                    {downloadMode === 'merge' ? (
                      <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    ) : (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M1 4v6h6M23 20v-6h-6" />
                        <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
                      </svg>
                    )}
                    {t('syncMerge')}
                  </span>
                </Button>

                {/* Overwrite Button (Drive → Local, destructive) */}
                <Button
                  variant="outline"
                  size="sm"
                  className="group hover:border-destructive/50"
                  onClick={() => handleDownloadFromDrive('overwrite')}
                  disabled={isUploading || isDownloading}
                >
                  <span className="flex items-center gap-1 text-xs transition-transform group-hover:scale-105">
                    {downloadMode === 'overwrite' ? (
                      <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    ) : (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M3 12h18" />
                        <path d="M12 3v18" />
                      </svg>
                    )}
                    {t('syncOverwrite')}
                  </span>
                </Button>
              </div>
            </div>

            {/* Platform context & sync times */}
            <div
              data-testid="sync-platform-summary"
              className="border-border/60 bg-muted/25 relative isolate overflow-hidden rounded-xl border px-3 py-2.5"
            >
              <div className="relative z-10 min-w-0 pe-14">
                <p className="text-foreground/75 mb-1.5 flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                  <span
                    aria-hidden="true"
                    className="bg-primary/70 size-1.5 shrink-0 rounded-full"
                  />
                  <span className="sr-only">{t('currentPlatform')}: </span>
                  <span className="min-w-0 break-words">{t(labelKey)}</span>
                </p>

                <div className="text-muted-foreground grid min-w-0 gap-1 text-xs leading-snug">
                  <p className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-1.5">
                    <span aria-hidden="true" className="text-foreground/45">
                      ↑
                    </span>
                    <span className="min-w-0 break-words">{lastUploadText}</span>
                  </p>
                  <p className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-1.5">
                    <span aria-hidden="true" className="text-foreground/45">
                      ↓
                    </span>
                    <span className="min-w-0 break-words">{lastSyncText}</span>
                  </p>
                </div>
              </div>

              <div
                aria-hidden="true"
                data-testid="sync-platform-mark"
                className="pointer-events-none absolute inset-y-0 end-0 flex w-20 items-center justify-center overflow-hidden"
              >
                <div className="bg-primary/10 absolute inset-3 rounded-full blur-xl" />
                {typeof Logo !== 'string' ? (
                  <div className="size-16 opacity-[0.13] dark:opacity-[0.2]">
                    <Logo />
                  </div>
                ) : (
                  <img
                    src={Logo}
                    alt=""
                    draggable={false}
                    className="size-16 object-contain opacity-[0.13] saturate-75 select-none dark:opacity-[0.2] dark:saturate-100"
                  />
                )}
              </div>
            </div>

            {/* Sign Out Button - Only show if authenticated */}
            {syncState.provider === 'googleDrive' && syncState.isAuthenticated && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive w-full text-xs"
                onClick={handleSignOut}
              >
                {t('signOut')}
              </Button>
            )}
          </>
        )}

        {supportsICloud && syncState.provider === 'icloud' && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive w-full text-xs"
            onClick={handleDeleteICloudBackup}
            disabled={isUploading || isDownloading || isDeletingICloudBackup}
          >
            {isDeletingICloudBackup ? t('syncDeletingICloudBackup') : t('syncDeleteICloudBackup')}
          </Button>
        )}

        {/* Status Message */}
        {statusMessage && (
          <p
            className={`text-center text-xs ${
              statusMessage.kind === 'ok'
                ? 'text-green-600'
                : statusMessage.kind === 'warn'
                  ? 'text-amber-600'
                  : 'text-destructive'
            }`}
          >
            {statusMessage.text}
          </p>
        )}

        {/* Error Display */}
        {syncState.error && !statusMessage && (
          <p className="text-destructive text-center text-xs">
            {t('syncError').replace('{error}', syncState.error)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
