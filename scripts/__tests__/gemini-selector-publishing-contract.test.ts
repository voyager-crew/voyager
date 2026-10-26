import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readGeminiSelectorFile } from '../../src/core/gemini/selectors/validation';
import { writeGeminiSelectorFiles } from '../lib/buildGeminiSelectorFixes';

// Literal wire contracts independent of source groups. The latest format is still unpublished.
const PUBLISHED_KEYS = {
  1: [
    'turn.user',
    'turn.userWithHosts',
    'turn.assistant',
    'turn.assistantFallback',
    'turn.assistantWithHosts',
  ],
  2: [
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
    'modelPicker.selectedModel',
    'modelPicker.selectedThinking',
    'modelPicker.selectedNestedThinking',
    'modelPicker.focusInput',
  ],
  3: [
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
    'modelPicker.selectedModel',
    'modelPicker.selectedThinking',
    'modelPicker.selectedNestedThinking',
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
  ],
} as const;

const temporary: string[] = [];
const host = 'gemini.google.com';

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Gemini selector publishing contract', () => {
  it.each([1, 2, 3] as const)('publishes exactly the keys understood by v%i clients', (format) => {
    const outDir = mkdtempSync(join(tmpdir(), 'voyager-gemini-contract-'));
    temporary.push(outDir);
    writeGeminiSelectorFiles({
      catalogDir: resolve('src/features/plugins/catalog'),
      outDir,
      catalogRevision: 42,
    });
    const raw: unknown = JSON.parse(
      readFileSync(join(outDir, 'gemini-selectors', `v${format}`, 'hosts', `${host}.json`), 'utf8'),
    );
    const file = readGeminiSelectorFile(raw, host);
    expect(file?.format).toBe(format);
    expect(Object.keys(file!.selectors).sort()).toEqual([...PUBLISHED_KEYS[format]].sort());
    expect(
      readGeminiSelectorFile(
        { ...file, selectors: { ...file!.selectors, 'composer.semanticInput': ['#editor'] } },
        host,
      ),
    ).toBeNull();
  });
});
