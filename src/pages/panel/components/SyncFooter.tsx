import React, { useLayoutEffect, useRef } from 'react';

import {
  CloudDownload,
  CloudOff,
  CloudUpload,
  Ellipsis,
  History,
  TriangleAlert,
} from 'lucide-react';

import { guardCanMerge } from '@/core/services/cloudSyncNotices';
import type { AppLanguage } from '@/utils/language';
import type { TranslationKey } from '@/utils/translations';

import { guardLine, lastSyncedLabel, primaryLabel } from '../sync/syncCopy';
import type { SyncSheetState } from '../sync/useSyncSheet';
import { PanelMenu } from './PanelMenu';

type T = (key: TranslationKey) => string;

/** `{name}` placeholders filled with nodes, so a count can be bold or red inside one sentence. */
function fillNodes(template: string, values: Readonly<Record<string, React.ReactNode>>) {
  return template.split(/(\{\w+\})/).map((part, index) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return (
      <React.Fragment key={index}>
        {name && Object.hasOwn(values, name) ? values[name] : part}
      </React.Fragment>
    );
  });
}

/**
 * The shrink guard inline, in the shared guard copy: what the upload would
 * drop, 改为从云端合并 first (not offered when no cloud copy is readable),
 * 仍然上传 in red. Closing the sheet is its Cancel.
 */
function GuardWarning({ sheet, t }: { sheet: SyncSheetState; t: T }) {
  const first = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => first.current?.focus({ preventScroll: true }), []);
  const guard = sheet.guard;
  if (!guard) return null;
  const canMerge = guardCanMerge(guard.refused);
  return (
    <div className="warn" id="sync-foot" role="alert">
      {guard.refused.map((file) => {
        const line = guardLine(t, guard.row, file);
        return (
          <div key={file.kind} className="wl">
            <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />
            <span className="num">
              {'text' in line
                ? line.text
                : fillNodes(line.template, {
                    cloud: <b>{file.cloudCount}</b>,
                    local: (
                      <b className={file.localCount === 0 ? 'z' : undefined}>{file.localCount}</b>
                    ),
                  })}
            </span>
          </div>
        );
      })}
      <p>{t('syncGuardMessage')}</p>
      <div className="bt">
        <button
          ref={canMerge ? undefined : first}
          type="button"
          className="sec risk"
          onClick={() => sheet.choose('uploadAnyway')}
        >
          {t('syncGuardForce')}
        </button>
        {canMerge && (
          <button
            ref={first}
            type="button"
            className="pri"
            onClick={() => sheet.choose('mergeInstead')}
          >
            {t('syncGuardMerge')}
          </button>
        )}
      </div>
    </div>
  );
}

/** 恢复上一版 asks inline first; Cancel holds the focus. */
function RestoreAsk({ sheet, t }: { sheet: SyncSheetState; t: T }) {
  const cancel = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => cancel.current?.focus({ preventScroll: true }), []);
  return (
    <div className="warn" id="sync-foot">
      <div className="wl">
        <History size={16} strokeWidth={2} aria-hidden="true" />
        <span>{t('panelSyncRestoreAsk')}</span>
      </div>
      <div className="bt">
        <button
          ref={cancel}
          type="button"
          className="sec"
          onClick={() => sheet.setAskingRestore(false)}
        >
          {t('pm_cancel')}
        </button>
        <button type="button" className="pri" onClick={sheet.restore}>
          {t('panelSyncRestorePrevious')}
        </button>
      </div>
    </div>
  );
}

const MENU_ICONS = { up: CloudUpload, down: CloudDownload, restore: History, off: CloudOff };

/** Last sync on the start side, the ⋯ menu, and the one primary button. */
export function SyncFooter({
  sheet,
  language,
  t,
}: {
  sheet: SyncSheetState;
  language: AppLanguage;
  t: T;
}) {
  const more = useRef<HTMLButtonElement | null>(null);
  if (sheet.guard) return <GuardWarning sheet={sheet} t={t} />;
  if (sheet.askingRestore) return <RestoreAsk sheet={sheet} t={t} />;
  const count = sheet.pendingCount;
  const ago = sheet.statusRecordWarning
    ? t('syncReasonStatusRecord')
    : lastSyncedLabel(t, language, sheet.lastSynced);
  const idle = !sheet.running && !sheet.busy;
  const label = sheet.running
    ? t('panelSyncStatusSyncing')
    : count
      ? primaryLabel(language, count, sheet.mergeOnly)
      : sheet.unreadable
        ? t('panelSyncStatusFailed')
        : t('panelSyncUpToDate');
  const items = [
    { value: 'up', label: t('panelSyncUploadAll') },
    { value: 'down', label: t('panelSyncMergeAll') },
    { value: 'restore', label: t('panelSyncRestorePrevious') },
    { value: 'off', label: t('panelSyncDisconnect') },
  ] as const;
  return (
    <div className="sf" id="sync-foot">
      <span className="ago" title={ago}>
        {ago}
      </span>
      <button
        ref={more}
        type="button"
        className="ib"
        aria-label={t('panelSyncMore')}
        title={t('panelSyncMore')}
        aria-haspopup="menu"
        aria-expanded={sheet.menuOpen}
        disabled={!idle}
        onClick={() => sheet.setMenuOpen(!sheet.menuOpen)}
      >
        <Ellipsis size={17} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="pri"
        disabled={!idle || !count || !sheet.loaded}
        onClick={sheet.runPending}
      >
        {label}
      </button>
      <PanelMenu
        open={sheet.menuOpen}
        anchor={more}
        kind="action"
        align="end"
        label={t('panelSyncMore')}
        items={items.map((item) => {
          const Icon = MENU_ICONS[item.value];
          return {
            value: item.value,
            label: item.label,
            checked: false,
            leading: (
              <span className="lg" aria-hidden="true">
                <Icon size={16} strokeWidth={1.75} />
              </span>
            ),
          };
        })}
        onPick={(value) => {
          if (value === 'up') sheet.uploadAll();
          else if (value === 'down') sheet.mergeAll();
          else if (value === 'restore') sheet.setAskingRestore(true);
          else sheet.disconnect();
        }}
        onClose={() => sheet.setMenuOpen(false)}
      />
    </div>
  );
}
