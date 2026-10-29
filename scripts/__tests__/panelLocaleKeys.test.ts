import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const checker = join(process.cwd(), 'scripts/check-locale-keys.mjs');
const panelMessages = 'src/pages/panel/messages';
const shellMessages = 'src/pages/content/panelShell/messages';
let root: string;

function messages(path: string, entries: Record<string, { message: string }>): void {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, JSON.stringify(entries));
}

function check() {
  const result = spawnSync('node', [checker], { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voyager-panel-locales-'));
  mkdirSync(join(root, 'src/features/plugins/verbs'), { recursive: true });
  for (const language of ['en', 'ru']) {
    messages(`src/locales/${language}/messages.json`, { common: { message: 'Common' } });
    messages(`${panelMessages}/${language}.json`, { panelCount: { message: '{count} items' } });
    messages(`${shellMessages}/${language}.json`, { shellOpen: { message: 'Open' } });
  }
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('panel and shell locale fragments', () => {
  it('accepts symmetric fragments, including empty fragments before UI keys are added', () => {
    expect(check().status).toBe(0);
    for (const directory of [panelMessages, shellMessages]) {
      for (const language of ['en', 'ru']) messages(`${directory}/${language}.json`, {});
    }
    expect(check().status).toBe(0);
  });

  it.each([panelMessages, shellMessages])('refuses an asymmetric fragment in %s', (directory) => {
    messages(`${directory}/ru.json`, {});
    const result = check();
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${directory}: ru.json is missing key`);
  });

  it('refuses placeholder differences in panel messages', () => {
    messages(`${panelMessages}/ru.json`, { panelCount: { message: '{total} items' } });
    const result = check();
    expect(result.status).toBe(1);
    expect(result.output).toContain('panelCount has different {placeholders}');
  });

  it('refuses collisions between the panel and shell fragments', () => {
    for (const language of ['en', 'ru']) {
      messages(`${shellMessages}/${language}.json`, { panelCount: { message: '{count} items' } });
    }
    const result = check();
    expect(result.status).toBe(1);
    expect(result.output).toContain('en.json key panelCount is also in');
  });

  it('refuses collisions with base messages', () => {
    for (const language of ['en', 'ru']) {
      messages(`${panelMessages}/${language}.json`, { common: { message: 'Common' } });
    }
    const result = check();
    expect(result.status).toBe(1);
    expect(result.output).toContain('en.json key common is also in src/locales/en/messages.json');
  });

  it('requires every fragment locale file', () => {
    rmSync(join(root, shellMessages, 'ru.json'));
    const result = check();
    expect(result.status).toBe(1);
    expect(result.output).toContain('missing locale file ru.json');
  });
});
