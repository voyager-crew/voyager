import { type Mock, afterEach, beforeEach } from 'vitest';

import type { PluginManifest, PluginSource } from '../types';
import { resetNativeHandlersForTests } from './nativeHandlers';

export function manifest(matches: string[], id = 'voyager.test'): PluginManifest {
  return {
    id,
    name: 'Test',
    version: '1.0.0',
    description: 'd',
    author: 'a',
    category: 'other',
    license: 'MIT',
    engine: '>=1.0.0',
    tier: 'declarative',
    matches,
    contributes: {
      domOps: [
        {
          op: 'addClass',
          target: { kind: 'css', selector: 'body' },
          className: 'gv-plugin-active',
        },
      ],
    },
  };
}

export class StaticSource implements PluginSource {
  readonly id = 'static';
  constructor(private readonly plugins: readonly PluginManifest[]) {}
  async list(): Promise<readonly PluginManifest[]> {
    return this.plugins;
  }
}

export function mockState(state: Record<string, { enabled: boolean; installedAt: number }>): void {
  (chrome.storage.local.get as unknown as Mock).mockResolvedValue({ gvPluginsState: state });
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.classList.remove('gv-plugin-active');
});

afterEach(() => {
  (chrome.storage.local.get as unknown as Mock).mockReset?.();
  (chrome.storage.onChanged.addListener as unknown as Mock).mockClear?.();
  (chrome.storage.onChanged.removeListener as unknown as Mock).mockClear?.();
  resetNativeHandlersForTests();
});

/** Deliver a plugin-state change to every storage.onChanged subscriber. */
export function fireStateChange(state: Record<string, unknown>): void {
  const listeners = (chrome.storage.onChanged.addListener as unknown as Mock).mock.calls;
  for (const [listener] of listeners) {
    listener({ gvPluginsState: { newValue: state } }, 'local');
  }
}

export async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}
