import type { UserScriptsApi } from '../registrar';

type Script = chrome.userScripts.RegisteredUserScript;
type World = chrome.userScripts.WorldProperties;

/** `chrome.userScripts` over a map, refusing what Chrome refuses: duplicate and unknown ids. */
export function fakeUserScripts(initial: Script[] = []) {
  const scripts = new Map(initial.map((script) => [script.id, structuredClone(script)]));
  const worlds = new Map<string, World>();
  const state = { failGetScripts: false };
  const api: UserScriptsApi = {
    async getScripts() {
      if (state.failGetScripts) throw new Error('userScripts not allowed');
      return [...scripts.values()].map((script) => structuredClone(script));
    },
    async register(list: Script[]) {
      if (list.some((script) => scripts.has(script.id))) throw new Error('Duplicate script ID');
      for (const script of list) scripts.set(script.id, structuredClone(script));
    },
    async update(list: Script[]) {
      if (list.some((script) => !scripts.has(script.id))) throw new Error('Nonexistent script ID');
      for (const script of list) {
        scripts.set(script.id, { ...scripts.get(script.id)!, ...structuredClone(script) });
      }
    },
    async unregister(filter?: chrome.userScripts.UserScriptFilter) {
      const ids = filter?.ids ?? [...scripts.keys()];
      if (ids.some((id) => !scripts.has(id))) throw new Error('Nonexistent script ID');
      for (const id of ids) scripts.delete(id);
    },
    async configureWorld(properties: World) {
      worlds.set(properties.worldId ?? '', structuredClone(properties));
    },
  } as UserScriptsApi;
  return { api, scripts, worlds, state };
}
