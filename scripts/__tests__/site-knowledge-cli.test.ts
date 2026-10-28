import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const checker = resolve(__dirname, '../check-site-knowledge.ts');

it('reads fixture site ids through the CLI, fails on violations, and refuses arguments', () => {
  const root = mkdtempSync(join(tmpdir(), 'voyager-site-knowledge-'));
  function write(file: string, text: string): void {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  const run = () =>
    spawnSync(
      'bun',
      [
        '--eval',
        `
    import { runSiteKnowledgeCheck } from ${JSON.stringify(checker)};
    process.exitCode = runSiteKnowledgeCheck([], process.cwd(), {
      owners: { file: 'fixture/owners.ts', entries: [] }, exceptions: [],
    });
  `,
      ],
      { cwd: root, encoding: 'utf8' },
    );
  try {
    write('src/features/plugins/catalog/sites/unrelated-name/site.json', '{"id":"fixture-site"}');
    write('src/shared.ts', 'const oldName = "gemini";');
    const accepted = run();
    expect(accepted.status).toBe(0);
    expect(accepted.stdout).toContain('1 site ids; 0 occurrences');

    write('src/shared.ts', '// header\nconst site = "fixture-site";');
    const violation = run();
    expect(violation.status).toBe(1);
    expect(violation.stderr).toContain('src/shared.ts:2: site id "fixture-site" (literal)');
    expect(violation.stdout).toBe('');

    const argument = spawnSync('bun', [checker, '--update'], { cwd: root, encoding: 'utf8' });
    expect(argument.status).toBe(1);
    expect(argument.stderr).toContain('read-only; no arguments');
    expect(argument.stderr).not.toContain('site id');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
