import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getBundledGeminiSelectorView } from '../../src/core/gemini/selectors/bundle';
import type {
  GeminiSelectorFile,
  GeminiSelectorProfileKey,
} from '../../src/core/gemini/selectors/types';
import { readGeminiSelectorFile } from '../../src/core/gemini/selectors/validation';
import {
  buildGeminiSelectorFiles,
  writeGeminiSelectorFiles,
} from '../lib/buildGeminiSelectorFixes';

const temporary: string[] = [];
const catalogDir = resolve('src/features/plugins/catalog');
const dataPath = 'sites/gemini/selector-data';
const host = 'gemini.google.com';

function temp(): string {
  const path = mkdtempSync(join(tmpdir(), 'voyager-gemini-selectors-'));
  temporary.push(path);
  return path;
}

function fixtureCatalog(): string {
  const path = temp();
  const destination = join(path, dataPath);
  mkdirSync(destination, { recursive: true });
  for (const file of ['turn.json', 'sidebar.json', 'model-picker.json', 'composer.json']) {
    writeFileSync(join(destination, file), readFileSync(join(catalogDir, dataPath, file)));
  }
  return path;
}

function published(outDir: string, version: 'v1' | 'v2' | 'v3'): GeminiSelectorFile {
  const path = join(outDir, 'gemini-selectors', version, 'hosts', `${host}.json`);
  const file = readGeminiSelectorFile(JSON.parse(readFileSync(path, 'utf8')) as unknown, host);
  if (!file) throw new Error(`Published ${version} file is invalid`);
  return file;
}

function readNodes(profiles: GeminiSelectorFile['selectors'], key: GeminiSelectorProfileKey) {
  const selectors = profiles[key];
  if (!selectors) throw new Error(`Missing published profile: ${key}`);
  return Array.from(document.querySelectorAll(selectors.join(','))).map((node) => ({
    node,
    id: node.id,
    text: node.textContent,
  }));
}

afterEach(() => {
  document.body.replaceChildren();
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Gemini selector publication', () => {
  it('keeps old clients reading their turns and rows when v3 adds composer fixes', () => {
    document.body.innerHTML = `
      <div id="question-b" class="user-query-container">Second</div>
      <div id="question-a" class="user-query-container">First</div>
      <nav data-test-id="overflow-container">
        <a id="row-b" data-test-id="conversation"><span class="gds-label-l">Second chat</span></a>
        <a id="row-a" data-test-id="conversation"><span class="gds-label-l">First chat</span></a>
      </nav>
      <div role="menu">
        <button id="model-fast" data-mode-id="fast">Fast</button>
        <button id="model-pro" data-mode-id="pro">Pro</button>
      </div>
      <rich-textarea><div id="draft" contenteditable="true" role="textbox">Unsent draft</div></rich-textarea>`;
    const outDir = temp();
    const written = writeGeminiSelectorFiles({ catalogDir, outDir, catalogRevision: 42 });
    expect(written).toHaveLength(3);
    const legacy = published(outDir, 'v1');
    const sidebarClient = published(outDir, 'v2');
    const current = published(outDir, 'v3');
    expect(legacy.format).toBe(1);
    expect(sidebarClient.format).toBe(2);
    expect(current.format).toBe(3);
    expect(legacy.catalogRevision).toBe(42);
    expect(sidebarClient.catalogRevision).toBe(42);
    expect(current.catalogRevision).toBe(42);
    const bundled = getBundledGeminiSelectorView().profiles;
    expect(readNodes(legacy.selectors, 'turn.user')).toEqual(readNodes(bundled, 'turn.user'));
    const comparableKeys = ['turn.user', 'sidebar.row', 'modelPicker.modelIdItem'] as const;
    for (const key of comparableKeys) {
      expect(readNodes(sidebarClient.selectors, key)).toEqual(readNodes(bundled, key));
      expect(readNodes(current.selectors, key)).toEqual(readNodes(bundled, key));
    }
    expect(readNodes(current.selectors, 'composer.candidates')).toEqual(
      readNodes(bundled, 'composer.candidates'),
    );
    expect(readNodes(current.selectors, 'composer.candidates').map((input) => input.text)).toEqual([
      'Unsent draft',
    ]);
    expect(readNodes(current.selectors, 'sidebar.row').map((row) => row.id)).toEqual([
      'row-b',
      'row-a',
    ]);
    // v1's frozen guard would reject the expanded payload; its projection must remain readable.
    expect(readGeminiSelectorFile({ ...current, format: 1 }, host)).toBeNull();
    expect(readGeminiSelectorFile({ ...current, format: 2 }, host)).toBeNull();
  });

  it('removes obsolete hosts in all versions while preserving unrelated catalogs', () => {
    const outDir = temp();
    for (const version of ['v1', 'v2', 'v3']) {
      const hostsDir = join(outDir, 'gemini-selectors', version, 'hosts');
      mkdirSync(hostsDir, { recursive: true });
      writeFileSync(join(hostsDir, 'aistudio.google.com.json'), '{}');
      writeFileSync(join(hostsDir, 'business.gemini.google.json'), '{}');
    }
    mkdirSync(join(outDir, 'hosts'));
    writeFileSync(join(outDir, 'hosts/claude.ai.json'), '{"keep":true}');
    writeGeminiSelectorFiles({ catalogDir, outDir, catalogRevision: 42 });
    for (const version of ['v1', 'v2', 'v3'] as const) {
      expect(readdirSync(join(outDir, 'gemini-selectors', version, 'hosts'))).toEqual([
        'gemini.google.com.json',
      ]);
      expect(published(outDir, version).catalogRevision).toBe(42);
    }
    expect(readFileSync(join(outDir, 'hosts/claude.ai.json'), 'utf8')).toBe('{"keep":true}');
  });

  it('rejects incomplete or misplaced profile groups and accepts the repaired group', () => {
    const fixture = fixtureCatalog();
    const sidebarPath = join(fixture, dataPath, 'sidebar.json');
    writeFileSync(sidebarPath, JSON.stringify({ 'sidebar.row': ['.row'] }));
    expect(() => buildGeminiSelectorFiles({ catalogDir: fixture, catalogRevision: 42 })).toThrow(
      'incomplete or invalid',
    );
    const sidebar: Record<string, unknown> = JSON.parse(
      readFileSync(join(catalogDir, dataPath, 'sidebar.json'), 'utf8'),
    );
    writeFileSync(sidebarPath, JSON.stringify({ ...sidebar, 'modelPicker.items': ['button'] }));
    expect(() => buildGeminiSelectorFiles({ catalogDir: fixture, catalogRevision: 42 })).toThrow(
      'incomplete or invalid',
    );
    writeFileSync(sidebarPath, JSON.stringify(sidebar));
    const repaired = buildGeminiSelectorFiles({ catalogDir: fixture, catalogRevision: 42 });
    expect(repaired.get(host)?.format).toBe(3);
  });

  it('leaves every published version intact when a replacement exceeds the decoded byte budget', () => {
    const fixture = fixtureCatalog();
    const outDir = temp();
    writeGeminiSelectorFiles({ catalogDir, outDir, catalogRevision: 42 });
    const turnPath = join(fixture, dataPath, 'turn.json');
    const turns: Record<string, unknown> = JSON.parse(readFileSync(turnPath, 'utf8'));
    writeFileSync(
      turnPath,
      JSON.stringify({
        ...turns,
        'turn.user': Array.from({ length: 32 }, () => `.${'a'.repeat(2047)}`),
      }),
    );
    expect(() =>
      writeGeminiSelectorFiles({ catalogDir: fixture, outDir, catalogRevision: 43 }),
    ).toThrow();
    expect(published(outDir, 'v1').catalogRevision).toBe(42);
    expect(published(outDir, 'v2').catalogRevision).toBe(42);
    expect(published(outDir, 'v3').catalogRevision).toBe(42);
  });
});
