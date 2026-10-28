import React from 'react';

import { PLATFORM_LOGOS, type PlatformLogo } from '@/core/icons/platformLogos';
import type { SyncPlatform } from '@/core/types/sync';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';
import { BUNDLED_SITE_ADAPTERS } from '@/features/plugins/catalog/sites';

import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardTitle } from '../../../components/ui/card';
import { Label } from '../../../components/ui/label';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { Switch } from '../../../components/ui/switch';
import { useLanguage } from '../../../contexts/LanguageContext';
import { IconChatGPT, IconClaude, IconDeepSeek } from './WebsiteLogos';
import { useCloudSyncSettings } from './useCloudSyncSettings';

/**
 * CloudSyncSettings component for popup
 * Allows users to configure Google Drive sync settings
 */
interface CloudSyncSettingsProps {
  sourceTabId?: number;
}

const PRESET_LOGOS: Partial<Record<SyncPlatform, string | React.ComponentType>> = {
  gemini: 'https://www.gstatic.com/lamda/images/gemini_sparkle_4g_512_lt_f94943af3be039176192d.png',
  aistudio:
    'https://www.gstatic.com/images/branding/productlogos/ai_studio/v1/web-512dp/logo_ai_studio_color_1x_web_512dp.png',
  chatgpt: IconChatGPT,
  claude: IconClaude,
  deepseek: IconDeepSeek,
};

function CloudSyncPlatformLogo({ platform }: { platform: string }) {
  const logos: Readonly<Record<string, PlatformLogo>> = PLATFORM_LOGOS;
  const logo = Object.hasOwn(logos, platform) ? logos[platform] : undefined;
  return logo ? (
    <svg viewBox={logo.viewBox} width="100%" height="100%" fill="currentColor">
      {logo.paths.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </svg>
  );
}

export function CloudSyncSettings({ sourceTabId }: CloudSyncSettingsProps = {}) {
  const { t } = useLanguage();
  const {
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

  if (!hasFolderPlatform) return null;
  const label = BUNDLED_SITE_ADAPTERS.find((site) => site.id === platform)?.label || platform;
  // Derived folder sites have no preset; catalog metadata must not crash the popup.
  const Logo = Object.hasOwn(PRESET_LOGOS, platform) ? PRESET_LOGOS[platform] : undefined;
  return (
    <Card className="p-4">
      <CardTitle className="mb-4">{t('cloudSync')}</CardTitle>
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

        {googleDriveUnavailable && (
          <p role="note" className="text-warning text-xs leading-snug">
            {t('syncGoogleDriveUnavailableAndroid')}
          </p>
        )}

        {supportsICloud && (
          <div className="grid grid-cols-[auto_1fr] items-center gap-3">
            <Label className="text-sm font-medium">{t('syncProvider')}</Label>
            <SegmentedControl
              aria-label={t('syncProvider')}
              options={[
                { value: 'googleDrive', label: t('syncProviderGoogleDrive') },
                { value: 'icloud', label: t('syncProviderICloud') },
              ]}
              value={syncState.provider}
              onChange={(provider) => void handleProviderChange(provider)}
            />
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

        {/* Sync Mode Toggle: shown but not usable where Drive cannot sign in. */}
        <fieldset
          disabled={googleDriveUnavailable}
          className={`grid min-w-0 grid-cols-[auto_1fr] items-center gap-3 ${googleDriveUnavailable ? 'opacity-50' : ''}`}
        >
          <Label className="text-sm font-medium">{t('syncMode')}</Label>
          <SegmentedControl
            aria-label={t('syncMode')}
            options={[
              { value: 'disabled', label: t('syncModeDisabled') },
              { value: 'manual', label: t('syncModeManual') },
            ]}
            value={syncState.mode === 'disabled' ? 'disabled' : 'manual'}
            onChange={(mode) => void handleModeChange(mode)}
          />
        </fieldset>

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
        {syncState.mode !== 'disabled' && !googleDriveUnavailable && (
          <>
            {/* Upload/Download Buttons */}
            <div className="grid gap-2">
              {/* Upload Button (Local → Drive) */}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleSyncNow}
                disabled={isUploading || isDownloading}
              >
                <span className="flex items-center gap-1 text-xs">
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
                  onClick={() => handleDownloadFromDrive('merge')}
                  disabled={isUploading || isDownloading}
                >
                  <span className="flex items-center gap-1 text-xs">
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
                  className="hover:text-destructive"
                  onClick={() => handleDownloadFromDrive('overwrite')}
                  disabled={isUploading || isDownloading}
                >
                  <span className="flex items-center gap-1 text-xs">
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
                  <span className="min-w-0 break-words">{label}</span>
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
                {typeof Logo !== 'string' ? (
                  <div className="size-16 opacity-[0.13] dark:opacity-[0.2]">
                    {Logo ? <Logo /> : <CloudSyncPlatformLogo platform={platform} />}
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
                ? 'text-success'
                : statusMessage.kind === 'warn'
                  ? 'text-warning'
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
