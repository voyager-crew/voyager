import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import {
  inspectSiteFragmentOwnership,
  readSiteFragmentBaseline,
} from '../lib/siteFragmentOwnership';

const BASELINE = 'scripts/lib/siteFragmentBaseline.json';
const roots: string[] = [];

function scratchRoot(): string {
  mkdirSync('.build', { recursive: true });
  const root = mkdtempSync('.build/ownership-test-');
  roots.push(root);
  mkdirSync(join(root, 'scripts/lib'), { recursive: true });
  copyFileSync(BASELINE, join(root, BASELINE));
  for (const site of ['gemini', 'aistudio', 'chatgpt', 'claude', 'deepseek', 'kimi'])
    mkdirSync(join(root, `src/features/plugins/catalog/sites/${site}/selector-data`), {
      recursive: true,
    });
  return root;
}

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it('cannot launder a foreign input through an updated OFF snapshot', () => {
  const root = scratchRoot();
  const file = 'src/features/plugins/catalog/sites/claude/selector-data/input.json';
  writeFileSync(
    join(root, file),
    JSON.stringify({ 'input.candidates': ['ms-prompt-input textarea'] }),
  );
  const fixtures = join(root, 'src/core/selectors/__tests__/fixtures/bundled-off');
  mkdirSync(fixtures, { recursive: true });
  writeFileSync(
    join(fixtures, 'claude-01.json'),
    JSON.stringify([['input.json/input.candidates', ['ms-prompt-input textarea']]]),
  );
  expect(inspectSiteFragmentOwnership(root)).toEqual([
    expect.objectContaining({ file, reason: expect.stringContaining('aistudio-only') }),
  ]);
});

it('keeps legacy fallback exemptions tied to the original site and fragment row', () => {
  const root = scratchRoot();
  const file = 'src/features/plugins/catalog/sites/claude/selector-data/input.json';
  writeFileSync(
    join(root, file),
    JSON.stringify({
      'input.candidates': ['rich-textarea [contenteditable="true"]'],
      'new.reader': ['rich-textarea [contenteditable="true"]'],
    }),
  );
  expect(inspectSiteFragmentOwnership(root)).toEqual([
    expect.objectContaining({ file, reason: expect.stringContaining('new.reader') }),
  ]);
});

it('requires a reviewed reason for every new frozen ownership exemption', () => {
  const root = scratchRoot();
  const data: { entries: unknown[] } = JSON.parse(readFileSync(join(root, BASELINE), 'utf8'));
  data.entries.push({
    sites: ['claude'],
    row: 'input.json/input.candidates',
    values: ['ms-prompt-input textarea'],
  });
  writeFileSync(join(root, BASELINE), JSON.stringify(data));
  expect(() => inspectSiteFragmentOwnership(root)).toThrow('needs a reviewed reason');
});

it('validates the committed exemption reasons before accepting bundled fragments', () => {
  expect(readSiteFragmentBaseline(process.cwd()).length).toBeGreaterThan(0);
  expect(inspectSiteFragmentOwnership(process.cwd())).toEqual([]);
});
