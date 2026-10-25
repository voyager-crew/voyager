import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../check-staged-size.mjs');
const LIMIT_BYTES = 20_000;

describe('check-staged-size', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'gv-staged-size-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  const stage = (path: string, content: string | Buffer) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
    execFileSync('git', ['add', '-f', '--', path], { cwd: repo });
  };
  const run = () => spawnSync('node', [SCRIPT], { cwd: repo, encoding: 'utf8' });

  it('blocks a staged file over 5000 tokens and explains how to split it', () => {
    stage('src/big.ts', 'x'.repeat(LIMIT_BYTES + 1));
    stage('src/small.ts', 'x'.repeat(LIMIT_BYTES));

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/big.ts  5001 tokens (20001 bytes)');
    expect(result.stderr).not.toContain('src/small.ts');
    expect(result.stderr).toContain('Split each file');
  });

  it('measures the staged content, not the working tree', () => {
    stage('src/file.ts', 'x'.repeat(100));
    writeFileSync(join(repo, 'src/file.ts'), 'x'.repeat(LIMIT_BYTES * 2));

    expect(run().status).toBe(0);
  });

  it('skips lockfiles, binaries, build output, Chrome locale catalogs and privacy pages', () => {
    const big = 'x'.repeat(LIMIT_BYTES * 2);
    stage('bun.lock', big);
    stage('dist_chrome/content.js', big);
    stage('src/locales/en/messages.json', big);
    stage('docs/ru/privacy.md', big);
    stage('docs/public/assets/shot.png', Buffer.concat([Buffer.from([0]), Buffer.from(big)]));

    expect(run().status).toBe(0);
  });
});
