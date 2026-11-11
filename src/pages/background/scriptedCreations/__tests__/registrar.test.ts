import { describe, expect, it } from 'vitest';

import { EMPTY_SCRIPTED_STATE } from '@/features/plugins/scripted/parseState';
import { SCRIPTED_PRELUDE_FILE } from '@/features/plugins/scripted/prelude/file';
import {
  SCRIPTED_WORLD_CSP,
  type ScriptedRegistrarDeps,
  createScriptedRegistrar,
  reconcileUserScripts,
} from '@/features/plugins/scripted/registrar';
import { readScriptedPlugin } from '@/features/plugins/scripted/state';
import type {
  ScriptHash,
  ScriptedPlugin,
  ScriptedStateV1,
  UserScriptsAvailability,
} from '@/features/plugins/scripted/types';

import { storedScripted } from '../../../../features/plugins/scripted/__tests__/fixtures';
import { fakeUserScripts } from './fakeUserScripts';

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

function deps(
  api: ReturnType<typeof fakeUserScripts>['api'] | undefined,
  plugins: readonly ScriptedPlugin[],
  state: ScriptedStateV1,
  availability: UserScriptsAvailability = AVAILABLE,
): ScriptedRegistrarDeps {
  return {
    readAvailability: async () => availability,
    readPlugins: async () => plugins,
    readState: async () => state,
    userScripts: () => api,
  };
}

const COUNTER = 'local.me.counter';
const CLICKS = 'local.me.clicks';

async function twoPlugins() {
  const counter = await plugin(COUNTER, 'count()', ['https://chatgpt.com/*']);
  const clicks = await plugin(CLICKS, 'listen()', ['https://claude.ai/*']);
  return { counter, clicks, state: enabling(counter, clicks) };
}

function endState(scripts: Map<string, chrome.userScripts.RegisteredUserScript>) {
  return [...scripts.values()].sort((a, b) => a.id.localeCompare(b.id));
}

describe('reconcileUserScripts', () => {
  it('registers the prelude and then the source in each plugin’s own world', async () => {
    const { counter, clicks, state } = await twoPlugins();
    const fake = fakeUserScripts();
    await reconcileUserScripts(deps(fake.api, [counter, clicks], state));

    const scripts = endState(fake.scripts);
    expect(scripts.map((script) => script.id)).toEqual([CLICKS, COUNTER]);
    for (const script of scripts) {
      expect(script).toMatchObject({
        allFrames: false,
        runAt: 'document_idle',
        world: 'USER_SCRIPT',
      });
      expect(script.js[0]).toEqual({ file: SCRIPTED_PRELUDE_FILE });
      expect(fake.worlds.get(script.worldId!)).toEqual({
        worldId: script.worldId,
        csp: SCRIPTED_WORLD_CSP,
        messaging: false,
      });
    }
    expect(fake.scripts.get(COUNTER)?.js[1]).toEqual({ code: 'count()' });
    expect(fake.scripts.get(COUNTER)?.matches).toEqual(['https://chatgpt.com/*']);
    expect(new Set(scripts.map((script) => script.worldId)).size).toBe(2);
  });

  it('reaches the same registrations from empty, stale and partly wrong starting points', async () => {
    const { counter, clicks, state } = await twoPlugins();
    const fromEmpty = fakeUserScripts();
    await reconcileUserScripts(deps(fromEmpty.api, [counter, clicks], state));
    const expected = endState(fromEmpty.scripts);

    const starts: chrome.userScripts.RegisteredUserScript[][] = [
      [{ id: 'local.me.removed', matches: ['https://claude.ai/*'], js: [{ code: 'old()' }] }],
      [
        { ...expected[1], js: [{ file: SCRIPTED_PRELUDE_FILE }, { code: 'count(); /* v1 */' }] },
        { ...expected[0], matches: ['https://gemini.google.com/*'], world: 'MAIN' },
        { id: 'local.me.removed', matches: ['https://claude.ai/*'], js: [{ code: 'old()' }] },
      ],
      expected,
    ];
    for (const start of starts) {
      const fake = fakeUserScripts(start);
      await reconcileUserScripts(deps(fake.api, [counter, clicks], state));
      expect(endState(fake.scripts)).toEqual(expected);
      await reconcileUserScripts(deps(fake.api, [counter, clicks], state));
      expect(endState(fake.scripts)).toEqual(expected);
    }
  });

  it('removes every registration while stopped, unavailable or changed since review', async () => {
    const { counter, clicks, state } = await twoPlugins();
    const runningBoth = async () => {
      const fake = fakeUserScripts();
      await reconcileUserScripts(deps(fake.api, [counter, clicks], state));
      expect(fake.scripts.size).toBe(2);
      return fake;
    };

    const stopped = await runningBoth();
    await reconcileUserScripts(deps(stopped.api, [counter, clicks], { ...state, stopped: true }));
    expect(stopped.scripts.size).toBe(0);

    for (const availability of [
      { kind: 'toggle-off', needs: 'allow-user-scripts' },
      { kind: 'unsupported', browser: 'old' },
    ] as const) {
      const off = await runningBoth();
      await reconcileUserScripts(deps(off.api, [counter, clicks], state, availability));
      expect(off.scripts.size).toBe(0);
    }

    const edited = await runningBoth();
    const rehashed = {
      ...state,
      enabled: {
        ...state.enabled,
        [COUNTER]: { reviewHash: 'f'.repeat(64) as ScriptHash, enabledAt: 1 },
      },
    };
    await reconcileUserScripts(deps(edited.api, [counter, clicks], rehashed));
    expect([...edited.scripts.keys()]).toEqual([CLICKS]);
  });

  it('does not throw and changes nothing when the API refuses to list', async () => {
    const { counter, state } = await twoPlugins();
    const fake = fakeUserScripts([{ id: 'local.me.removed', js: [{ code: 'x' }] }]);
    fake.state.failGetScripts = true;
    await expect(reconcileUserScripts(deps(fake.api, [counter], state))).resolves.toBeUndefined();
    await expect(reconcileUserScripts(deps(undefined, [counter], state))).resolves.toBeUndefined();
    expect([...fake.scripts.keys()]).toEqual(['local.me.removed']);
  });

  it('one plugin Chrome refuses does not keep the others from registering', async () => {
    const { counter, clicks, state } = await twoPlugins();
    const fake = fakeUserScripts();
    const register = fake.api.register.bind(fake.api);
    fake.api.register = (async (list: chrome.userScripts.RegisteredUserScript[]) => {
      if (list.some((script) => script.id === COUNTER)) throw new Error('Invalid url pattern');
      return register(list);
    }) as typeof fake.api.register;
    await reconcileUserScripts(deps(fake.api, [counter, clicks], state));
    expect([...fake.scripts.keys()]).toEqual([CLICKS]);
  });
});

describe('createScriptedRegistrar', () => {
  it('ends on the latest state when changes arrive during a pass', async () => {
    const { counter, clicks, state } = await twoPlugins();
    const fake = fakeUserScripts();
    let current: ScriptedStateV1 = state;
    let passes = 0;
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const registrar = createScriptedRegistrar({
      ...deps(fake.api, [counter, clicks], state),
      readState: async () => {
        passes += 1;
        const seen = current;
        if (passes === 1) await firstHeld;
        return seen;
      },
    });

    const first = registrar.reconcile();
    await Promise.resolve();
    current = { ...state, stopped: true };
    const second = registrar.reconcile();
    const third = registrar.reconcile();
    releaseFirst();
    await Promise.all([first, second, third]);

    expect(passes).toBe(2);
    expect(fake.scripts.size).toBe(0);
  });
});
