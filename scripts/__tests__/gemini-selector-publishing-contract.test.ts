import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readGeminiSelectorFile } from '../../src/core/gemini/selectors/validation';
import { writeGeminiSelectorFiles } from '../lib/buildGeminiSelectorFixes';

// Literal wire contract, independent of source groups.
const PUBLISHED_KEYS = [
  'turn.user',
  'turn.userWithHosts',
  'turn.assistant',
  'turn.assistantFallback',
  'turn.assistantWithHosts',
  'sidebar.overflow',
  'sidebar.notebooks',
  'sidebar.recents',
  'sidebar.allConversations',
  'sidebar.history',
  'sidebar.section',
  'sidebar.row',
  'sidebar.rowContainer',
  'sidebar.openHost',
  'sidebar.host',
  'sidebar.visibilityHost',
  'sidebar.links',
  'sidebar.conversationLinks',
  'sidebar.title',
  'sidebar.titleFallback',
  'sidebar.scroller',
  'sidebar.interactionButton',
  'sidebar.forkRoots',
  'modelPicker.trigger',
  'modelPicker.legacyPanels',
  'modelPicker.panelFallback',
  'modelPicker.overlayPane',
  'modelPicker.container',
  'modelPicker.observerRoot',
  'modelPicker.items',
  'modelPicker.modelEvidence',
  'modelPicker.modelIdItem',
  'modelPicker.modelLabel',
  'modelPicker.thinkingLabel',
  'modelPicker.thinkingRow',
  'modelPicker.thinkingItems',
  'modelPicker.thinkingContent',
  'modelPicker.modelTitleContainer',
  'modelPicker.thinkingTitleContainer',
  'modelPicker.focusInput',
  'composer.candidates',
  'composer.draftCandidates',
  'composer.sendContainers',
  'inputCollapse.wrapper',
  'vim.configuredComposer',
  'vim.candidates',
  'promptHistory.candidates',
  'slash.candidates',
  'sentChips.bubbles',
  'project.inputs',
  'activity.inputs',
  'menu.panels',
  'menu.content',
  'exportOverlay.canvas',
  'exportOverlay.composer',
  'sidebarWidth.buttons',
  'sidebarHover.dialogs',
  'sidebarHover.menus',
  'gems.navEntry',
  'gems.list',
  'gems.row',
  'gems.title',
  'gems.description',
  'gems.icon',
  'content.answer',
  'content.userLines',
  'context.images',
  'responseActions.bars',
  'researchPack.actionBars',
  'usage.root',
  'code.host',
  'userLatex.lines',
  'imageExport.searchHosts',
  'generatedImage.downloadIcon',
  'canvas.codePanels',
] as const;

const temporary: string[] = [];
const host = 'gemini.google.com';

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Gemini selector publishing contract', () => {
  it('publishes exactly the remotely supported keys in the sole format', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'voyager-gemini-contract-'));
    temporary.push(outDir);
    writeGeminiSelectorFiles({
      catalogDir: resolve('src/features/plugins/catalog'),
      outDir,
      catalogRevision: 42,
    });
    const raw: unknown = JSON.parse(
      readFileSync(join(outDir, 'gemini-selectors', 'v1', 'hosts', `${host}.json`), 'utf8'),
    );
    const file = readGeminiSelectorFile(raw, host);
    expect(file?.format).toBe(1);
    expect(Object.keys(file!.selectors).sort()).toEqual([...PUBLISHED_KEYS].sort());
    for (const key of [
      'composer.semanticInput',
      'modelPicker.selectedModel',
      'modelPicker.selectedThinking',
      'modelPicker.selectedNestedThinking',
      'formula.container',
      'deepResearch.items',
      'deepResearch.reportCandidates',
      'imageExport.caption',
      'generatedImage.dialog',
      'generatedImage.container',
      'canvas.documentEditors',
      'canvas.proseMirror',
      'generatedUi.frames',
      'generatedUi.attachment',
      'generatedUi.response',
      'generatedUi.message',
      'generatedUi.markdown',
      'generatedUi.container',
    ]) {
      expect(
        readGeminiSelectorFile(
          { ...file, selectors: { ...file!.selectors, [key]: ['#unpublished'] } },
          host,
        ),
      ).toBeNull();
    }
  });
});
