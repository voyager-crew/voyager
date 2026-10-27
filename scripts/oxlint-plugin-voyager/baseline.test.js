import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { readBaseline, RULE_IDS } from './baseline.mjs';
import { measureViolations, updateBaseline } from './check-test-timing.mjs';
import { cleanupFixtures, fixture, lintFiles } from './testing.mjs';

afterAll(cleanupFixtures);

const sleepRule = 'voyager/no-real-sleep-in-tests';
const sleep = 'await new Promise(r => setTimeout(r, 25));';

function baselineFor(target, count) {
  const baseline = {
    version: 1,
    rules: Object.fromEntries(RULE_IDS.map((rule) => [rule, {}])),
  };
  baseline.rules[sleepRule][target.relative] = count;
  const filename = path.join(target.workspace, 'baseline.json');
  writeFileSync(filename, JSON.stringify(baseline));
  return filename;
}

describe('file/rule count baseline through the real linter', () => {
  it('allows recorded counts and reports every added sleep beyond the allowance', () => {
    const target = fixture(`it('waits', async () => { ${sleep}\n${sleep} });`);
    const baseline = baselineFor(target, 2);
    expect(lintFiles([target.file], baseline)).toEqual({ status: 0, diagnostics: [] });

    writeFileSync(target.file, `it('waits', async () => { ${sleep}\n${sleep}\n${sleep} });`);
    const result = lintFiles([target.file], baseline);
    expect(result.status).toBe(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('voyager(no-real-sleep-in-tests)');
    expect(result.diagnostics[0].labels[0].span.line).toBe(3);
  });

  it('does not transfer an allowance to another file or rule', () => {
    const first = fixture(`it('waits', async () => { ${sleep} });`);
    const second = fixture(
      `it('waits', async () => { ${sleep} }, 10000); it.skip('later', () => {});`,
    );
    const baseline = baselineFor(first, 10);
    const result = lintFiles([first.file, second.file], baseline);
    expect(result.status).toBe(1);
    expect(result.diagnostics.map((entry) => entry.code).sort()).toEqual([
      'voyager(no-per-test-timeout)',
      'voyager(no-real-sleep-in-tests)',
      'voyager(no-unlinked-skip)',
    ]);
    expect(result.diagnostics.every((entry) => path.resolve(entry.filename) === second.file)).toBe(
      true,
    );
  });

  it('lets counts shrink, and updates the committed allowance down to the measured count', () => {
    const target = fixture(`it('waits', async () => { ${sleep} });`);
    const baseline = baselineFor(target, 3);
    expect(lintFiles([target.file], baseline).status).toBe(0);
    expect(updateBaseline(baseline, [target.file]).errors).toEqual([]);
    expect(readBaseline(baseline).rules[sleepRule]).toEqual({ [target.relative]: 1 });

    writeFileSync(
      target.file,
      "it('immediate', async () => { await vi.advanceTimersByTimeAsync(25); });",
    );
    expect(updateBaseline(baseline, [target.file]).errors).toEqual([]);
    expect(readBaseline(baseline).rules[sleepRule]).toEqual({});
  });

  it('uses the same allowance and measurement key through a symlink alias', () => {
    const target = fixture(`it('waits', async () => { ${sleep} });`);
    const baseline = baselineFor(target, 1);
    const alias = path.join(target.workspace, 'alias.test.ts');
    symlinkSync(target.file, alias);
    expect(lintFiles([alias], baseline)).toEqual({ status: 0, diagnostics: [] });
    expect(measureViolations([alias]).rules[sleepRule]).toEqual({ [target.relative]: 1 });
  });

  it('never raises an allowance or adds a new file/rule pair during update', () => {
    const target = fixture(
      `it('waits', async () => { ${sleep} ${sleep} }, 10000); it.skip('later', () => {});`,
    );
    const added = fixture(`it('new wait', async () => { ${sleep} });`);
    const baseline = baselineFor(target, 1);
    const before = readBaseline(baseline);
    const result = updateBaseline(baseline, [target.file, added.file]);
    expect(result.errors).toHaveLength(4);
    expect(readBaseline(baseline)).toEqual(before);
    expect(lintFiles([target.file, added.file], baseline).status).toBe(1);
  });

  it('measures raw counts even when lint suppresses them with a baseline', () => {
    const target = fixture(`it('waits', async () => { ${sleep} });`);
    const baseline = baselineFor(target, 1);
    expect(lintFiles([target.file], baseline)).toEqual({ status: 0, diagnostics: [] });
    expect(measureViolations([target.file]).rules[sleepRule]).toEqual({ [target.relative]: 1 });
  });

  it('rejects malformed baseline counts instead of silently granting an allowance', () => {
    const target = fixture('');
    const filename = baselineFor(target, -1);
    expect(() => readBaseline(filename)).toThrow(/positive integer counts/);
    expect(JSON.parse(readFileSync(filename, 'utf8')).rules[sleepRule][target.relative]).toBe(-1);
  });
});
