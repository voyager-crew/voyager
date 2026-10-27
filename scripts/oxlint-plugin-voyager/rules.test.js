import { afterAll, describe, expect, it } from 'vitest';

import { cleanupFixtures, lintSource } from './testing.mjs';

afterAll(cleanupFixtures);

function expectError(source, rule, message, count = 1, filename) {
  const result = lintSource(source, filename);
  expect(result.status).toBe(1);
  expect(result.diagnostics).toHaveLength(count);
  for (const diagnostic of result.diagnostics) {
    expect(diagnostic.code).toBe(`voyager(${rule})`);
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.message).toMatch(message);
  }
}

describe('no-real-sleep-in-tests', () => {
  it.each([
    ['arrow executor', 'await new Promise(r => setTimeout(r, 25))'],
    ['typed block executor', 'await new Promise<void>(done => { setTimeout(() => done(), 25); })'],
    ['function executor', 'await new Promise(function(finish) { window.setTimeout(finish, 25); })'],
    ['computed global timer', 'await new globalThis.Promise(r => globalThis["setTimeout"](r, 25))'],
    ['unknown delay', 'await new Promise(r => setTimeout(r, Number(Date.now())))'],
    ['positive constant', 'const pause = 25; await new Promise(r => setTimeout(r, pause))'],
  ])('rejects %s in a new scratch test', (_name, body) => {
    expectError(
      `it('waits', async () => { ${body}; });`,
      'no-real-sleep-in-tests',
      /Advance fake timers or await the event/,
    );
  });

  it.each([
    [
      'local arrow helper',
      'const nap = (ms: number) => new Promise(r => setTimeout(r, ms));',
      'nap(25)',
    ],
    [
      'declared helper',
      'function nap(ms: number) { return new Promise(r => setTimeout(r, ms)); }',
      'nap(25)',
    ],
    ['default parameter', 'const nap = (ms = 25) => new Promise(r => setTimeout(r, ms));', 'nap()'],
    [
      'async helper',
      'async function nap(ms: number) { await new Promise(r => setTimeout(r, ms)); }',
      'nap(25)',
    ],
    [
      'helper alias',
      'const nap = (ms: number) => new Promise(r => setTimeout(r, ms)); const pause = nap;',
      'pause(25)',
    ],
    [
      'helper wrapper',
      'const nap = (ms: number) => new Promise(r => setTimeout(r, ms)); const pause = (n: number) => nap(n);',
      'pause(25)',
    ],
    [
      'object helper',
      'const timers = { nap: (n: number) => new Promise(r => setTimeout(r, n)) };',
      'timers.nap(25)',
    ],
    [
      'timer alias',
      'const timer = window.setTimeout; const nap = () => new Promise(r => timer(r, 25));',
      'nap()',
    ],
    [
      'destructured timer',
      'const { setTimeout: timer } = globalThis; const nap = () => new Promise(r => timer(r, 25));',
      'nap()',
    ],
    [
      'node callback timer',
      "import { setTimeout as timer } from 'node:timers'; const nap = () => new Promise(r => timer(r, 25));",
      'nap()',
    ],
    [
      'scheduler helper',
      'const arm = (cb: () => void, ms: number) => setTimeout(cb, ms); const nap = () => new Promise<void>(r => arm(r, 25));',
      'nap()',
    ],
    [
      'destructuring fallback',
      'const { nap = (ms: number) => new Promise(r => setTimeout(r, ms)) } = {};',
      'nap(25)',
    ],
  ])('counts every call to a %s', (_name, helper, call) => {
    expectError(
      `${helper}\nit('waits twice', async () => { await ${call}; await ${call}; });`,
      'no-real-sleep-in-tests',
      /instead of sleeping on real time/,
      2,
    );
  });

  it.each([
    ["import { setTimeout as nap } from 'node:timers/promises';", 'nap(25)'],
    ["import * as timers from 'timers/promises';", 'timers.setTimeout(25)'],
    ["import timers from 'node:timers/promises';", 'timers.setTimeout(25)'],
    ["import timers from 'node:timers';", 'new Promise(r => timers.setTimeout(r, 25))'],
    ["import { promises as timers } from 'node:timers';", 'timers.setTimeout(25)'],
    ["import { scheduler } from 'node:timers/promises';", 'scheduler.wait(25)'],
    [
      "import * as timers from 'node:timers/promises'; const { wait: nap } = timers.scheduler;",
      'nap(25)',
    ],
    ['', "(await import('node:timers/promises')).setTimeout(25)"],
    ['', "(await import('node:timers/promises')).scheduler.wait(25)"],
    ["const { setTimeout: nap } = require('node:timers/promises');", 'nap(25)'],
    ["import { setTimeout as nap } from 'node:timers/promises';", 'nap()'],
    ["import { setTimeout as nap } from 'node:timers/promises';", 'nap(undefined)'],
  ])('rejects promise-timer API %s %s', (imports, call) => {
    expectError(
      `${imports}\nit('waits', async () => { await ${call}; });`,
      'no-real-sleep-in-tests',
      /Advance fake timers/,
    );
  });

  it('checks a named callback passed to a test', () => {
    expectError(
      "async function body() { await new Promise(r => setTimeout(r, 25)); } it('waits', body);",
      'no-real-sleep-in-tests',
      /Advance fake timers/,
    );
  });

  it('detects a timer wrapper called from a Promise executor', () => {
    expectError(
      `const arm = (cb: () => void, ms: number) => setTimeout(cb, ms);
       it('waits', async () => { await new Promise<void>(r => arm(r, 25)); });`,
      'no-real-sleep-in-tests',
      /Advance fake timers/,
    );
  });

  it('handles repeated non-sleep branches without exponential helper expansion', () => {
    const helpers = ['function h0() { return 0; }'];
    for (let index = 1; index <= 28; index++) {
      helpers.push(`function h${index}() { h${index - 1}(); h${index - 1}(); }`);
    }
    expect(lintSource(`${helpers.join('\n')} it('branches', () => { h28(); });`)).toEqual({
      status: 0,
      diagnostics: [],
    });
  });

  it('handles cyclic helpers without losing a reachable sleep', () => {
    expectError(
      `function first() { second(); return new Promise(r => setTimeout(r, 25)); }
       function second() { first(); }
       it('cycle', async () => { await first(); await second(); });`,
      'no-real-sleep-in-tests',
      /Advance fake timers/,
      2,
    );
  });

  it('reuses parameterized diamond branches without retaining caller locals', () => {
    const helpers = [
      'function a0(ms: number) { return ms; }',
      'function b0(ms: number) { return ms; }',
    ];
    for (let index = 1; index <= 24; index++) {
      for (const prefix of ['a', 'b']) {
        helpers.push(
          `function ${prefix}${index}(ms: number) { a${index - 1}(ms); b${index - 1}(ms); }`,
        );
      }
    }
    expect(lintSource(`${helpers.join('\n')} it('diamond', () => { a24(25); b24(25); });`)).toEqual(
      {
        status: 0,
        diagnostics: [],
      },
    );
  });

  it('keeps a captured duration in the helper cache key', () => {
    expectError(
      `function outer(ms: number) {
      const inner = () => new Promise(r => setTimeout(r, ms));
      return inner();
    }
    it('captured delays', async () => { await outer(0); await outer(25); });`,
      'no-real-sleep-in-tests',
      /Advance fake timers/,
    );
  });

  it('counts an added helper call nested in another sleep argument', () => {
    expectError(
      `const nap = (ms: number) => new Promise<number>(r => setTimeout(() => r(25), ms));
       it('nested waits', async () => { await nap(await nap(25)); });`,
      'no-real-sleep-in-tests',
      /Advance fake timers/,
      2,
    );
  });

  it('counts a nested Promise once at the Promise that schedules the timer', () => {
    expectError(
      `it('nested Promise', async () => {
         await new Promise(r => { new Promise(done => setTimeout(done, 25)).then(r); });
       });`,
      'no-real-sleep-in-tests',
      /Advance fake timers/,
    );
  });

  it('does not treat an unused timer function in an executor as a wait', () => {
    expect(
      lintSource(`it('immediate', async () => {
      await new Promise<void>(r => {
        const later = () => setTimeout(r, 25);
        void later;
        r();
      });
    });`),
    ).toEqual({ status: 0, diagnostics: [] });
  });

  it('checks hooks and does not exempt a file that also uses fake timers', () => {
    expectError(
      `beforeEach(() => { vi.useFakeTimers(); });
       it('real clock', async () => {
         vi.useRealTimers(); await new Promise(r => setTimeout(r, 25));
       });`,
      'no-real-sleep-in-tests',
      /Advance fake timers/,
    );
  });

  it('allows fake-timer APIs and zero-delay macrotask or microtask yields', () => {
    const result = lintSource(`
      const tick = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
      const forward = (ms: number) => tick(ms);
      const optional = (ms?: number) => new Promise(r => setTimeout(r, ms));
      const defaultTick = (ms = 0) => tick(ms);
      const arm = (cb: () => void, ms: number) => setTimeout(cb, ms);
      it('settles', async () => {
        vi.advanceTimersByTime(25);
        vi.runAllTimers();
        vi.advanceTimersToNextTimer();
        await vi.advanceTimersByTimeAsync(25);
        setTimeout(() => {}, 0);
        queueMicrotask(() => {});
        await new Promise<void>(r => queueMicrotask(r));
        await new Promise(r => setTimeout(r, 0));
        await new Promise(r => window.setTimeout(r));
        await new Promise(r => setTimeout(r, undefined));
        await tick(0);
        await tick(1 - 1);
        await forward(0);
        await optional();
        await defaultTick(undefined);
        await new Promise<void>(r => arm(r, 0));
      });
    `);
    expect(result).toEqual({ status: 0, diagnostics: [] });
  });

  it('preserves shadowed timers and unrelated scheduler APIs', () => {
    const result = lintSource(`
      const setTimeout = (run: () => void, _ms: number) => run();
      const scheduler = { wait: (value: number) => Promise.resolve(value) };
      it('immediate', async () => {
        await new Promise<void>(r => setTimeout(r, 25));
        await scheduler.wait(25);
      });
    `);
    expect(result).toEqual({ status: 0, diagnostics: [] });
  });
});

describe('no-per-test-timeout', () => {
  it.each([
    "it('slow', () => {}, 10_000)",
    "test.only('slow', () => {}, 10_000)",
    "it.concurrent.only('slow', async () => {}, 10_000)",
    "test.each([1, 2])('slow', () => {}, 10_000)",
    "test.concurrent.each([1])('slow', () => {}, 10_000)",
    "it.each`a\n${1}`('slow', () => {}, 10_000)",
    "it('slow', { timeout: 10_000 }, () => {})",
    "test('slow', () => {}, { timeout: 10_000 })",
    "const timeout = 10_000; test('slow', () => {}, { timeout })",
    "const options = { timeout: 10_000 }; test('slow', { ...options }, () => {})",
    "const limit = 10_000; it('slow', () => {}, limit)",
    "it('slow', () => {}, 10 * 1000)",
    "it('slow', () => {}, Number(10000))",
    "const duration = Number(Date.now()); it('slow', () => {}, duration)",
    "const custom = test.extend({ value: 1 }); custom('slow', () => {}, 10000)",
    "const { spec = test } = {}; spec('slow', () => {}, 10000)",
    "const { spec = test } = { spec: void 0 }; spec('slow', () => {}, 10000)",
    'vi.setConfig({ testTimeout: 10_000 })',
    "import { vi as config } from 'vitest'; config.setConfig({ testTimeout: 10_000 })",
    "import * as suite from 'vitest'; suite.test.only('slow', () => {}, 10_000)",
  ])('rejects %s', (source) => {
    expectError(source, 'no-per-test-timeout', /Keep the shared test timeout/);
  });

  it('allows suite timeouts, other options, and shadowed test APIs', () => {
    const result = lintSource(`
      describe('suite', () => {}, 10_000);
      it.each([1, 2])('case', () => {});
      it('case', { retry: 1 }, () => {});
      vi.setConfig({ retry: 1 });
      function local(test: (name: string, cb: () => void, n: number) => void) {
        test('custom', () => {}, 500);
      }
      local(() => {});
    `);
    expect(result).toEqual({ status: 0, diagnostics: [] });
  });
});

describe('no-unlinked-skip', () => {
  it.each([
    "it.skip('later', () => {})",
    "test.todo('later')",
    "describe.skip('later', () => {})",
    "describe.todo('later')",
    "test.skip.each([1])('later', () => {})",
    "it.concurrent.skip('later', () => {})",
    "import { test as spec } from 'vitest'; spec.skip('later', () => {})",
    "const custom = test.extend({ value: 1 }); custom.skip('later', () => {})",
    "const { spec = test } = {}; spec.skip('later', () => {})",
    "const { spec = test } = { spec: void 0 }; spec.skip('later', () => {})",
    "// quarantine: #123\n\nit.skip('later', () => {})",
    "/* quarantine: #123 */\nit.skip('later', () => {})",
    "// quarantine: soon\nit.skip('later', () => {})",
    "const note = '// quarantine: #123'; it.skip(note, () => {})",
  ])('requires an adjacent issue link: %s', (source) => {
    expectError(source, 'no-unlinked-skip', /Link the quarantine with a \/\/ quarantine: #<issue>/);
  });

  it.each([
    "// quarantine: #123\nit.skip('later', () => {})",
    "test.todo('later'); // quarantine: #123",
    "// quarantine: #123 reason\ndescribe.skip.each([1])('later', () => {})",
    "it.skip('later', () => {\n}); // quarantine: #123",
  ])('accepts a linked quarantine: %s', (source) => {
    expect(lintSource(source)).toEqual({ status: 0, diagnostics: [] });
  });

  it('does not mistake an unrelated skip method for a test API', () => {
    expect(
      lintSource("const task = { skip: () => {} }; task.skip(); it('runs', () => {});"),
    ).toEqual({ status: 0, diagnostics: [] });
  });
});

describe('test-only enforcement', () => {
  it.each(['scratch.test.ts', 'scratch.test.tsx', '__tests__/helper.ts', '__tests__/helper.js'])(
    'enforces %s',
    (filename) => {
      expectError(
        "it('waits', async () => { await new Promise(r => setTimeout(r, 25)); });",
        'no-real-sleep-in-tests',
        /Advance fake timers/,
        1,
        filename,
      );
    },
  );

  it('leaves production code outside these rules', () => {
    expect(
      lintSource(
        "it.skip('waits', async () => { await new Promise(r => setTimeout(r, 25)); }, 10000);",
        'production.ts',
      ),
    ).toEqual({ status: 0, diagnostics: [] });
  });
});
