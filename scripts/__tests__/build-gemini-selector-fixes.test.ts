import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { GEMINI_SELECTOR_HOSTS } from '../../src/core/gemini/selectors/types';
import { readGeminiSelectorFile } from '../../src/core/gemini/selectors/validation';
import {
  buildGeminiSelectorFiles,
  writeGeminiSelectorFiles,
} from '../lib/buildGeminiSelectorFixes';

const temporary: string[] = [];
const catalogDir = resolve('src/features/plugins/catalog');
const sourcePath = 'sites/gemini/selector-data/turn.json';

function temp(): string {
  const path = mkdtempSync(join(tmpdir(), 'voyager-gemini-selectors-'));
  temporary.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Gemini selector publication', () => {
  it('publishes only the gemini.google.com data file with the supplied source revision', () => {
    const outDir = temp();
    const written = writeGeminiSelectorFiles({ catalogDir, outDir, catalogRevision: 42 });
    const hostsDir = join(outDir, 'gemini-selectors/v1/hosts');
    expect(readdirSync(hostsDir)).toEqual(['gemini.google.com.json']);
    expect(written).toHaveLength(1);
    const source: unknown = JSON.parse(readFileSync(join(catalogDir, sourcePath), 'utf8'));
    for (const host of GEMINI_SELECTOR_HOSTS) {
      const payload: unknown = JSON.parse(readFileSync(join(hostsDir, `${host}.json`), 'utf8'));
      const accepted = readGeminiSelectorFile(payload, host);
      expect(accepted).not.toBeNull();
      expect(accepted?.catalogRevision).toBe(42);
      expect(accepted?.selectors).toEqual(source);
      expect(payload).not.toHaveProperty('plugins');
      expect(payload).not.toHaveProperty('matches');
      expect(payload).not.toHaveProperty('theme');
    }
  });

  it('drops obsolete files only inside its own selector output directory', () => {
    const outDir = temp();
    const hostsDir = join(outDir, 'gemini-selectors/v1/hosts');
    mkdirSync(hostsDir, { recursive: true });
    writeFileSync(join(hostsDir, 'aistudio.google.com.json'), '{}');
    writeFileSync(join(hostsDir, 'business.gemini.google.json'), '{}');
    mkdirSync(join(outDir, 'hosts'));
    writeFileSync(join(outDir, 'hosts/claude.ai.json'), '{"keep":true}');
    writeGeminiSelectorFiles({ catalogDir, outDir, catalogRevision: 42 });
    expect(readdirSync(hostsDir)).toEqual(['gemini.google.com.json']);
    expect(readFileSync(join(outDir, 'hosts/claude.ai.json'), 'utf8')).toBe('{"keep":true}');
  });

  it('cannot publish an omitted bundled profile or behavior disguised as a key', () => {
    const fixture = temp();
    const directory = join(fixture, 'sites/gemini/selector-data');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'turn.json'), JSON.stringify({ 'turn.user': ['.user'] }));
    expect(() => buildGeminiSelectorFiles({ catalogDir: fixture, catalogRevision: 42 })).toThrow(
      'all five',
    );
    const current = JSON.parse(readFileSync(join(catalogDir, sourcePath), 'utf8')) as Record<
      string,
      unknown
    >;
    writeFileSync(
      join(directory, 'turn.json'),
      JSON.stringify({ ...current, capabilities: ['chat'] }),
    );
    expect(() => buildGeminiSelectorFiles({ catalogDir: fixture, catalogRevision: 42 })).toThrow();
  });

  it('refuses a serialized file over the byte budget before publishing any host', () => {
    const fixture = temp();
    const directory = join(fixture, 'sites/gemini/selector-data');
    mkdirSync(directory, { recursive: true });
    const current = JSON.parse(readFileSync(join(catalogDir, sourcePath), 'utf8')) as Record<
      string,
      unknown
    >;
    const large = {
      ...current,
      'turn.user': Array.from({ length: 32 }, () => `.${'a'.repeat(2047)}`),
    };
    writeFileSync(join(directory, 'turn.json'), JSON.stringify(large));
    const outDir = temp();
    expect(() =>
      writeGeminiSelectorFiles({ catalogDir: fixture, outDir, catalogRevision: 42 }),
    ).toThrow();
    expect(readdirSync(outDir)).toEqual([]);
  });
});
