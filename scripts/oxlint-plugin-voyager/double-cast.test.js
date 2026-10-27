import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { cleanupFixtures, lintFiles, repositoryFixture } from './testing.mjs';

afterAll(cleanupFixtures);

const rule = 'voyager/no-double-cast';
const code = 'voyager(no-double-cast)';
const cast = 'export const result = {} as unknown as { ready: true };';

function lintExpression(expression, filename = 'src/scratch.ts') {
  const target = repositoryFixture(
    `export type Target = { ready: true };
     declare const value: Target;
     void value;
     export const result = ${expression};`,
    filename,
  );
  return lintFiles([target.file], undefined, target.workspace);
}

function baselineFor(target, counts) {
  const filename = path.join(target.workspace, 'baseline.json');
  writeFileSync(filename, JSON.stringify({ version: 1, rules: { [rule]: counts } }));
  return filename;
}

describe('no-double-cast', () => {
  it.each([
    ['value as unknown as Target', 'src/scratch.ts'],
    ['value as unknown as Target', 'src/component.tsx'],
    ['value as any as Target', 'src/scratch.ts'],
    ['<Target><unknown>value', 'src/scratch.ts'],
    ['<Target><any>value', 'src/scratch.ts'],
    ['(value as unknown) as Target', 'src/scratch.ts'],
    ['<Target>(value as unknown)', 'src/scratch.ts'],
    ['(<unknown>value) as Target', 'src/scratch.ts'],
    ['value as (unknown) as Target', 'src/scratch.ts'],
  ])('reports %s in %s', (expression, filename) => {
    const result = lintExpression(expression, filename);
    expect(result.status).toBe(1);
    // The existing no-explicit-any warning also applies to the any examples.
    const errors = result.diagnostics.filter((entry) => entry.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe(code);
    expect(errors[0].message).toBe(
      'Parse the value into the type with a type guard or narrowing instead of forcing it through unknown.',
    );
  });

  it.each([
    'value as unknown',
    '{ ready: true } as const',
    'value as Target',
    'value satisfies Target',
    'value as Target as object',
  ])('allows %s', (expression) => {
    expect(lintExpression(expression)).toEqual({ status: 0, diagnostics: [] });
  });

  it.each([
    'src/scratch.test.ts',
    'src/component.test.tsx',
    'src/scratch.spec.ts',
    'src/component.spec.tsx',
    'src/__tests__/helper.ts',
    'src/feature/__tests__/helper.tsx',
    'src/tests/helper.ts',
    'src/tests/nested/helper.tsx',
    'scripts/scratch.ts',
    'tools/src/scratch.ts',
    'src/scratch.mts',
    'src/scratch.cts',
  ])('leaves %s outside production scope', (filename) => {
    expect(lintExpression('value as unknown as Target', filename)).toEqual({
      status: 0,
      diagnostics: [],
    });
  });

  it.each(['value as any as Target', '<Target><unknown>value'])(
    'allows %s in test code',
    (expression) => {
      const result = lintExpression(expression, 'src/scratch.test.ts');
      expect(result.status).toBe(0);
      expect(result.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    },
  );

  it('keeps the existing timing and skip rules out of production files', () => {
    const target = repositoryFixture(
      "it.skip('waits', async () => { await new Promise(r => setTimeout(r, 25)); }, 10000);",
    );
    expect(lintFiles([target.file], undefined, target.workspace)).toEqual({
      status: 0,
      diagnostics: [],
    });
  });

  it('reports only new casts beyond a production file allowance, in source order', () => {
    const target = repositoryFixture(`${cast}\nexport const added = {} as unknown as object;`);
    const baseline = baselineFor(target, { [target.relative]: 1 });
    const result = lintFiles([target.file], baseline, target.workspace);
    expect(result.status).toBe(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe(code);
    expect(result.diagnostics[0].labels[0].span.line).toBe(2);
    expect(lintFiles([target.file], false, target.workspace).diagnostics).toHaveLength(2);

    writeFileSync(target.file, cast);
    expect(lintFiles([target.file], baseline, target.workspace)).toEqual({
      status: 0,
      diagnostics: [],
    });
  });

  it('keeps production allowances isolated by file and rule', () => {
    const target = repositoryFixture(cast);
    const added = path.join(target.workspace, 'src/added.ts');
    writeFileSync(added, cast);
    const baseline = baselineFor(target, { [target.relative]: 1 });
    writeFileSync(
      baseline,
      JSON.stringify({
        version: 1,
        rules: {
          [rule]: { [target.relative]: 1 },
          'voyager/no-real-sleep-in-tests': { 'src/added.ts': 10 },
        },
      }),
    );
    const result = lintFiles([target.file, added], baseline, target.workspace);
    expect(result.status).toBe(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe(code);
    expect(path.resolve(target.workspace, result.diagnostics[0].filename)).toBe(added);
  });

  it('discovers production and test files and measures unsuppressed counts', () => {
    const target = repositoryFixture(cast);
    const baseline = baselineFor(target, { [target.relative]: 1 });
    expect(lintFiles([target.file], baseline, target.workspace).status).toBe(0);
    writeFileSync(
      path.join(target.workspace, 'src/scratch.test.ts'),
      `${cast}\nit('waits', async () => { await new Promise(r => setTimeout(r, 25)); });`,
    );
    execFileSync('git', ['init', '--quiet'], { cwd: target.workspace });
    execFileSync('git', ['add', target.relative], { cwd: target.workspace });
    const current = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import { measureViolations } from './scripts/oxlint-plugin-voyager/check-baseline.mjs'; console.log(JSON.stringify(measureViolations()));",
        ],
        { cwd: target.workspace, encoding: 'utf8' },
      ),
    );
    expect(current.rules[rule]).toEqual({ 'src/scratch.ts': 1 });
    expect(current.rules['voyager/no-real-sleep-in-tests']).toEqual({ 'src/scratch.test.ts': 1 });
  });
});
