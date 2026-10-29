import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { PlatformLogo } from '@/core/icons/platformLogos';
import { isSyncScopeIncluded, setSyncScopeRow } from '@/core/services/CloudSyncScope';
import { canUndoCloudSync } from '@/core/services/cloudSyncUndoOffer';
import type { UndoOffer, WithdrawUndoOffer } from '@/pages/popup/hooks/useUndoToast';
import type { AppLanguage } from '@/utils/language';
import type { TranslationKey } from '@/utils/translations';

import { ESCAPE_PRIORITY, useEscapeLayer } from '../hooks/escapeLayers';
import {
  type SheetEnvironment,
  canUndo,
  connectDrive,
  createStepRunner,
  disconnectDrive,
  loadSheet,
  restorePrevious,
  undoRun,
} from './syncActions';
import { restoredLabel, runFailureText, runUndoText, syncedLabel } from './syncCopy';
import { type RunKind, isPending, isSyncableRow, lastSyncedAt, planRun } from './syncPlan';
import { type RowStatus, sendSync } from './syncProtocol';
import { type RunState, startRunMachine } from './syncRunMachine';
import type { SheetPage } from './syncScopes';
import { EMPTY_SHEET, type SheetNotice, startSheetMachine } from './syncSheetMachine';
import { useMachine } from './useMachine';
import { useSyncScope } from './useSyncScope';

export interface SheetSite {
  readonly key: string;
  readonly label: string;
  readonly logo: PlatformLogo | null;
}

export type CloudMark = 'idle' | 'busy' | 'done';
export const CLOUD_DONE_MS = 1600;
const IDLE_RUN: RunState = { status: 'idle' };

export interface SheetRow extends SheetSite {
  readonly included: boolean;
  readonly unconfirmed: boolean;
  /** Null while unknown (loading, failed to load) or hidden (off). */
  readonly status: RowStatus | 'running' | null;
  /** Just flipped to 已同步 in this run: the status pops in. */
  readonly popped: boolean;
}

export interface SyncSheetInputs {
  readonly page: SheetPage;
  /** The enabled sites, in the 网站 tab's order. */
  readonly sites: readonly SheetSite[];
  /** Sites that are off here, checked for data in the cloud. */
  readonly idleSites: readonly SheetSite[];
  readonly toast: (offer: UndoOffer) => WithdrawUndoOffer;
  readonly cloudButtonRef: RefObject<HTMLButtonElement | null>;
  readonly language: AppLanguage;
  readonly t: (key: TranslationKey) => string;
}

/** The cloud sync sheet: connection, row statuses, runs, the guard and undo. */
export function useSyncSheet(inputs: SyncSheetInputs) {
  const { t, language, toast, cloudButtonRef } = inputs;
  const latest = useRef(inputs);
  useLayoutEffect(() => {
    latest.current = inputs;
  });
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [askingRestore, setAskingRestore] = useState(false);
  const [cloud, setCloud] = useState<CloudMark>('idle');
  const [statusRecordWarning, setStatusRecordWarning] = useState(false);
  const scope = useSyncScope();
  const syncSites = inputs.sites.filter((site) => isSyncableRow(site.key));
  const idle = inputs.idleSites.filter((site) => isSyncableRow(site.key));
  const dataRef = useRef(EMPTY_SHEET);

  const env = useMemo<SheetEnvironment>(
    () => ({
      send: sendSync,
      page: () => latest.current.page,
      rows: () => ({
        listed: ['shared', ...latest.current.sites.map((site) => site.key).filter(isSyncableRow)],
        idle: latest.current.idleSites.map((site) => site.key).filter(isSyncableRow),
      }),
    }),
    [],
  );

  const notify = useRef((notice: SheetNotice) => {
    const { t: translate } = latest.current;
    if (notice.kind === 'connectFailed')
      latest.current.toast({ message: translate('syncReasonSignIn'), tone: 'error' });
    else
      latest.current.toast({
        message: restoredLabel(translate, notice.restored, notice.failed),
        tone: notice.restored && !notice.failed ? undefined : 'error',
      });
  });
  const [sheet, sendSheet] = useMachine(
    () =>
      startSheetMachine({
        load: (signal) => loadSheet(env, signal),
        connect: () => connectDrive(env.send),
        disconnect: () => disconnectDrive(env.send),
        restore: (rows) =>
          restorePrevious(
            env,
            dataRef.current.rows.filter((row) => rows.includes(row.row)),
          ),
        notify: (notice) => notify.current(notice),
      }),
    { status: 'ready', data: EMPTY_SHEET },
  );
  useLayoutEffect(() => {
    dataRef.current = sheet.data;
  }, [sheet.data]);
  const [run, sendRun] = useMachine(
    () => startRunMachine({ runStep: createStepRunner(env) }),
    IDLE_RUN,
  );

  // A finished run: fresh statuses, the green cloud, and one toast with 撤销 when it can undo.
  const handled = useRef<RunState | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (run.status !== 'finished' || handled.current === run) return;
    handled.current = run;
    sendSheet({ type: 'refresh' });
    const { record, error } = run;
    // The data landed but its status was not recorded: the footer says so until the next run.
    setStatusRecordWarning(record.unrecorded);
    if (!error) setCloud('done');
    if (!error && !record.rows.length) return;
    const [snapshotId] = record.snapshots;
    // Offered only while this run's own snapshot is still the one an undo would restore.
    void (snapshotId ? canUndoCloudSync(snapshotId) : Promise.resolve(true)).then((owned) => {
      // Only an unmount drops the toast; a re-render while this resolves keeps it.
      if (!mounted.current) return;
      const message = error ? runFailureText(t, error) : syncedLabel(language, record.rows.length);
      const offerUndo = (text: string, failed: boolean): void => {
        toast({
          message: text,
          tone: failed ? 'error' : undefined,
          undo:
            owned && canUndo(record)
              ? () =>
                  void undoRun(env, record).then((result) => {
                    const done = runUndoText(latest.current.t, result);
                    if (done.retry) offerUndo(done.message, true);
                    else
                      latest.current.toast({
                        message: done.message,
                        tone: done.error ? 'error' : undefined,
                      });
                    sendSheet({ type: 'refresh' });
                  })
              : undefined,
          returnFocus: () => cloudButtonRef.current,
        });
      };
      offerUndo(message, error !== null);
    });
  }, [cloudButtonRef, env, language, run, sendSheet, t, toast]);
  // Its own timer, so a re-render inside the 1.6s cannot leave the cloud green.
  useEffect(() => {
    if (cloud !== 'done') return undefined;
    const timer = setTimeout(() => setCloud('idle'), CLOUD_DONE_MS);
    return () => clearTimeout(timer);
  }, [cloud]);

  const running = run.status === 'running';
  const runRows = run.status === 'idle' ? [] : run.record.rows;
  const optimistic =
    running || run.status === 'guard' || (run.status === 'finished' && sheet.status === 'loading');
  const statusByRow = new Map(sheet.data.rows.map((row) => [row.row, row]));
  const activeRow = running ? run.steps[run.index]?.row : undefined;

  const listed: SheetSite[] = [
    { key: 'shared', label: t('panelSyncShared'), logo: null },
    ...syncSites,
  ];
  const rows: SheetRow[] = listed.map((site) => {
    const status = statusByRow.get(site.key);
    const included = scope ? isSyncScopeIncluded(scope, rowScope(site.key)) : true;
    const unconfirmed = sheet.data.unconfirmed.includes(site.key);
    const popped = optimistic && runRows.includes(site.key);
    return {
      ...site,
      included,
      unconfirmed,
      popped,
      status:
        site.key === activeRow
          ? 'running'
          : popped
            ? 'synced'
            : status && status.status !== 'excluded'
              ? status.status
              : null,
    };
  });
  const runnable = sheet.data.rows.filter(
    (row) =>
      listed.some((site) => site.key === row.row) &&
      row.included &&
      !sheet.data.unconfirmed.includes(row.row),
  );
  const pending = runnable.filter(isPending);
  const idleRows = idle.filter((site) => {
    const status = statusByRow.get(site.key);
    return !!status && status.files.some((file) => file.md5 !== null);
  });

  const start = (kind: RunKind) => {
    setMenuOpen(false);
    setStatusRecordWarning(false);
    sendRun({ type: 'start', steps: planRun(kind, runnable) });
  };

  const close = useCallback(() => {
    setOpen(false);
    setMenuOpen(false);
    setAskingRestore(false);
    // Closing on the warning ends the run: the refused row and those after it wait.
    sendRun({ type: 'abandon' });
  }, [sendRun]);
  const toggle = useCallback(() => {
    if (open) {
      close();
      return;
    }
    setOpen(true);
    sendSheet({ type: 'refresh' });
  }, [close, open, sendSheet]);

  useEscapeLayer(ESCAPE_PRIORITY.syncSheet, open, () => {
    close();
    cloudButtonRef.current?.focus({ preventScroll: true });
    return true;
  });

  const setIncluded = useCallback(
    (row: string, next: boolean) => {
      void setSyncScopeRow(rowScope(row), next).then(() => sendSheet({ type: 'refresh' }));
    },
    [sendSheet],
  );

  const connection = sheet.data.connection;
  const busyMark: CloudMark = running ? 'busy' : cloud;
  return {
    open,
    toggle,
    close,
    menuOpen,
    setMenuOpen,
    askingRestore,
    setAskingRestore,
    cloud: busyMark,
    loaded: sheet.data.loaded,
    connected: connection?.connected === true,
    connecting: sheet.status === 'connecting',
    busy: sheet.status !== 'ready' && sheet.status !== 'loading' && sheet.status !== 'stale',
    rows,
    idleRows,
    running,
    guard:
      run.status === 'guard'
        ? { refused: run.refused, row: run.steps[run.index]?.row ?? '' }
        : null,
    pendingCount: pending.length,
    /** A row's status could not be read: the primary says so instead of 已是最新. */
    unreadable: runnable.some((row) => row.status === 'failed'),
    mergeOnly: pending.length > 0 && pending.every((row) => row.status === 'to_merge'),
    firstConnect: pending.some((row) => row.status === 'to_merge'),
    lastSynced: lastSyncedAt(sheet.data.rows, connection?.lastTransferAt ?? null),
    statusRecordWarning,
    runPending: () => start('pending'),
    uploadAll: () => start('uploadAll'),
    mergeAll: () => start('mergeAll'),
    choose: (choice: 'mergeInstead' | 'uploadAnyway') => sendRun({ type: 'choose', choice }),
    setIncluded,
    connect: () => sendSheet({ type: 'connect' }),
    disconnect: () => {
      setMenuOpen(false);
      sendSheet({ type: 'disconnect' });
    },
    restore: () => {
      setAskingRestore(false);
      sendSheet({ type: 'restore', rows: runnable.map((row) => row.row) });
    },
  };
}

function rowScope(row: string) {
  return row === 'shared'
    ? ({ kind: 'shared' } as const)
    : ({ kind: 'site', siteId: row } as const);
}

export type SyncSheetState = ReturnType<typeof useSyncSheet>;
