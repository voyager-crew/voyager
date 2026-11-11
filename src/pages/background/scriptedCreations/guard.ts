/**
 * Applies `crashGuardStep` to browser events. Events run one at a time, so
 * two tabs loading at once cannot overwrite each other's record. A crash
 * unregisters the plugins it names that still run the code it saw before
 * anything else, to beat the next load's `document_idle` injection; turning
 * them off in storage then lets the registrar converge.
 */
import { logger } from '@/core/services/LoggerService';
import {
  localPluginRecordSnapshot,
  sanitizeLocalPluginRecords,
} from '@/features/plugins/local/localPluginStore';
import {
  CRASH_SUSPECT_MS,
  type CrashGuardEvent,
  type CrashGuardStep,
  type ScriptedCrash,
  type ScriptedLoads,
  crashGuardForget,
  crashGuardSessionEnded,
  crashGuardStep,
} from '@/features/plugins/scripted/crashGuard';
import { crashedAndStillOn } from '@/features/plugins/scripted/state';
import type { LoadedScript, ScriptedStateV1 } from '@/features/plugins/scripted/types';

export interface CrashGuardDeps {
  now(): number;
  readLoads(): Promise<ScriptedLoads>;
  writeLoads(records: ScriptedLoads): Promise<void>;
  /** The registered scripted plugins that inject on `url`, with the review hash of that code. */
  runningFor(url: string | undefined): Promise<LoadedScript[]>;
  readState(): Promise<ScriptedStateV1>;
  unregister(ids: readonly string[]): Promise<void>;
  recordCrash(crash: ScriptedCrash): Promise<unknown>;
  /** One alarm per tab; scheduling again replaces it. */
  scheduleSuspectCheck(tab: string, when: number): void;
}

export interface CrashGuard {
  load(tabId: number, url: string | undefined): Promise<void>;
  confirm(tabId: number, url: string): Promise<void>;
  alarm(tabId: number): Promise<void>;
  close(tabId: number): Promise<void>;
  sessionEnded(): Promise<void>;
  /** The stored local plugin records changed: what was re-imported or removed leaves every load. */
  recordsChanged(oldValue: unknown, newValue: unknown): Promise<void>;
}

/** Ids whose stored record is gone or no longer the same import. */
export function replacedOrRemovedIds(oldValue: unknown, newValue: unknown): string[] {
  const before = sanitizeLocalPluginRecords(oldValue);
  const after = sanitizeLocalPluginRecords(newValue);
  return Object.keys(before).filter(
    (id) => localPluginRecordSnapshot(before[id]) !== localPluginRecordSnapshot(after[id]),
  );
}

export function createCrashGuard(deps: CrashGuardDeps): CrashGuard {
  let chain: Promise<void> = Promise.resolve();

  function serial(work: () => Promise<void>): Promise<void> {
    const run = chain.then(work).catch((error: unknown) => {
      logger.warn('Scripted crash guard step failed', { error: String(error) });
    });
    chain = run;
    return run;
  }

  async function commit(before: ScriptedLoads, step: CrashGuardStep, tab?: string): Promise<void> {
    if (step.crashes.length) {
      const state = await deps.readState();
      const disabled = [
        ...new Set(step.crashes.flatMap((crash) => crashedAndStillOn(crash, state))),
      ];
      if (disabled.length) await deps.unregister(disabled);
    }
    if (JSON.stringify(before) !== JSON.stringify(step.records)) {
      await deps.writeLoads(step.records);
    }
    for (const crash of step.crashes) await deps.recordCrash(crash);
    const record = tab === undefined ? undefined : step.records[tab];
    if (tab !== undefined && record?.status === 'loading') {
      deps.scheduleSuspectCheck(tab, record.startedAt + CRASH_SUSPECT_MS);
    }
  }

  function apply(tabId: number, event: () => Promise<CrashGuardEvent>): Promise<void> {
    return serial(async () => {
      const tab = String(tabId);
      const [before, next] = await Promise.all([deps.readLoads(), event()]);
      await commit(before, crashGuardStep(before, tab, next), tab);
    });
  }

  return {
    load: (tabId, url) =>
      apply(tabId, async () => ({
        type: 'load',
        url: url ?? '',
        plugins: await deps.runningFor(url),
        at: deps.now(),
      })),
    confirm: (tabId, url) => apply(tabId, async () => ({ type: 'confirm', url, at: deps.now() })),
    alarm: (tabId) => apply(tabId, async () => ({ type: 'alarm', at: deps.now() })),
    close: (tabId) => apply(tabId, async () => ({ type: 'close', at: deps.now() })),
    sessionEnded: () =>
      serial(async () => {
        const before = await deps.readLoads();
        if (!Object.keys(before).length) return;
        await commit(before, crashGuardSessionEnded(before, deps.now()));
      }),
    recordsChanged: (oldValue, newValue) =>
      serial(async () => {
        const ids = replacedOrRemovedIds(oldValue, newValue);
        if (!ids.length) return;
        const before = await deps.readLoads();
        const after = crashGuardForget(before, ids);
        if (JSON.stringify(before) !== JSON.stringify(after)) await deps.writeLoads(after);
      }),
  };
}
