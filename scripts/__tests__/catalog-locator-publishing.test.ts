import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getBundledGeminiSelectorView } from '@/core/gemini/selectors/bundle';
import { GEMINI_SELECTOR_PROFILE_KEYS } from '@/core/gemini/selectors/types';
import { validateHostCatalogFile } from '@/features/plugins/remote/hostCatalogFile';

import { build, makeTempDir, readHostFile, removeTempDirs } from './buildPluginCatalogFixtures';

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

afterEach(() => {
  document.body.replaceChildren();
  removeTempDirs();
});

describe('catalog locator publishing contract', () => {
  it('publishes the literal supported keys from the page bundle, with no packaged-only data', async () => {
    const out = makeTempDir();
    await build(out);
    const raw = readHostFile(out, 'gemini.google.com');
    const host = validateHostCatalogFile(raw, 'gemini.google.com');
    expect(host?.siteIssues).toEqual([]);
    expect(host?.site?.locators).toEqual(getBundledGeminiSelectorView().profiles);
    expect(Object.keys(host!.site!.locators!).sort()).toEqual([...PUBLISHED_KEYS].sort());
    expect([...GEMINI_SELECTOR_PROFILE_KEYS].sort()).toEqual([...PUBLISHED_KEYS].sort());
    expect(host?.site?.catalogRevision).toBe(42);
    expect(host?.manifests).toEqual([]);
    // The same file holds all online data; serializing it preserves the profiles.
    expect(
      JSON.parse(readFileSync(join(out, 'hosts/gemini.google.com.json'), 'utf8')).site.locators,
    ).toEqual(host?.site?.locators);
  });

  it('the published profiles and bundled profiles read the same ordered page content', async () => {
    document.body.innerHTML = `
      <div id="question-b" class="user-query-container">Second</div>
      <div id="question-a" class="user-query-container">First</div>
      <nav data-test-id="overflow-container">
        <a id="row-b" data-test-id="conversation">Second chat</a>
        <a id="row-a" data-test-id="conversation">First chat</a>
      </nav>
      <div role="menu"><button id="fast" data-mode-id="fast">Fast</button></div>
      <rich-textarea><div id="draft" contenteditable="true" role="textbox">Draft</div></rich-textarea>
      <div class="attachment-container search-images" id="search">Caption</div>
      <generated-image><button><mat-icon fonticon="download" id="download">download</mat-icon></button></generated-image>
      <code-immersive-panel id="code">const answer = 42;</code-immersive-panel>`;
    const out = makeTempDir();
    await build(out);
    const published = validateHostCatalogFile(
      readHostFile(out, 'gemini.google.com'),
      'gemini.google.com',
    )!.site!.locators!;
    const bundled = getBundledGeminiSelectorView().profiles;
    for (const [key, ids] of [
      ['turn.user', ['question-b', 'question-a']],
      ['sidebar.row', ['row-b', 'row-a']],
      ['modelPicker.modelIdItem', ['fast']],
      ['composer.candidates', ['draft']],
      ['imageExport.searchHosts', ['search']],
      ['generatedImage.downloadIcon', ['download']],
      ['canvas.codePanels', ['code']],
    ] as const) {
      const read = (profiles: Readonly<Record<string, readonly string[]>>) =>
        Array.from(document.querySelectorAll(profiles[key].join(','))).map((node) => ({
          node,
          text: node.textContent,
          id: node.id,
        }));
      expect(read(published)).toEqual(read(bundled));
      expect(read(published).map((node) => node.id)).toEqual(ids);
    }
  });
});
