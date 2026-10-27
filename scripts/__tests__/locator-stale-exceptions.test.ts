import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { inspectLocatorSource } from '../check-locator-contracts';

const scratch: string[] = [];

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

function runChecker(exception?: { readonly file: string; readonly value: string }) {
  const directory = mkdtempSync(join(tmpdir(), 'gv-locator-exception-'));
  scratch.push(directory);
  const preload = join(directory, 'review.ts');
  // Preload changes only this child process's review data, never the repository's files.
  writeFileSync(
    preload,
    exception
      ? `import { LOCATOR_LITERAL_EXCEPTIONS } from ${JSON.stringify(resolve('scripts/lib/locatorLiteralExceptions.ts'))};
Reflect.apply(Array.prototype.push, LOCATOR_LITERAL_EXCEPTIONS, [{
  file: ${JSON.stringify(exception.file)}, kind: 'proof',
  values: { [${JSON.stringify(exception.value)}]: 1 }, reason: 'Test-only retired native proof'
}]);`
      : '',
  );
  return spawnSync('bun', ['--preload', preload, 'scripts/check-locator-contracts.ts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
  });
}

it('the locator gate still accepts the current native proof reviews', () => {
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
