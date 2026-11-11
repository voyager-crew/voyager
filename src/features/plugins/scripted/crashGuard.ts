/**
 * The scripted crash guard: which page load in which tab ran scripted plugins
 * without the page confirming it was still responsive, and when that load
 * counts as a crash.
 *
 * This is a persisted pure transition, not `startMachine`. Its state has to
 * outlive the background service worker, which Chrome stops while a frozen
 * tab sits there, and its timer is a `chrome.alarms` alarm for the same
 * reason. `startMachine` keeps phases and effects in one worker's memory, so
 * a restart would forget a load that never confirmed. Each tab's record
 * lives in `StorageKeys.PLUGIN_SCRIPTED_LOADS` and the background, its only
 * writer, applies one event at a time.
 */
import { isLocalPluginId } from '../local/localPluginId';
import { type LoadedScript, type ScriptedLoadRecord, parseScriptHash } from './types';

/** A reload or close sooner than this after the load started is the user's, not a freeze. */
export const CRASH_GRACE_MS = 10_000;
/** An unconfirmed load this old is suspect, so another tab loading the same plugins disables them. */
export const CRASH_SUSPECT_MS = 30_000;

export type CrashGuardEvent =
  /** This tab started a document load; `plugins` are the scripted plugins that will run on it. */
  | {
      readonly type: 'load';
      readonly url: string;
      readonly plugins: readonly LoadedScript[];
      readonly at: number;
    }
  /** The page told the background it loaded and its main thread is free. */
  | { readonly type: 'confirm'; readonly url: string; readonly at: number }
  | { readonly type: 'alarm'; readonly at: number }
  /** Another tab started a load that runs `plugins`. */
  | { readonly type: 'peer-load'; readonly plugins: readonly LoadedScript[]; readonly at: number }
  /** The tab closed, or the browser session it belonged to ended. */
  | { readonly type: 'close'; readonly at: number };

export interface ScriptedCrash {
  readonly at: number;
  readonly url: string;
  /** Every plugin that ran on the load that never confirmed; any of them may be the cause. */
  readonly plugins: readonly LoadedScript[];
}

export interface CrashGuardResult {
  readonly record: ScriptedLoadRecord | undefined;
  readonly crash?: ScriptedCrash;
}

type Unconfirmed = Extract<ScriptedLoadRecord, { status: 'loading' | 'suspect' }>;

function unconfirmed(record: ScriptedLoadRecord | undefined): record is Unconfirmed {
  return record?.status === 'loading' || record?.status === 'suspect';
}

/** The same code: a re-import under the same id is another plugin as far as a crash goes. */
function includes(plugins: readonly LoadedScript[], plugin: LoadedScript): boolean {
  return plugins.some((other) => other.id === plugin.id && other.reviewHash === plugin.reviewHash);
}

function crashOf(record: Unconfirmed, at: number): ScriptedCrash {
  return { at, url: record.url, plugins: record.plugins };
}

function loading(
  url: string,
  plugins: readonly LoadedScript[],
  startedAt: number,
): ScriptedLoadRecord {
  return { status: 'loading', url, plugins, startedAt };
}

export function crashGuardTransition(
  record: ScriptedLoadRecord | undefined,
  event: CrashGuardEvent,
): CrashGuardResult {
  switch (event.type) {
    case 'load': {
      const next = event.plugins.length ? event.plugins : undefined;
      if (!unconfirmed(record)) {
        return { record: next && loading(event.url, next, event.at) };
      }
      if (event.at - record.startedAt >= CRASH_GRACE_MS) {
        const crash = crashOf(record, event.at);
        const survivors = next?.filter((plugin) => !includes(crash.plugins, plugin));
        return {
          record: survivors?.length ? loading(event.url, survivors, event.at) : undefined,
          crash,
        };
      }
      // A quick reload of a page that never confirmed keeps its start, so reloading a frozen
      // page every few seconds still crosses the grace period.
      return { record: next && loading(event.url, next, record.startedAt) };
    }
    case 'confirm':
      return {
        record: unconfirmed(record)
          ? { status: 'confirmed', url: event.url, at: event.at }
          : record,
      };
    case 'alarm':
      return {
        record:
          record?.status === 'loading' && event.at - record.startedAt >= CRASH_SUSPECT_MS
            ? { ...record, status: 'suspect' }
            : record,
      };
    case 'peer-load':
      if (
        record?.status === 'suspect' &&
        record.plugins.some((plugin) => includes(event.plugins, plugin))
      ) {
        return { record: undefined, crash: crashOf(record, event.at) };
      }
      return { record };
    case 'close':
      return {
        record: undefined,
        crash:
          unconfirmed(record) && event.at - record.startedAt >= CRASH_GRACE_MS
            ? crashOf(record, event.at)
            : undefined,
      };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export type ScriptedLoads = Readonly<Record<string, ScriptedLoadRecord>>;

export interface CrashGuardStep {
  readonly records: ScriptedLoads;
  readonly crashes: readonly ScriptedCrash[];
}

function withRecord(
  records: Record<string, ScriptedLoadRecord>,
  tab: string,
  record: ScriptedLoadRecord | undefined,
): void {
  if (record) records[tab] = record;
  else delete records[tab];
}

/**
 * One event for `tab` across every tab's record. A load also reaches the
 * other tabs as `peer-load`, and the plugins any crash names leave the new
 * load's record, because the background unregisters them before it runs.
 */
export function crashGuardStep(
  records: ScriptedLoads,
  tab: string,
  event: CrashGuardEvent,
): CrashGuardStep {
  const next: Record<string, ScriptedLoadRecord> = { ...records };
  const own = crashGuardTransition(records[tab], event);
  const crashes = own.crash ? [own.crash] : [];
  if (event.type === 'load') {
    for (const [other, record] of Object.entries(records)) {
      if (other === tab) continue;
      const peer = crashGuardTransition(record, {
        type: 'peer-load',
        plugins: event.plugins,
        at: event.at,
      });
      withRecord(next, other, peer.record);
      if (peer.crash) crashes.push(peer.crash);
    }
  }
  let ownRecord = own.record;
  if (ownRecord?.status === 'loading' && crashes.length) {
    const crashed = crashes.flatMap((crash) => crash.plugins);
    const plugins = ownRecord.plugins.filter((plugin) => !includes(crashed, plugin));
    ownRecord = plugins.length ? { ...ownRecord, plugins } : undefined;
  }
  withRecord(next, tab, ownRecord);
  return { records: next, crashes };
}

/**
 * Every record without the plugins `ids` names, after they were re-imported or
 * removed: what ran before is no longer what the user has, so no crash names it.
 */
export function crashGuardForget(records: ScriptedLoads, ids: readonly string[]): ScriptedLoads {
  const next: Record<string, ScriptedLoadRecord> = {};
  for (const [tab, record] of Object.entries(records)) {
    if (!unconfirmed(record)) {
      next[tab] = record;
      continue;
    }
    const plugins = record.plugins.filter((plugin) => !ids.includes(plugin.id));
    if (plugins.length) next[tab] = { ...record, plugins };
  }
  return next;
}

/** Every open record after the browser session ended: each tab closed at `at`. */
export function crashGuardSessionEnded(records: ScriptedLoads, at: number): CrashGuardStep {
  const crashes = Object.values(records).flatMap((record) => {
    const { crash } = crashGuardTransition(record, { type: 'close', at });
    return crash ? [crash] : [];
  });
  return { records: {}, crashes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parsePlugins(value: unknown): LoadedScript[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const plugins: LoadedScript[] = [];
  for (const entry of value as unknown[]) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !isLocalPluginId(entry.id)) continue;
    const reviewHash = parseScriptHash(entry.reviewHash);
    if (reviewHash) plugins.push({ id: entry.id, reviewHash });
  }
  return plugins.length ? plugins : undefined;
}

function parseLoadRecord(value: unknown): ScriptedLoadRecord | undefined {
  if (!isRecord(value) || typeof value.url !== 'string') return undefined;
  const url = value.url;
  if (value.status === 'confirmed') {
    return isFiniteNumber(value.at) ? { status: 'confirmed', url, at: value.at } : undefined;
  }
  if (value.status !== 'loading' && value.status !== 'suspect') return undefined;
  const plugins = parsePlugins(value.plugins);
  if (!plugins || !isFiniteNumber(value.startedAt)) return undefined;
  return { status: value.status, url, plugins, startedAt: value.startedAt };
}

/** Stored load records from `unknown`, keyed by tab id; an unreadable entry is dropped. */
export function parseScriptedLoads(value: unknown): ScriptedLoads {
  const records: Record<string, ScriptedLoadRecord> = {};
  if (!isRecord(value)) return records;
  for (const [tab, entry] of Object.entries(value)) {
    if (!/^\d+$/.test(tab)) continue;
    const record = parseLoadRecord(entry);
    if (record) records[tab] = record;
  }
  return records;
}
