import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  BASELINE_PATH,
  isProductionFile,
  isTestCode,
  readBaseline,
  relativeFilename,
  REPOSITORY_ROOT,
  RULE_IDS,
  tightenBaseline,
} from './baseline.mjs';

/** Ask the real linter for unsuppressed counts, using the same rules as lint:check. */
export function measureViolations(files) {
  if (!files) {
    files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(
        (file) => (isTestCode(file) || isProductionFile(file)) && /\.[cm]?[jt]sx?$/.test(file),
      )
      .filter((file) => {
        try {
          return lstatSync(path.join(REPOSITORY_ROOT, file)).isFile();
        } catch (error) {
          if (error.code === 'ENOENT') return false;
          throw error;
        }
      });
  }
  const current = { version: 1, rules: Object.fromEntries(RULE_IDS.map((rule) => [rule, {}])) };
  if (files.length === 0) return current;
  const workspace = mkdtempSync(path.join(tmpdir(), 'voyager-lint-baseline-'));
  try {
    const configPath = path.join(workspace, 'oxlint.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        plugins: [],
        categories: { correctness: 'off' },
        jsPlugins: [
          {
            name: 'voyager',
            specifier: path.join(REPOSITORY_ROOT, 'scripts/oxlint-plugin-voyager/index.mjs'),
          },
        ],
        rules: Object.fromEntries(RULE_IDS.map((rule) => [rule, ['error', { baseline: false }]])),
      }),
    );
    const result = spawnSync(
      path.join(REPOSITORY_ROOT, 'node_modules/.bin/oxlint'),
      ['-c', configPath, '-f', 'json', ...files],
      { cwd: REPOSITORY_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 1) {
      throw new Error(`Oxlint did not complete: ${result.stderr || result.stdout}`);
    }
    const payload = JSON.parse(result.stdout);
    if (!Array.isArray(payload.diagnostics))
      throw new Error('Oxlint returned no diagnostics array');
    for (const diagnostic of payload.diagnostics) {
      const rule = RULE_IDS.find((id) => diagnostic.code === id.replace('/', '(') + ')');
      if (!rule) throw new Error(`Fix the linter error before measuring: ${diagnostic.message}`);
      const relative = relativeFilename(diagnostic.filename);
      current.rules[rule][relative] = (current.rules[rule][relative] ?? 0) + 1;
    }
    if (result.status !== 0 && payload.diagnostics.length === 0) {
      throw new Error(`Oxlint failed without diagnostics: ${result.stderr}`);
    }
    return current;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

export function compareCounts(baseline, current) {
  const errors = [];
  const shrunk = [];
  for (const rule of RULE_IDS) {
    for (const [file, count] of Object.entries(current.rules[rule] ?? {})) {
      const allowance = baseline.rules[rule]?.[file] ?? 0;
      if (count > allowance) errors.push(`${file}: ${rule} grew from ${allowance} to ${count}`);
    }
    for (const [file, count] of Object.entries(baseline.rules[rule] ?? {})) {
      if ((current.rules[rule]?.[file] ?? 0) < count) shrunk.push(`${file}: ${rule}`);
    }
  }
  return { errors, shrunk };
}

export function updateBaseline(filename = BASELINE_PATH, files) {
  const previous = readBaseline(filename);
  const current = measureViolations(files);
  const next = tightenBaseline(previous, current);
  writeFileSync(filename, `${JSON.stringify(next, null, 2)}\n`);
  return compareCounts(next, current);
}

function main() {
  const updating = process.argv.includes('--update');
  const result = updating ? updateBaseline() : compareCounts(readBaseline(), measureViolations());
  if (updating) console.log('Voyager lint baseline tightened; no allowances added or raised.');
  for (const error of result.errors) console.error(error);
  if (result.errors.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log('Voyager lint OK: no file/rule count exceeds its baseline.');
  if (result.shrunk.length > 0) {
    console.log(
      `${result.shrunk.length} allowances can shrink: bun scripts/oxlint-plugin-voyager/check-baseline.mjs --update`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
