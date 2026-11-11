import { describe, expect, it } from 'vitest';

import { desiredUserScripts } from '../desired';
import { EMPTY_SCRIPTED_STATE } from '../parseState';
import { readScriptedPlugin } from '../state';
import type { ScriptedPlugin, ScriptedStateV1, UserScriptsAvailability } from '../types';
import { storedScripted } from './fixtures';

const AVAILABLE: UserScriptsAvailability = { kind: 'available' };

async function plugin(id: string, source: string, matches: string[]): Promise<ScriptedPlugin> {
  const read = await readScriptedPlugin({ ...storedScripted(source, { matches }), id });
  if (!read) throw new Error('fixture must pass the scripted gate');
  return read;
}

function enabling(...plugins: ScriptedPlugin[]): ScriptedStateV1 {
  return {
    ...EMPTY_SCRIPTED_STATE,
    enabled: Object.fromEntries(
      plugins.map((each) => [each.manifest.id, { reviewHash: each.reviewHash, enabledAt: 1 }]),
    ),
  };
}

describe('desiredUserScripts', () => {
  it('registers each enabled plugin in its own world, top frame only, at document_idle', async () => {
    const counter = await plugin('local.me.counter', 'count()', ['https://chatgpt.com/*']);
    const clicks = await plugin('local.me.clicks', 'listen()', [
      'https://claude.ai/*',
      'https://gemini.google.com/*',
    ]);

    const desired = desiredUserScripts([counter, clicks], enabling(counter, clicks), AVAILABLE);

    expect(desired).toHaveLength(2);
    expect(desired).toEqual([
      expect.objectContaining({
        id: 'local.me.counter',
        matches: ['https://chatgpt.com/*'],
        source: 'count()',
      }),
      expect.objectContaining({
        id: 'local.me.clicks',
        matches: ['https://claude.ai/*', 'https://gemini.google.com/*'],
        source: 'listen()',
      }),
    ]);
    for (const registration of desired) {
      expect(registration).toMatchObject({
        allFrames: false,
        runAt: 'document_idle',
        world: 'USER_SCRIPT',
      });
      expect(registration.worldId.startsWith('_')).toBe(false);
    }
    expect(new Set(desired.map((registration) => registration.worldId)).size).toBe(2);
  });

  it('gives a plugin the same world on every run', async () => {
    const counter = await plugin('local.me.counter', 'count()', ['https://chatgpt.com/*']);
    const first = desiredUserScripts([counter], enabling(counter), AVAILABLE);
    const again = desiredUserScripts([counter], enabling(counter), AVAILABLE);
    expect(again[0].worldId).toBe(first[0].worldId);
  });

  it('registers only the plugins whose content is still the reviewed one', async () => {
    const reviewed = await plugin('local.me.counter', 'count()', ['https://chatgpt.com/*']);
    const edited = await plugin('local.me.counter', 'countAndSend()', ['https://chatgpt.com/*']);
    const other = await plugin('local.me.clicks', 'listen()', ['https://claude.ai/*']);

    const desired = desiredUserScripts([edited, other], enabling(reviewed, other), AVAILABLE);

    expect(desired.map((registration) => registration.id)).toEqual(['local.me.clicks']);
  });

  it('registers nothing for a plugin that is not enabled', async () => {
    const counter = await plugin('local.me.counter', 'count()', ['https://chatgpt.com/*']);
    expect(desiredUserScripts([counter], EMPTY_SCRIPTED_STATE, AVAILABLE)).toEqual([]);
  });

  it.each([
    ['stopped', { kind: 'available' }, true],
    ['the toggle is off', { kind: 'toggle-off', needs: 'allow-user-scripts' }, false],
    ['the browser has no user scripts', { kind: 'unsupported', browser: 'firefox' }, false],
  ] as const)('registers nothing while %s', async (_label, availability, stopped) => {
    const counter = await plugin('local.me.counter', 'count()', ['https://chatgpt.com/*']);
    const state = { ...enabling(counter), stopped };
    expect(desiredUserScripts([counter], state, availability)).toEqual([]);
  });
});
