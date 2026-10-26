// @vitest-environment-options { "url": "https://chatgpt.com/" }
import { afterEach, expect, it } from 'vitest';

import {
  catalogConsumerContext,
  catalogConsumerPage,
  catalogConsumerPatch,
} from '../catalogConsumerFixture';
import { collectProbes, probeMatches, runProbes } from './probes';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
});

it.each(['site', 'voyager.test'])(
  'a saved %s probe cannot recognize a repaired response after it becomes a dialog',
  async (source) => {
    catalogConsumerPage();
    stop = await catalogConsumerPatch();
    const probes = collectProbes(
      catalogConsumerContext().adapter,
      {
        statuses: [{ id: 'voyager.test', version: '1.0.0', kind: 'mounted' }],
        manifests: [
          {
            id: 'voyager.test',
            name: 'Test',
            description: '',
            version: '1.0.0',
            author: 'test',
            category: 'other',
            license: 'MIT',
            engine: '>=1.0.0',
            tier: 'declarative',
            matches: ['https://chatgpt.com/*'],
            contributes: {
              domOps: [
                {
                  op: 'addClass',
                  target: { kind: 'semantic', key: 'assistantTurn' },
                  className: 'gv-test',
                },
              ],
            },
          },
        ],
      },
      'self',
    );
    const probe = probes.find(
      (probe) => probe.source === source && probe.name === 'assistantTurn',
    )!;
    const answer = document.querySelector('.answer')!;
    const count = () => runProbes([probe], { doc: document, conversation: true })[0];
    expect(count()).toMatchObject({ count: 1, verdict: 'ok' });
    expect(probeMatches(answer, probe)).toBe(true);
    document.querySelector('main')!.setAttribute('role', 'dialog');
    expect(count()).toMatchObject({ count: 0, verdict: 'missing' });
    expect(probeMatches(answer, probe)).toBe(false);
    document.querySelector('main')!.removeAttribute('role');
    expect(count()).toMatchObject({ count: 1, verdict: 'ok' });
    expect(probeMatches(answer, probe)).toBe(true);
  },
);
