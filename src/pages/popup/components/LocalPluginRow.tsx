import { useState } from 'react';

import { Download, Trash2 } from 'lucide-react';

import { isScriptedManifest } from '@/features/plugins/scripted/types';
import type { TranslationKey } from '@/utils/translations';

import { Button } from '../../../components/ui/button';
import type { LocalPluginEntry } from '../hooks/useLocalPlugins';
import type { ScriptedCreations } from '../hooks/useScriptedCreations';
import { LocalPluginInspection } from './LocalPluginInspection';
import { LocalPluginIssueList as IssueList } from './LocalPluginIssueList';
import { ScriptedRowControls } from './scripted/ScriptedRowControls';
import { ScriptedBadge } from './scripted/ScriptedSource';
import { POPUP_SCRIPTED_LOOK } from './scripted/scriptedLook';

/**
 * One of the user's creations: inspect, export, or remove after a confirming
 * click. One that runs code also shows its state and turns on and off here.
 */
export function LocalPluginRow({
  entry,
  t,
  onExport,
  onRemove,
  scripted,
  activeUrl,
}: {
  entry: LocalPluginEntry;
  t: (key: TranslationKey) => string;
  onExport: (entry: LocalPluginEntry) => void;
  onRemove: (id: string) => void;
  scripted?: ScriptedCreations;
  activeUrl?: string;
}) {
  const code = entry.manifest && isScriptedManifest(entry.manifest) ? entry.manifest : null;
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const name =
    entry.manifest?.name ??
    (typeof entry.record.manifest.name === 'string' ? entry.record.manifest.name : entry.id);
  const version =
    entry.manifest?.version ??
    (typeof entry.record.manifest.version === 'string' ? entry.record.manifest.version : '');
  return (
    <div className="border-border/60 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-medium break-words">
            {name}
            {code && <ScriptedBadge look={POPUP_SCRIPTED_LOOK} t={t} />}
          </p>
          <p className="text-muted-foreground font-mono text-[10px] break-all">
            {version ? `${entry.id} · v${version}` : entry.id}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {entry.manifest && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="text-muted-foreground hover:text-foreground rounded px-1.5 py-1 text-[11px] font-medium transition-colors"
            >
              {open ? t('localPluginsHideDetails') : t('localPluginsInspect')}
            </button>
          )}
          <button
            type="button"
            onClick={() => onExport(entry)}
            title={t('pm_export')}
            aria-label={`${t('pm_export')} ${name}`}
            className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            title={t('localPluginsRemove')}
            aria-label={`${t('localPluginsRemove')} ${name}`}
            className="text-muted-foreground hover:text-destructive rounded p-1 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
      {code && scripted && (
        <ScriptedRowControls manifest={code} scripted={scripted} activeUrl={activeUrl} t={t} />
      )}
      {confirming && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
            {t('localPluginsCancel')}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => onRemove(entry.id)}>
            {t('localPluginsConfirmRemove')}
          </Button>
        </div>
      )}
      {!entry.manifest && (
        <div className="text-destructive/80 mt-1 text-[11px]">
          <p>{t('localPluginsStoredInvalid')}</p>
          <IssueList issues={entry.issues} />
        </div>
      )}
      {open && entry.manifest && <LocalPluginInspection manifest={entry.manifest} t={t} />}
    </div>
  );
}
