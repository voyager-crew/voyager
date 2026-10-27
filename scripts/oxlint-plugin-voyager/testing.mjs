import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { REPOSITORY_ROOT, RULE_IDS } from './baseline.mjs';

const workspaces = new Set();

export function fixture(source, filename = 'scratch.test.ts') {
  const workspace = mkdtempSync(
    path.join(REPOSITORY_ROOT, 'scripts/oxlint-plugin-voyager/.fixture-'),
  );
  workspaces.add(workspace);
  const file = path.join(workspace, filename);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
  return {
    file,
    workspace,
    relative: path.relative(REPOSITORY_ROOT, file).split(path.sep).join('/'),
  };
}

export function cleanupFixtures() {
  for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
  workspaces.clear();
}

/** Exercise real src paths without writing fixtures into the checkout's src tree. */
export function repositoryFixture(source, filename = 'src/scratch.ts') {
  const workspace = mkdtempSync(path.join(tmpdir(), 'voyager-lint-fixture-'));
  workspaces.add(workspace);
  cpSync(
    path.join(REPOSITORY_ROOT, 'scripts/oxlint-plugin-voyager'),
    path.join(workspace, 'scripts/oxlint-plugin-voyager'),
    { recursive: true, filter: (file) => !path.basename(file).startsWith('.fixture-') },
  );
  cpSync(path.join(REPOSITORY_ROOT, '.oxlintrc.json'), path.join(workspace, '.oxlintrc.json'));
  symlinkSync(path.join(REPOSITORY_ROOT, 'node_modules'), path.join(workspace, 'node_modules'));
  const file = path.join(workspace, filename);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
  return { workspace, file, relative: filename };
}

export function lintFiles(files, baseline, repositoryRoot = REPOSITORY_ROOT) {
  let config = path.join(repositoryRoot, '.oxlintrc.json');
  if (baseline !== undefined) {
    const { workspace } = fixture('');
    config = path.join(workspace, 'oxlint.json');
    writeFileSync(
      config,
      JSON.stringify({
        extends: [path.join(repositoryRoot, '.oxlintrc.json')],
        overrides: [
          {
            files: ['**/*'],
            rules: Object.fromEntries(RULE_IDS.map((rule) => [rule, ['error', { baseline }]])),
          },
        ],
      }),
    );
  }
  const result = spawnSync(
    path.join(REPOSITORY_ROOT, 'node_modules/.bin/oxlint'),
    ['-c', config, '-f', 'json', ...files],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 5000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  if (!Array.isArray(payload.diagnostics)) throw new Error(result.stdout);
  return { status: result.status, diagnostics: payload.diagnostics };
}

export function lintSource(source, filename) {
  const { file } = fixture(source, filename);
  return lintFiles([file]);
}
