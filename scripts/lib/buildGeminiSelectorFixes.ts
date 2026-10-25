import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  GEMINI_SELECTOR_HOSTS,
  GEMINI_TURN_PROFILE_KEYS,
  type GeminiSelectorFile,
} from '../../src/core/gemini/selectors/types';
import {
  MAX_GEMINI_SELECTOR_BYTES,
  readGeminiSelectorFile,
} from '../../src/core/gemini/selectors/validation';

export interface GeminiSelectorPublishOptions {
  readonly catalogDir: string;
  readonly outDir: string;
  readonly catalogRevision: number;
}

/** Build from the same five ordered lists the package imports; no adapter or plugin enters this file. */
export function buildGeminiSelectorFiles(
  options: Pick<GeminiSelectorPublishOptions, 'catalogDir' | 'catalogRevision'>,
): ReadonlyMap<string, GeminiSelectorFile> {
  if (!Number.isSafeInteger(options.catalogRevision) || options.catalogRevision <= 0) {
    throw new Error('Gemini selector publication requires a positive source revision');
  }
  const path = join(options.catalogDir, 'sites/gemini/selector-data/turn.json');
  const raw = readFileSync(path, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > MAX_GEMINI_SELECTOR_BYTES) {
    throw new Error('Gemini selector source exceeds the decoded byte limit');
  }
  const selectors: unknown = JSON.parse(raw);
  const files = new Map<string, GeminiSelectorFile>();
  for (const host of GEMINI_SELECTOR_HOSTS) {
    const file = readGeminiSelectorFile(
      {
        format: 1,
        site: 'gemini',
        host,
        catalogRevision: options.catalogRevision,
        selectors,
      },
      host,
    );
    if (!file || GEMINI_TURN_PROFILE_KEYS.some((key) => !file.selectors[key])) {
      throw new Error(`${path}: bundled Gemini selector data must contain all five profiles`);
    }
    files.set(host, file);
  }
  return files;
}

export function writeGeminiSelectorFiles(options: GeminiSelectorPublishOptions): readonly string[] {
  const files = buildGeminiSelectorFiles(options);
  const hostsDir = join(options.outDir, 'gemini-selectors/v1/hosts');
  const serialized = [...files].map(([host, file]) => {
    const json = `${JSON.stringify(file, null, 2)}\n`;
    // Measure the actual published UTF-8 file, not the in-memory list lengths.
    if (Buffer.byteLength(json, 'utf8') > MAX_GEMINI_SELECTOR_BYTES) {
      throw new Error(`${host}: published Gemini selector file exceeds the decoded byte limit`);
    }
    if (!readGeminiSelectorFile(JSON.parse(json) as unknown, host)) {
      throw new Error(`${host}: serialized Gemini selector file was rejected`);
    }
    return { name: `${host}.json`, json };
  });
  mkdirSync(hostsDir, { recursive: true });
  const written = serialized.map(({ name, json }) => {
    const path = join(hostsDir, name);
    writeFileSync(path, json, 'utf8');
    return path;
  });
  const names = new Set(serialized.map(({ name }) => name));
  for (const name of readdirSync(hostsDir)) {
    if (name.endsWith('.json') && !names.has(name)) rmSync(join(hostsDir, name), { force: true });
  }
  return written;
}
