import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { inspectLocatorSource } from '../check-locator-contracts';
import type { LocatorLiteralException } from '../lib/locatorExceptions/types';

const ROOT = process.cwd();
const scratch: string[] = [];

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

function runChecker(exception?: { readonly file: string; readonly value: string }) {
  const directory = mkdtempSync(join(tmpdir(), 'gv-locator-exception-'));
  scratch.push(directory);
  // Scan one native owner, so CI load cannot turn each stale-review assertion into a repository scan.
  const owner = 'src/core/gemini/code/hosts.ts';
  mkdirSync(join(directory, 'src/core/gemini/code'), { recursive: true });
  writeFileSync(join(directory, owner), 'query("code-block");');
  mkdirSync(join(directory, 'scripts/lib'), { recursive: true });
  copyFileSync(
    join(ROOT, 'scripts/lib/siteFragmentBaseline.json'),
    join(directory, 'scripts/lib/siteFragmentBaseline.json'),
  );
  for (const site of ['gemini', 'aistudio', 'chatgpt', 'claude', 'deepseek', 'kimi']) {
    const fragments = `src/features/plugins/catalog/sites/${site}/selector-data`;
    cpSync(join(ROOT, fragments), join(directory, fragments), { recursive: true });
  }
  const preload = join(directory, 'review.ts');
  const reviews: LocatorLiteralException[] = [
    {
      file: owner,
      kind: 'proof',
      values: { 'code-block': 1 },
      reason: 'Test-only native code owner',
    },
  ];
  if (exception)
    reviews.push({
      file: exception.file,
      kind: 'proof',
      values: { [exception.value]: 1 },
      reason: 'Test-only retired native proof',
    });
  // Preload scopes reviews to the fixture in this child process only.
  writeFileSync(
    preload,
    `import { LOCATOR_LITERAL_EXCEPTIONS } from ${JSON.stringify(join(ROOT, 'scripts/lib/locatorLiteralExceptions.ts'))};
Reflect.apply(Array.prototype.splice, LOCATOR_LITERAL_EXCEPTIONS, [0, LOCATOR_LITERAL_EXCEPTIONS.length, ...${JSON.stringify(reviews)}]);`,
  );
  return spawnSync(
    'bun',
    ['--preload', preload, join(ROOT, 'scripts/check-locator-contracts.ts')],
    {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
}

it('the locator gate accepts a reviewed native proof in the fixture tree', () => {
  const result = runChecker();
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Locator contracts:');
});

it.each(['src/core/gemini/code/hosts.ts', 'src/pages/content/retiredNativeProof.ts'])(
  'a vanished native proof leaves a stale exception in %s',
  (file) => {
    const value = '[data-test-id="conversation-title"]';
    const result = runChecker({ file, value });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${file}:1: stale locator exception`);
    expect(result.stderr).toContain(JSON.stringify(value));
    expect(result.stderr).toContain('has no occurrence');
  },
);

it('removing one reviewed native occurrence also fails before the last one disappears', () => {
  const file = 'src/core/gemini/content/reads.ts';
  expect(inspectLocatorSource(file, 'query("message-actions"); query("message-actions");')).toEqual(
    [],
  );
  const failures = inspectLocatorSource(file, 'query("message-actions");');
  expect(failures).toEqual([expect.objectContaining({ file, line: 1 })]);
  expect(failures[0].reason).toContain('occurrence count changed');
});
