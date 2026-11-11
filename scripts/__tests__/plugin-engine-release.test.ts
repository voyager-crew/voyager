import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../..');
const tempRoots: string[] = [];
const contractPath = 'src/features/plugins/verbs/futureVerb/contract.ts';
const baselinePath = 'src/features/plugins/verbs/futureVerb/paramsBaseline.json';
const pluginPath = 'src/features/plugins/catalog/sites/example/plugins/future/plugin.json';
const constantsPath = 'src/features/plugins/constants.ts';

function write(root: string, path: string, source: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}

/** Exercise the actual bump and gate executables without touching the working tree. */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'gv-engine-release-'));
  tempRoots.push(root);
  symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
  for (const path of [
    'scripts/bump-version.js',
    'scripts/plugin-release-check.ts',
    'scripts/lib/pluginEngineRelease.ts',
    constantsPath,
    'src/features/plugins/engineVersion.ts',
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(repoRoot, path), join(root, path));
  }
  for (const path of [
    'package.json',
    'manifest.json',
    'manifest.dev.json',
    'packages/create-voyager-plugin/package.json',
  ]) {
    write(root, path, '{"version": "1.9.9", "type": "module"}\n');
  }
  write(
    root,
    'Voyager/Voyager.xcodeproj/project.pbxproj',
    'MARKETING_VERSION = 1.9.9;\nCURRENT_PROJECT_VERSION = 1.9.9;\n',
  );
  write(
    root,
    contractPath,
    "export const contract = { name: 'futureVerb', sinceEngine: 'next', params: { extra: { sinceEngine: 'next', required: false } } };\n",
  );
  write(
    root,
    baselinePath,
    JSON.stringify({
      sinceEngine: 'next',
      params: { extra: { sinceEngine: 'next', type: 'boolean', required: false } },
    }),
  );
  write(
    root,
    pluginPath,
    JSON.stringify({
      engine: '>=next',
      description: "Keep next and sinceEngine: 'next' in user data",
    }),
  );
  write(
    root,
    'src/features/plugins/verbs/shipped/contract.ts',
    "export const contract = { name: 'shipped', sinceEngine: '1.0.0', params: { extra: { sinceEngine: 'next', required: false } } };\n",
  );
  write(
    root,
    'src/features/plugins/verbs/shipped/paramsBaseline.json',
    JSON.stringify({
      sinceEngine: '1.0.0',
      params: { extra: { sinceEngine: 'next', type: 'boolean', required: false } },
    }),
  );
  return root;
}

function run(root: string, script: string, args: string[] = []) {
  return spawnSync('bun', [join(root, script), ...args], { cwd: root, encoding: 'utf8' });
}

function json(root: string, path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('plugin engine release stamping', () => {
  it('blocks release before bump and stamps contracts, parameter baselines and plugin engines together', () => {
    const root = fixture();
    const before = run(root, 'scripts/plugin-release-check.ts');
    expect(before.status, before.stderr).toBe(1);
    expect(before.stderr).toContain(contractPath);
    expect(before.stderr).toContain(baselinePath);
    expect(before.stderr).toContain(pluginPath);

    const bump = run(root, 'scripts/bump-version.js', ['--no-format']);
    expect(bump.status, bump.stderr).toBe(0);
    for (const path of [
      'package.json',
      'manifest.json',
      'manifest.dev.json',
      'packages/create-voyager-plugin/package.json',
    ]) {
      expect(json(root, path).version).toBe('2.0.0');
    }
    expect(readFileSync(join(root, 'Voyager/Voyager.xcodeproj/project.pbxproj'), 'utf8')).toBe(
      'MARKETING_VERSION = 2.0.0;\nCURRENT_PROJECT_VERSION = 2.0.0;\n',
    );
    expect(readFileSync(join(root, constantsPath), 'utf8')).toBe(
      readFileSync(join(repoRoot, constantsPath), 'utf8'),
    );
    expect(readFileSync(join(root, contractPath), 'utf8')).toContain("sinceEngine: '2.0.0'");
    expect(json(root, baselinePath)).toEqual({
      sinceEngine: '2.0.0',
      params: { extra: { sinceEngine: '2.0.0', type: 'boolean', required: false } },
    });
    expect(json(root, 'src/features/plugins/verbs/shipped/paramsBaseline.json')).toEqual({
      sinceEngine: '1.0.0',
      params: { extra: { sinceEngine: '2.0.0', type: 'boolean', required: false } },
    });
    expect(json(root, pluginPath)).toEqual({
      engine: '>=2.0.0',
      description: "Keep next and sinceEngine: 'next' in user data",
    });
    const after = run(root, 'scripts/plugin-release-check.ts');
    expect(after.status, after.stderr).toBe(0);

    const constants = readFileSync(join(root, constantsPath), 'utf8');
    const second = run(root, 'scripts/bump-version.js', ['3.4.5', '--no-format']);
    expect(second.status, second.stderr).toBe(0);
    expect(json(root, 'package.json').version).toBe('3.4.5');
    expect(readFileSync(join(root, constantsPath), 'utf8')).toBe(constants);
  });

  it('stamps next with an explicit release version, and again on a re-bump to the same version', () => {
    const root = fixture();
    const bump = run(root, 'scripts/bump-version.js', ['2.4.0', '--no-format']);
    expect(bump.status, bump.stderr).toBe(0);
    expect(readFileSync(join(root, contractPath), 'utf8')).toContain("sinceEngine: '2.4.0'");
    expect(json(root, pluginPath).engine).toBe('>=2.4.0');

    write(root, pluginPath, '{"engine":">=next"}');
    const rebump = run(root, 'scripts/bump-version.js', ['2.4.0', '--no-format']);
    expect(rebump.status, rebump.stderr).toBe(0);
    expect(json(root, 'package.json').version).toBe('2.4.0');
    expect(json(root, pluginPath)).toEqual({ engine: '>=2.4.0' });
  });

  it('catches an unpublished parameter even when its primitive and plugin are already released', () => {
    const root = fixture();
    write(
      root,
      contractPath,
      "export const contract = { sinceEngine: '1.0.0', params: { extra: { sinceEngine: 'next' } } };\n",
    );
    write(root, baselinePath, '{"sinceEngine":"1.0.0","params":{"extra":{"sinceEngine":"next"}}}');
    write(root, pluginPath, '{"engine":">=1.0.0"}');
    const result = run(root, 'scripts/plugin-release-check.ts');
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(contractPath);
    expect(result.stderr).toContain(baselinePath);
  });

  it('rejects malformed declarations before changing any release versions', () => {
    const root = fixture();
    write(root, pluginPath, '{"engine": ">=next",');
    const result = run(root, 'scripts/bump-version.js', ['--no-format']);
    expect(result.status, result.stderr).toBe(1);
    expect(json(root, 'package.json').version).toBe('1.9.9');
    expect(readFileSync(join(root, contractPath), 'utf8')).toContain("sinceEngine: 'next'");
    const gate = run(root, 'scripts/plugin-release-check.ts');
    expect(gate.status, gate.stderr).toBe(1);
  });

  it('stamps quoted and template declaration fields and imported parameter data while preserving prose', () => {
    const root = fixture();
    const sharedPath = 'src/features/plugins/verbs/codeBlockDiagramParams.ts';
    const contract = [
      "import { params } from '../codeBlockDiagramParams';",
      "// sinceEngine: 'next' describes the authoring notation.",
      'export const contract = {',
      '  "sinceEngine": `next`,',
      '  params,',
      "  description: \"Keep sinceEngine: 'next' and engine: 'next' in this text.\",",
      '};',
      '',
    ].join('\n');
    const shared = [
      "// sinceEngine: 'next' is prose, not a declaration.",
      'export const params = {',
      "  extra: { 'sinceEngine': `next`, type: 'boolean', required: false },",
      '  label: { description: "sinceEngine: \'next\'", required: false },',
      '};',
      '',
    ].join('\n');
    write(root, contractPath, contract);
    write(root, sharedPath, shared);
    const untouchedPath = 'src/features/plugins/verbs/futureVerb/index.ts';
    write(root, untouchedPath, "export const userData = { sinceEngine: 'next' };\n");
    const plugin =
      '{\n  "engine": ">=next",\n  "metadata": { "engine": ">=next" },\n  "description": "engine: \'next\'"\n}\n';
    write(root, pluginPath, plugin);
    const before = run(root, 'scripts/plugin-release-check.ts');
    expect(before.status, before.stderr).toBe(1);
    expect(before.stderr).toContain(sharedPath);
    expect(before.stderr).toContain(contractPath);
    expect(before.stderr).not.toContain(untouchedPath);

    const bump = run(root, 'scripts/bump-version.js', ['--no-format']);
    expect(bump.status, bump.stderr).toBe(0);
    expect(readFileSync(join(root, contractPath), 'utf8')).toBe(
      contract.replace('"sinceEngine": `next`', '"sinceEngine": `2.0.0`'),
    );
    expect(readFileSync(join(root, sharedPath), 'utf8')).toBe(
      shared.replace("'sinceEngine': `next`", "'sinceEngine': `2.0.0`"),
    );
    expect(readFileSync(join(root, untouchedPath), 'utf8')).toBe(
      "export const userData = { sinceEngine: 'next' };\n",
    );
    expect(readFileSync(join(root, pluginPath), 'utf8')).toBe(
      plugin.replace('"engine": ">=next"', '"engine": ">=2.0.0"'),
    );
    const after = run(root, 'scripts/plugin-release-check.ts');
    expect(after.status, after.stderr).toBe(0);
  });
});
