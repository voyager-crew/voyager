import { type Mock, afterEach, describe, expect, it } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { fakeUserScripts } from '../../../../pages/background/scriptedCreations/__tests__/fakeUserScripts';
import { saveLocalPluginRecord } from '../../local/localPluginStore';
import { createScriptedClient } from '../client';
import type { ScriptedStatus } from '../messages';
import { enableScriptedIfUnchanged, readScriptedPlugin } from '../state';
import { SCRIPTED_ID, storedScripted } from './fixtures';
import { installMemoryLocal } from './memoryLocal';

const storage = installMemoryLocal();
const sendMessage = chrome.runtime.sendMessage as unknown as Mock;

async function enabledPlugin(): Promise<void> {
  const manifest = storedScripted();
  await saveLocalPluginRecord(manifest, 1);
  const plugin = await readScriptedPlugin(manifest);
  expect(await enableScriptedIfUnchanged(SCRIPTED_ID, plugin!.reviewHash)).toBe('enabled');
}

function backgroundSees(kind: 'available' | 'toggle-off'): void {
  const availability =
    kind === 'available' ? { kind } : { kind, needs: 'allow-user-scripts' as const };
  const status: ScriptedStatus = { ok: true, availability, stopped: false, plugins: [] };
  sendMessage.mockResolvedValue(status);
}

afterEach(() => {
  delete (chrome as { userScripts?: unknown }).userScripts;
  sendMessage.mockReset();
});

describe('the popup and panel view of scripted creations', () => {
  it('registers from this page when it sees the API and the background does not', async () => {
    await enabledPlugin();
    const fake = fakeUserScripts();
    (chrome as { userScripts?: unknown }).userScripts = fake.api;
    backgroundSees('toggle-off');

    const status = await createScriptedClient().refresh('recheck');
    expect(status.availability).toEqual({ kind: 'available' });
    expect(status.plugins).toEqual([{ id: SCRIPTED_ID, runState: { kind: 'running' } }]);
    expect([...fake.scripts.keys()]).toEqual([SCRIPTED_ID]);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'gv.scripted.recheck' });
  });

  it('registers nothing whose world Chrome refused to configure, and says it is paused', async () => {
    await enabledPlugin();
    const fake = fakeUserScripts();
    fake.state.failConfigureWorld = true;
    (chrome as { userScripts?: unknown }).userScripts = fake.api;
    backgroundSees('toggle-off');

    const status = await createScriptedClient().refresh('recheck');
    expect([...fake.scripts.keys()]).toEqual([]);
    expect(status.plugins).toEqual([
      { id: SCRIPTED_ID, runState: { kind: 'paused', reason: 'world-setup' } },
    ]);
  });

  it('leaves registrations to the background when it sees the API', async () => {
    await enabledPlugin();
    const fake = fakeUserScripts();
    (chrome as { userScripts?: unknown }).userScripts = fake.api;
    backgroundSees('available');

    await createScriptedClient().refresh('status');
    expect([...fake.scripts.keys()]).toEqual([]);
  });

  it('reports the toggle off when neither context sees the API, and changes nothing', async () => {
    await enabledPlugin();
    backgroundSees('toggle-off');
    const before = structuredClone(storage.memory[StorageKeys.PLUGIN_SCRIPTED_STATE]);

    const status = await createScriptedClient().refresh('recheck');
    expect(status.availability.kind).toBe('toggle-off');
    expect(storage.memory[StorageKeys.PLUGIN_SCRIPTED_STATE]).toEqual(before);
  });
});
