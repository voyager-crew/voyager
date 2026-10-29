import React from 'react';

import { Download, Upload } from 'lucide-react';

import { CLOUD_SYNC_PATH, CLOUD_UPLOAD_PATH } from '@/core/icons/cloudSyncPaths';
import type { TranslationKey } from '@/utils/translations';

import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import type { PromptDataTransferController } from '../hooks/usePromptDataTransfer';
import { CloudSyncResultLine } from './CloudSyncResultLine';

export interface PromptDataTransferProps {
  transfer: PromptDataTransferController;
  t: (key: TranslationKey) => string;
}

/** The same Material Symbols paths used in the injected Gemini folder panel. */
function MaterialGlyphIcon({ path, className }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true" className={className}>
      <path d={path} />
    </svg>
  );
}

/** Shared prompt-library transfer controls for native and plugin platform popups. */
export function PromptDataTransfer({ transfer, t }: PromptDataTransferProps) {
  const {
    status,
    busy,
    undo,
    cloudUnavailable,
    inputRef,
    onExport,
    onImport,
    onCloudPull,
    onCloudPush,
  } = transfer;
  const locked = busy || undo.busy;

  return (
    <div className="space-y-2">
      <div>
        <Label className="text-sm font-medium">{t('promptDataMigration')}</Label>
        <p className="text-muted-foreground mt-1 text-xs">{t('promptDataMigrationHint')}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={locked}
          onClick={() => {
            void onExport();
          }}
        >
          <span className="inline-flex items-center gap-1.5">
            <Download className="h-3.5 w-3.5" />
            <span>{t('pm_export')}</span>
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={locked}
          onClick={() => inputRef.current?.click()}
        >
          <span className="inline-flex items-center gap-1.5">
            <Upload className="h-3.5 w-3.5" />
            <span>{t('pm_import')}</span>
          </span>
        </Button>
      </div>
      {cloudUnavailable && (
        <p className="text-muted-foreground text-xs">{t('syncGoogleDriveUnavailableAndroid')}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={locked || cloudUnavailable}
          onClick={() => {
            void onCloudPull();
          }}
        >
          <span className="inline-flex items-center gap-1.5">
            <MaterialGlyphIcon path={CLOUD_SYNC_PATH} className="h-3.5 w-3.5" />
            <span>{t('promptCloudPull')}</span>
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={locked || cloudUnavailable}
          onClick={(event) => {
            void onCloudPush(event.currentTarget);
          }}
        >
          <span className="inline-flex items-center gap-1.5">
            <MaterialGlyphIcon path={CLOUD_UPLOAD_PATH} className="h-3.5 w-3.5" />
            <span>{t('promptCloudPush')}</span>
          </span>
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        aria-label={t('pm_import')}
        accept=".json,application/json"
        className="hidden"
        onChange={(event) => {
          void onImport(event);
        }}
      />
      {status && (
        <CloudSyncResultLine
          {...status}
          align="start"
          undo={undo.offered || undo.busy ? { busy: undo.busy, run: undo.undo } : null}
          t={t}
        />
      )}
    </div>
  );
}
