import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Cloud,
  Layers,
  type LucideIcon,
  RefreshCw,
} from 'lucide-react';

import type { AppLanguage } from '@/utils/language';
import type { TranslationKey } from '@/utils/translations';

import { fillPlaceholders } from '../panelText';
import { STATUS_LABELS, unconfirmedLabel } from '../sync/syncCopy';
import type { SheetRow, SyncSheetState } from '../sync/useSyncSheet';
import { PanelSwitch } from './PanelSwitch';
import { SiteLogo } from './SiteMark';
import { SyncFooter } from './SyncFooter';

type T = (key: TranslationKey) => string;

const STATUS_ICONS: Readonly<Record<NonNullable<SheetRow['status']>, LucideIcon | null>> = {
  synced: Check,
  newer_here: ArrowUp,
  newer_in_cloud: ArrowDown,
  not_uploaded: ArrowUp,
  to_merge: RefreshCw,
  running: RefreshCw,
  failed: CircleAlert,
  excluded: null,
  account_unconfirmed: null,
};
/** The prototype's status classes: green check, spinning, or a direction in ink. */
const STATUS_TONES: Readonly<Record<NonNullable<SheetRow['status']>, string>> = {
  synced: 'ok',
  running: 'run',
  newer_here: 'up',
  newer_in_cloud: 'down',
  not_uploaded: 'new',
  to_merge: 'merge',
  failed: 'fail',
  excluded: '',
  account_unconfirmed: '',
};
/** The rows rise in on open; the prototype keeps the class for 0.9s. */
const ENTER_MS = 900;

function RowStatus({ row, t }: { row: SheetRow; t: T }) {
  if (row.unconfirmed) return <span className="st">{unconfirmedLabel(t)}</span>;
  const status = row.status;
  const key = status ? STATUS_LABELS[status] : undefined;
  if (!status || !key) return <span className="st" />;
  const Icon = STATUS_ICONS[status];
  const tone = STATUS_TONES[status];
  return (
    <span
      key={`${status}:${row.popped}`}
      className={`st ${tone}${row.popped ? ' pop' : ''}`.trim()}
    >
      {Icon && <Icon size={13} strokeWidth={2.2} aria-hidden="true" />}
      {t(key)}
    </span>
  );
}

function ConnectView({ sheet, t }: { sheet: SyncSheetState; t: T }) {
  const button = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (sheet.open) button.current?.focus({ preventScroll: true });
  }, [sheet.open]);
  return (
    <div className="connect">
      <span className="tile">
        <Cloud size={22} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p>{t('panelSyncConnectLine')}</p>
      <button
        ref={button}
        type="button"
        className="pri"
        disabled={sheet.connecting}
        onClick={sheet.connect}
      >
        {sheet.connecting ? t('panelSyncConnecting') : t('syncConnectGoogleDrive')}
      </button>
    </div>
  );
}

export interface SyncSheetProps {
  readonly sheet: SyncSheetState;
  readonly cloudButtonRef: React.RefObject<HTMLButtonElement | null>;
  /** 启用 beside a site that is off here: the 网站 tab with that site's row flashed. */
  readonly onEnableSite: (key: string) => void;
  readonly language: AppLanguage;
  readonly t: T;
}

/**
 * The 328px sync sheet under the cloud button, inside the panel so it moves
 * with it: 通用 and every enabled site with its status and switch, sites with
 * cloud data under a hairline, and the footer, the guard or the restore ask.
 */
export function SyncSheet({ sheet, cloudButtonRef, onEnableSite, language, t }: SyncSheetProps) {
  const root = useRef<HTMLDivElement | null>(null);
  const [entering, setEntering] = useState(false);
  const { open, close, connected } = sheet;

  useEffect(() => {
    if (!open) return undefined;
    setEntering(true);
    const timer = setTimeout(() => setEntering(false), ENTER_MS);
    return () => clearTimeout(timer);
  }, [open, connected]);

  // Focus moves in as it opens: the primary when it can run, else the first switch.
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const target =
      root.current.querySelector<HTMLElement>('.pri:not(:disabled)') ??
      root.current.querySelector<HTMLElement>('.sw') ??
      root.current.querySelector<HTMLElement>('.pri');
    target?.focus({ preventScroll: true });
  }, [open]);

  // A press outside the sheet, its button and its menu closes it.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (root.current?.contains(target) || cloudButtonRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.menu')) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [close, cloudButtonRef, open]);

  const listed = sheet.rows.length;
  return (
    <div
      ref={root}
      id="panel-sync-sheet"
      role="dialog"
      aria-label={t('cloudSync')}
      aria-hidden={open ? undefined : true}
      inert={!open}
      className={`sync${open ? ' open' : ''}${entering ? ' enter' : ''}`}
    >
      {sheet.loaded && !connected ? (
        <ConnectView sheet={sheet} t={t} />
      ) : (
        <>
          <div className="sh">
            <b>{t('cloudSync')}</b>
            <span>Google Drive</span>
          </div>
          {sheet.firstConnect && <p className="hint">{t('panelSyncFirstHint')}</p>}
          <div className="sl">
            {sheet.rows.map((row, index) => (
              <div
                key={row.key}
                className={row.included || row.unconfirmed ? 'sr' : 'sr off'}
                data-sync-row={row.key}
                style={{ '--d': index } as React.CSSProperties}
              >
                <span className="lg">
                  {row.logo ? (
                    <SiteLogo logo={row.logo} size={18} />
                  ) : (
                    <Layers size={18} strokeWidth={1.75} aria-hidden="true" />
                  )}
                </span>
                <span className="nm">
                  <span className="nt" title={row.label}>
                    {row.label}
                  </span>
                  {row.key === 'shared' && (
                    <small title={t('panelSyncSharedDetail')}>{t('panelSyncSharedDetail')}</small>
                  )}
                </span>
                <RowStatus row={row} t={t} />
                {!row.unconfirmed && (
                  <PanelSwitch
                    checked={row.included}
                    label={fillPlaceholders(t('panelSyncRowSwitch'), { site: row.label })}
                    onToggle={(next) => sheet.setIncluded(row.key, next)}
                  />
                )}
              </div>
            ))}
          </div>
          {sheet.idleRows.length > 0 && (
            <>
              <div className="sdiv" />
              <div className="sl">
                {sheet.idleRows.map((site, index) => (
                  <div
                    key={site.key}
                    className="sr idle"
                    style={{ '--d': listed + index } as React.CSSProperties}
                  >
                    <span className="lg">
                      {site.logo && <SiteLogo logo={site.logo} size={18} />}
                    </span>
                    <span className="nm">
                      <span className="nt" title={site.label}>
                        {site.label}
                      </span>
                    </span>
                    <span className="st">{t('panelSyncInCloud')}</span>
                    <button type="button" className="link" onClick={() => onEnableSite(site.key)}>
                      {t('panelSyncEnable')}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          <SyncFooter sheet={sheet} language={language} t={t} />
        </>
      )}
    </div>
  );
}
