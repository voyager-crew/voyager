import { type Mock, afterEach, beforeEach } from 'vitest';

export interface MemoryLocal {
  memory: Record<string, unknown>;
  /** Every `storage.local.set` payload, in order. */
  readonly writes: Array<Record<string, unknown>>;
  failGets: boolean;
}

function read(memory: Record<string, unknown>, keys: unknown): Record<string, unknown> {
  if (keys === null || keys === undefined) return structuredClone(memory);
  const defaults: Record<string, unknown> =
    typeof keys === 'string'
      ? { [keys]: undefined }
      : Array.isArray(keys)
        ? Object.fromEntries(keys.map((key: string) => [key, undefined]))
        : (keys as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    if (key in memory) out[key] = structuredClone(memory[key]);
    else if (fallback !== undefined) out[key] = fallback;
  }
  return out;
}

/** `chrome.storage.local` over a plain object for every test in the calling file. */
export function installMemoryLocal(): MemoryLocal {
  const state: MemoryLocal = { memory: {}, writes: [], failGets: false };
  const get = chrome.storage.local.get as unknown as Mock;
  const set = chrome.storage.local.set as unknown as Mock;
  beforeEach(() => {
    state.memory = {};
    state.writes.length = 0;
    state.failGets = false;
    get.mockImplementation(async (keys: unknown) => {
      if (state.failGets) throw new Error('get failed');
      return read(state.memory, keys);
    });
    set.mockImplementation(async (items: Record<string, unknown>) => {
      state.writes.push(structuredClone(items));
      Object.assign(state.memory, structuredClone(items));
    });
  });
  afterEach(() => {
    get.mockReset();
    set.mockReset();
  });
  return state;
}
