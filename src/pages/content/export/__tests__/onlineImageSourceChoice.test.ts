import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ExportFormat } from '@/features/export/types/export';
import { confirmDriver } from '@/tests/confirmDriver';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import type { ConversationCollector, ExportMessage } from '../conversationCollector';
import type { ExportDictionaries } from '../exportLocale';
import { createExportRunner } from '../exportRun';
import { hasExportSearchImages } from '../exportSearchImages';
import type { ExportSite } from '../exportSite';

const written = vi.hoisted(() => vi.fn());
vi.mock('../generatedUiScreenshots', () => ({
  captureGeneratedUiScreenshots: vi.fn(async () => {}),
  ensureGeneratedUiScreenshotPermission: vi.fn(async () => {}),
  removeGeneratedUiScreenshotSections: vi.fn(),
}));
vi.mock('../pendingExportState', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pendingExportState')>()),
  exportPendingConversation: written,
}));

let retire: (() => void) | undefined;
const dict = {
  en: {
    pm_export: 'Export now',
    export_md_include_source_confirm: 'Keep search image links?',
    export_md_include_source_include: 'Include links',
    export_md_include_source_exclude: 'Leave out',
    pm_cancel: 'Cancel',
  },
} as unknown as ExportDictionaries;

function response(classes = 'repaired-card'): HTMLElement {
  const root = document.createElement('model-response');
  root.innerHTML = `<message-content><image-result _nghost-ng-c123="" dir="ltr" jslog="123">
    <div class="${classes}" data-full-size-image-uri="https://images.example/full.jpg">
      <img src="https://images.example/preview.jpg"><div class="caption">An image</div>
    </div></image-result></message-content>`;
  document.body.append(root);
  return root;
}

function site(root: HTMLElement): ExportSite {
  const messages: ExportMessage[] = [
    { messageId: '1:a', role: 'assistant', hostElement: root, text: 'Answer', starred: false },
  ];
  const page: ConversationCollector = {
    collectChatPairs: () => [],
    collectSelectionMessages: () => messages,
    turnsForMessageIds: () => [
      {
        turnId: '1',
        user: 'Question',
        assistant: 'Answer',
        starred: false,
        assistantElement: root,
      },
    ],
    assistantMessageIdFor: () => null,
    topUserElement: () => null,
    conversationRoot: () => document.body,
    snapshotOpenCanvasDocs: vi.fn(),
    releaseCanvasDocs: vi.fn(),
  };
  return {
    id: 'gemini',
    label: 'Gemini',
    entryPoints: { kind: 'toolbar' },
    title: () => 'Images',
    page,
    turns: {
      scrollsWhileBuilding: false,
      messages: page.collectSelectionMessages,
      build: async (ids) => page.turnsForMessageIds(ids),
    },
  };
}

async function until(condition: () => boolean): Promise<void> {
  for (let elapsed = 0; elapsed < 5000 && !condition(); elapsed += 50)
    await vi.advanceTimersByTimeAsync(50);
  expect(condition()).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers();
  written.mockResolvedValue({ success: true });
});
afterEach(() => {
  retire?.();
  retire = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

it('a repaired search image keeps the source choice and exports the chosen omission', async () => {
  const root = response();
  expect(hasExportSearchImages({ assistantElement: root }, 'gemini')).toBe(false);
  retire = await installGeminiSelectorPatch({ 'imageExport.searchHosts': ['.repaired-card'] });
  const runner = createExportRunner({ site: site(root) });
  const running = runner.run({ format: ExportFormat.MARKDOWN }, { dict, lang: 'en' });
  await until(() => document.querySelector('[data-gv-export-select-bar="true"]') !== null);
  document.querySelector<HTMLButtonElement>('[data-gv-export-action="selectAll"]')!.click();
  document.querySelector<HTMLButtonElement>('[data-gv-export-action="export"]')!.click();
  await until(() => confirmDriver.isOpen());
  expect(confirmDriver.message()).toBe('Keep search image links?');
  confirmDriver.answer('Leave out');
  await until(() => written.mock.calls.length === 1);
  await vi.advanceTimersByTimeAsync(500);
  await running;
  expect(written.mock.calls[0][3]).toBe(false);
});

it('a valid remote alias preserves the existing source choice for both bundled card shapes', async () => {
  const noPrompt = response('image-container alias');
  const prompt = response('attachment-container search-images alias');
  const before = [noPrompt, prompt].map((assistantElement) =>
    hasExportSearchImages({ assistantElement }, 'gemini'),
  );
  retire = await installGeminiSelectorPatch({ 'imageExport.searchHosts': ['.alias'] });
  expect(
    [noPrompt, prompt].map((assistantElement) =>
      hasExportSearchImages({ assistantElement }, 'gemini'),
    ),
  ).toEqual(before);
  expect(before).toEqual([false, true]);
});

it('a partial repaired list leaves source admission unchanged until the whole response matches', async () => {
  const root = response();
  root
    .querySelector('image-result')!
    .insertAdjacentHTML(
      'beforeend',
      '<div data-full-size-image-uri="https://images.example/second.jpg"><img src="https://images.example/second.jpg"></div>',
    );
  retire = await installGeminiSelectorPatch({ 'imageExport.searchHosts': ['.repaired-card'] });
  expect(hasExportSearchImages({ assistantElement: root }, 'gemini')).toBe(false);
  root.querySelectorAll('[data-full-size-image-uri]')[1].classList.add('repaired-card');
  expect(hasExportSearchImages({ assistantElement: root }, 'gemini')).toBe(true);
});

it('another site keeps its packaged prompt even while Gemini has a repaired profile', async () => {
  const root = response();
  retire = await installGeminiSelectorPatch({ 'imageExport.searchHosts': ['.repaired-card'] });
  expect(hasExportSearchImages({ assistantElement: root }, 'chatgpt')).toBe(false);
  expect(hasExportSearchImages({ assistantElement: root }, 'gemini')).toBe(true);
});

it('turning online fixes off keeps the source choice independent of native image probes', async () => {
  const root = response();
  const probe = vi.spyOn(root, 'querySelectorAll').mockImplementation(() => {
    throw new Error('The bundled source choice does not inspect image collections');
  });
  expect(hasExportSearchImages({ assistantElement: root }, 'gemini')).toBe(false);
  probe.mockRestore();
  retire = await installGeminiSelectorPatch({ 'imageExport.searchHosts': ['.repaired-card'] });
  expect(hasExportSearchImages({ assistantElement: root }, 'gemini')).toBe(true);
});

it('a serialized turn keeps its existing source choice without a live assistant element', async () => {
  retire = await installGeminiSelectorPatch({ 'imageExport.searchHosts': ['.repaired-card'] });
  expect(hasExportSearchImages({}, 'gemini')).toBe(false);
  expect(
    hasExportSearchImages(
      { assistantContent: { html: 'attachment-container.search-images' } },
      'gemini',
    ),
  ).toBe(true);
});
