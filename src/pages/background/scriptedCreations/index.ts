/**
 * Background owner of scripted local plugins: the registrar, the crash guard
 * and the `gv.scripted.*` messages. Listeners register synchronously at
 * worker start, as MV3 requires. Firefox and Safari builds answer status
 * (unsupported) and register nothing else.
 */
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { getVoyagerBuildTarget } from '@/core/utils/browser';
import { readPlatformFormFactor } from '@/core/utils/formFactor';
import { chromeMajorVersion, probeUserScripts } from '@/features/plugins/scripted/availability';
import { parseScriptedLoads } from '@/features/plugins/scripted/crashGuard';
import type { ScriptedStatus } from '@/features/plugins/scripted/messages';
import {
  clearScriptedCrashNotice,
  loadScriptedPlugins,
  loadScriptedState,
  recordScriptedCrash,
  scriptedRunState,
} from '@/features/plugins/scripted/state';
import type { UserScriptsAvailability } from '@/features/plugins/scripted/types';
import { matchesAnyPattern } from '@/features/plugins/sites/matchPattern';

import { createCrashGuard } from './guard';
import { handleScriptedMessage } from './messages';
import { type UserScriptsApi, createScriptedRegistrar } from './registrar';

const LOADS = StorageKeys.PLUGIN_SCRIPTED_LOADS;
const ALARM_PREFIX = 'gv.scripted.load:';

function userScriptsApi(): UserScriptsApi | undefined {
  return (globalThis as { chrome?: { userScripts?: UserScriptsApi } }).chrome?.userScripts;
}

async function readAvailability(): Promise<UserScriptsAvailability> {
  return probeUserScripts({
    target: getVoyagerBuildTarget(),
    formFactor: await readPlatformFormFactor(),
    chromeMajor: chromeMajorVersion(globalThis.navigator?.userAgent ?? ''),
    userScripts: userScriptsApi(),
  });
}

async function readStatus(): Promise<ScriptedStatus> {
  const [availability, plugins, state] = await Promise.all([
    readAvailability(),
    loadScriptedPlugins(),
    loadScriptedState(),
  ]);
  return {
    ok: true,
    availability,
    stopped: state.stopped,
    plugins: plugins.map((plugin) => ({
      id: plugin.manifest.id,
      runState: scriptedRunState(plugin, state, availability),
    })),
  };
}

async function unregisterIds(ids: readonly string[]): Promise<void> {
  const api = userScriptsApi();
  if (!api) return;
  try {
    await api.unregister({ ids: [...ids] });
  } catch {
    for (const id of ids) await api.unregister({ ids: [id] }).catch(() => {});
  }
}

async function runningIdsFor(url: string | undefined): Promise<string[]> {
  const api = userScriptsApi();
  if (!api || !url) return [];
  try {
    const scripts = await api.getScripts();
    return scripts
      .filter((script) => matchesAnyPattern(url, script.matches ?? []))
      .map((script) => script.id);
  } catch {
    return [];
  }
}

function startRuntime(registrar: ReturnType<typeof createScriptedRegistrar>) {
  const guard = createCrashGuard({
    now: () => Date.now(),
    readLoads: async () => parseScriptedLoads((await chrome.storage.local.get(LOADS))?.[LOADS]),
    writeLoads: (records) => chrome.storage.local.set({ [LOADS]: records }),
    runningIdsFor,
    unregister: unregisterIds,
    recordCrash: recordScriptedCrash,
    scheduleSuspectCheck: (tab, when) =>
      void chrome.alarms.create(`${ALARM_PREFIX}${tab}`, { when }),
  });

  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status === 'loading') void guard.load(tabId, change.url ?? tab.url);
  });
  chrome.tabs.onRemoved.addListener((tabId) => void guard.close(tabId));
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith(ALARM_PREFIX)) return;
    const tabId = Number(alarm.name.slice(ALARM_PREFIX.length));
    if (Number.isInteger(tabId)) void guard.alarm(tabId);
  });
  chrome.runtime.onStartup.addListener(() => void guard.sessionEnded());

  // Chrome clears user scripts when the extension updates.
  chrome.runtime.onInstalled.addListener(() => void registrar.reconcile());
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (
      Object.hasOwn(changes, StorageKeys.PLUGIN_LOCAL_MANIFESTS) ||
      Object.hasOwn(changes, StorageKeys.PLUGIN_SCRIPTED_STATE)
    ) {
      void registrar.reconcile();
    }
  });
  chrome.permissions.onAdded.addListener(() => void registrar.reconcile());
  chrome.permissions.onRemoved.addListener(() => void registrar.reconcile());
  void registrar.reconcile();
  return guard;
}

export function startScriptedCreations(): void {
  const target = getVoyagerBuildTarget();
  const runs = target === 'chrome' || target === 'edge';
  const registrar = createScriptedRegistrar({
    readAvailability,
    readPlugins: loadScriptedPlugins,
    readState: loadScriptedState,
    userScripts: userScriptsApi,
  });
  const guard = runs ? startRuntime(registrar) : undefined;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const reply = handleScriptedMessage(message, sender, {
      status: readStatus,
      recheck: async () => {
        if (runs) await registrar.reconcile();
        return readStatus();
      },
      confirmLoad: async (tabId, url) => guard?.confirm(tabId, url),
      clearNotice: clearScriptedCrashNotice,
      openDetails: async () => {
        await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
      },
    });
    if (!reply) return undefined;
    reply.then(sendResponse, (error: unknown) => {
      logger.warn('Scripted message failed', { error: String(error) });
      sendResponse({ ok: false, error: 'failed' });
    });
    return true;
  });
}
