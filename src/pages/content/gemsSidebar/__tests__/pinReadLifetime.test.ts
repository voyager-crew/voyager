import { afterEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { readPinsForPage } from '../pinRead';

let stopPatch: (() => void) | undefined;
afterEach(() => {
  stopPatch?.();
  stopPatch = undefined;
  vi.restoreAllMocks();
});

describe('Gems pin read lifetime', () => {
  it.each([false, true])(
    'still applies pins after navigation within the same account (route observed: %s)',
    async (observed) => {
      window.history.pushState({}, '', '/u/1/gems/view');
      stopPatch = await installGeminiSelectorPatch({ 'gems.list': ['.repaired-list'] });
      let resolve!: (ids: string[]) => void;
      const read = new Promise<string[]>((done) => {
        resolve = done;
      });
      const apply = vi.fn();
      const pending = readPinsForPage(new AbortController().signal, () => read, apply);
      window.history.pushState({}, '', '/u/1/gems/view?sort=name');
      if (observed) window.dispatchEvent(new PopStateEvent('popstate'));
      resolve(['writer']);
      await pending;
      expect(apply).toHaveBeenCalledWith(['writer']);
    },
  );

  it.each(['apply', 'read', 'async read'] as const)(
    'rejects instead of leaving injection pending when %s throws',
    async (phase) => {
      const failure = new Error('cannot insert pin button');
      let outcome: unknown = 'pending';
      const apply = vi.fn(() => {
        if (phase === 'apply') throw failure;
      });
      const read = () => {
        if (phase === 'read') throw failure;
        return phase === 'async read' ? Promise.reject(failure) : Promise.resolve(['writer']);
      };
      const pending = readPinsForPage(new AbortController().signal, read, apply).then(
        () => {
          outcome = 'resolved';
        },
        (error: unknown) => {
          outcome = error;
        },
      );
      for (let tick = 0; tick < 8; tick++) await Promise.resolve();
      if (phase === 'apply') expect(apply).toHaveBeenCalledWith(['writer']);
      expect(outcome).toBe(failure);
      await pending;
    },
  );
});
