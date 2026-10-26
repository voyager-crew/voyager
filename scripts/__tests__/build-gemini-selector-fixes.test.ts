import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getBundledGeminiSelectorView } from '../../src/core/gemini/selectors/bundle';
import { GeminiSelectorService } from '../../src/core/gemini/selectors/service';
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
  writeFileSync(
    join(path, 'sites/gemini/selector-publication.json'),
    readFileSync(join(catalogDir, 'sites/gemini/selector-publication.json')),
  );
  for (const file of [
    'turn.json',
    'sidebar.json',
    'model-picker.json',
    'composer.json',
    'input-collapse.json',
    'vim.json',
    'prompt-history.json',
    'slash.json',
    'sent-chips.json',
    'project.json',
    'activity.json',
    'menu.json',
    'menu-overlay.json',
    'sidebar-width.json',
    'sidebar-hover.json',
    'gems.json',
    'content.json',
    'context-images.json',
    'response-actions.json',
    'research-pack.json',
    'usage.json',
    'code.json',
    'user-latex.json',
    'image-export.json',
    'generated-image.json',
    'canvas-code.json',
  ]) {
    writeFileSync(join(destination, file), readFileSync(join(catalogDir, dataPath, file)));
  }
  return path;
}

function published(outDir: string): GeminiSelectorFile {
  const path = join(outDir, 'gemini-selectors', 'v1', 'hosts', `${host}.json`);
  const file = readGeminiSelectorFile(JSON.parse(readFileSync(path, 'utf8')) as unknown, host);
  if (!file) throw new Error('Published file is invalid');
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
  it('publishes one file with matching turn, row, picker and composer reads', () => {
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
    expect(written).toEqual([join(outDir, 'gemini-selectors', 'v1', 'hosts', `${host}.json`)]);
    const current = published(outDir);
    expect(current.format).toBe(1);
    expect(current.catalogRevision).toBe(42);
    const bundled = getBundledGeminiSelectorView().profiles;
    const comparableKeys = ['turn.user', 'sidebar.row', 'modelPicker.modelIdItem'] as const;
    for (const key of comparableKeys) {
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
  });

  it('replaces stale outputs with one publication while preserving unrelated catalogs', () => {
    const outDir = temp();
    const hostsDir = join(outDir, 'gemini-selectors', 'v1', 'hosts');
    mkdirSync(hostsDir, { recursive: true });
    writeFileSync(join(hostsDir, 'aistudio.google.com.json'), '{}');
    writeFileSync(join(hostsDir, 'business.gemini.google.json'), '{}');
    const staleDir = join(outDir, 'gemini-selectors', 'v99', 'hosts');
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, `${host}.json`), '{}');
    mkdirSync(join(outDir, 'hosts'));
    writeFileSync(join(outDir, 'hosts/claude.ai.json'), '{"keep":true}');
    writeGeminiSelectorFiles({ catalogDir, outDir, catalogRevision: 42 });
    expect(readdirSync(hostsDir)).toEqual(['gemini.google.com.json']);
    expect(readdirSync(join(outDir, 'gemini-selectors'))).toEqual(['v1']);
    expect(published(outDir).catalogRevision).toBe(42);
    expect(readFileSync(join(outDir, 'hosts/claude.ai.json'), 'utf8')).toBe('{"keep":true}');
  });

  it('publishes image and Canvas locators that read the same native content as the package', () => {
    document.body.innerHTML = `
      <div class="attachment-container search-images" id="search">Search image caption</div>
      <generated-image id="generated">
        <img src="https://lh3.googleusercontent.com/generated" alt="Generated image">
        <button><mat-icon fonticon="download" id="download">download</mat-icon></button>
      </generated-image>
      <immersive-editor id="document"><div class="ProseMirror">Canvas text</div></immersive-editor>
      <code-immersive-panel id="code"><xap-code-editor>const answer = 42;</xap-code-editor></code-immersive-panel>`;
    const outDir = temp();
    writeGeminiSelectorFiles({ catalogDir, outDir, catalogRevision: 42 });
    const current = published(outDir);
    const bundled = getBundledGeminiSelectorView().profiles;
    for (const [key, id] of [
      ['imageExport.searchHosts', 'search'],
      ['generatedImage.downloadIcon', 'download'],
      ['canvas.codePanels', 'code'],
    ] as const) {
      const nodes = readNodes(current.selectors, key);
      expect(nodes).toEqual(readNodes(bundled, key));
      expect(nodes.map((node) => node.id)).toEqual([id]);
    }
  });

  it('keeps fixes withdrawn across later builds and restores the packaged page read', async () => {
    document.body.innerHTML = `
      <div class="user-query-container" id="bundled">Original question</div>
      <div class="repaired-user" id="remote">Repaired question</div>`;
    const fixture = fixtureCatalog();
    const turnPath = join(fixture, dataPath, 'turn.json');
    const turns: Record<string, unknown> = JSON.parse(readFileSync(turnPath, 'utf8'));
    writeFileSync(turnPath, JSON.stringify({ ...turns, 'turn.user': ['.repaired-user'] }));
    const outDir = temp();
    mkdirSync(join(outDir, 'hosts'));
    writeFileSync(join(outDir, 'hosts/claude.ai.json'), '{"keep":true}');
    const service = new GeminiSelectorService();
    const readQuestion = async (file: GeminiSelectorFile) => {
      const lifetime = service.initialize({
        host,
        doc: document,
        lifetime: new AbortController().signal,
        bundledRevision: 1,
        read: async () => file,
      });
      await lifetime.ready;
      const ids = readNodes(service.getView().profiles, 'turn.user').map(({ id }) => id);
      lifetime.stop();
      return ids;
    };
    writeGeminiSelectorFiles({ catalogDir: fixture, outDir, catalogRevision: 42 });
    expect(await readQuestion(published(outDir))).toEqual(['remote']);
    writeFileSync(
      join(fixture, 'sites/gemini/selector-publication.json'),
      JSON.stringify({ publication: 'withdrawn' }),
    );
    for (const catalogRevision of [43, 44]) {
      writeGeminiSelectorFiles({ catalogDir: fixture, outDir, catalogRevision });
      const withdrawal = published(outDir);
      expect(withdrawal.catalogRevision).toBe(catalogRevision);
      expect(withdrawal.selectors).toEqual({});
      expect(await readQuestion(withdrawal)).toEqual(['bundled']);
    }
    expect(readFileSync(join(outDir, 'hosts/claude.ai.json'), 'utf8')).toBe('{"keep":true}');
  });

  it.each([null, [], {}, { publication: 'typo' }, { publication: 'full', extra: true }])(
    'leaves an accepted publication readable when the publication mode is invalid: %j',
    (mode) => {
      const fixture = fixtureCatalog();
      const outDir = temp();
      writeGeminiSelectorFiles({ catalogDir: fixture, outDir, catalogRevision: 42 });
      writeFileSync(join(fixture, 'sites/gemini/selector-publication.json'), JSON.stringify(mode));
      expect(() =>
        writeGeminiSelectorFiles({ catalogDir: fixture, outDir, catalogRevision: 43 }),
      ).toThrow('publication must be full or withdrawn');
      expect(published(outDir).catalogRevision).toBe(42);
    },
  );

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
    expect(repaired.get(host)?.format).toBe(1);
  });

  it('leaves the published file intact when a replacement exceeds the decoded byte budget', () => {
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
    expect(published(outDir).catalogRevision).toBe(42);
  });
});
