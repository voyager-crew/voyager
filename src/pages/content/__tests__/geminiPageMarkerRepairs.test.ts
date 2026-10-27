import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findGeminiDraftInput } from '@/core/gemini/composer/draft';
import { findGeminiChatInput } from '@/core/gemini/composer/inputs';
import { findGeminiSendButton } from '@/core/gemini/composer/send';
import { readGeminiContextImages, readGeminiUserLines } from '@/core/gemini/content/reads';
import { getGeminiSelectorView } from '@/core/gemini/selectors';
import { readComposer } from '@/core/services/composer';
import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { geminiAdapter } from '@/features/plugins/sites/adapters/gemini';

import { buildGeminiAdapter } from '../export/adapter/platform/gemini';
import { readGemsList } from '../gemsSidebar/selectorQueries';
import { installGeminiSelectorPatch } from './geminiOnlineSelectorFixture';

let stop: (() => void) | undefined;
const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')!;
const rootClasses = document.documentElement.className;
const bodyClasses = document.body.className;

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname: 'gemini.google.com', origin: 'https://gemini.google.com' },
  });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  document.documentElement.className = rootClasses;
  document.body.className = bodyClasses;
  Object.defineProperty(window, 'location', originalLocation);
});

function mountComposer(decoration = ''): HTMLElement {
  document.body.innerHTML = `<input-area-v2 class="repaired-owner"><section id="field" class="${decoration}" contenteditable="true">Kept draft</section><button aria-label="Send">Send</button></input-area-v2>`;
  const field = document.getElementById('field')!;
  field.getBoundingClientRect = () => ({ height: 20, width: 200 }) as DOMRect;
  Object.defineProperty(document.querySelector('button')!, 'offsetParent', {
    configurable: true,
    value: document.body,
  });
  return field;
}

describe.each([
  ['html', 'gv-formula-copy-enabled'],
  ['body', 'gv-rtl'],
] as const)('Gemini repairs under %s.%s', (tag, marker) => {
  beforeEach(() => document.querySelector(tag)!.classList.add(marker));

  it('the formula copy and RTL root classes do not void the composer repair', async () => {
    const field = mountComposer();
    stop = await installGeminiSelectorPatch({
      'composer.candidates': ['#field'],
      'composer.draftCandidates': ['#field'],
    });
    expect(findGeminiChatInput()).toBe(field);
    expect(findGeminiDraftInput(document)).toBe(field);
    expect(readComposer(findGeminiDraftInput(document)!)).toBe('Kept draft');
  });

  it('page decorations do not disconnect the repaired draft from its Send button', async () => {
    const field = mountComposer();
    stop = await installGeminiSelectorPatch({
      'composer.sendContainers': ['.repaired-owner'],
    });
    expect(findGeminiSendButton(field)).toBe(document.querySelector('button'));
  });

  it('page decorations do not empty a repaired Gems catalog', async () => {
    document.body.innerHTML = `<main><section class="repaired-list"><bot-list-row>
      <a class="bot-row" href="/gem/writer"><div class="bot-title"><span class="title-container">Writer</span></div></a>
    </bot-list-row></section></main>`;
    stop = await installGeminiSelectorPatch({ 'gems.list': ['.repaired-list'] });
    expect(readGemsList().rows.map(({ metadata }) => metadata?.name)).toEqual(['Writer']);
  });

  it('page decorations do not drop repaired prompt lines from export', async () => {
    document.body.innerHTML = '<user-query><p>First line</p><p>Second line</p></user-query>';
    stop = await installGeminiSelectorPatch({ 'content.userLines': ['p'] });
    expect(
      Array.from(readGeminiUserLines(document.querySelector('user-query')!)).map(
        (line) => line.textContent,
      ),
    ).toEqual(['First line', 'Second line']);
  });

  it('page decorations do not remove repaired images from context', async () => {
    document.body.innerHTML = `<model-response><div data-full-size-image-uri="https://images.example/full.png"><img class="repaired-image" src="https://images.example/preview.png"></div></model-response>`;
    stop = await installGeminiSelectorPatch({ 'context.images': ['.repaired-image'] });
    expect(
      readGeminiContextImages(document.querySelector('model-response')!).map((image) => image.src),
    ).toEqual(['https://images.example/preview.png']);
  });

  it('page decorations do not lose a repaired search image caption in exports', async () => {
    document.body.innerHTML = `<model-response><message-content><image-result>
      <div class="repaired-card" data-full-size-image-uri="https://images.example/full.png">
        <img src="https://images.example/preview.png" alt="Search result"><div class="caption">Kept caption</div>
      </div>
    </image-result></message-content></model-response>`;
    stop = await installGeminiSelectorPatch({ 'imageExport.searchHosts': ['.repaired-card'] });
    const extractor = createContentExtractor(
      buildGeminiAdapter(geminiAdapter, getGeminiSelectorView()),
    );
    expect(extractor.extractAssistantContent(document.querySelector('model-response')!).text).toBe(
      '![Search result](https://images.example/preview.png)\n*Kept caption*',
    );
  });
});

it.each(['gv-input-collapsed', 'gv-input-vim-mode-normal', 'gv-pm-slash-textarea-has-token'])(
  'the native %s decoration does not detach a repaired composer from its draft and send action',
  async (decoration) => {
    const field = mountComposer(decoration);
    stop = await installGeminiSelectorPatch({
      'composer.candidates': ['#field'],
      'composer.draftCandidates': ['#field'],
      'composer.sendContainers': ['.repaired-owner'],
    });
    expect(findGeminiChatInput()).toBe(field);
    expect(findGeminiDraftInput(document)).toBe(field);
    expect(findGeminiSendButton(field)).toBe(document.querySelector('button'));
  },
);

it('an outer Voyager wrapper does not erase prompt lines inside the supplied native host', async () => {
  document.body.innerHTML =
    '<div class="gv-export-content"><user-query><p>Kept line</p></user-query></div>';
  stop = await installGeminiSelectorPatch({ 'content.userLines': ['p'] });
  expect(
    Array.from(readGeminiUserLines(document.querySelector('user-query')!)).map(
      (line) => line.textContent,
    ),
  ).toEqual(['Kept line']);
});

it('an outer Voyager wrapper does not erase context images inside the supplied native host', async () => {
  document.body.innerHTML = `<div class="gv-export-content"><model-response>
    <div data-full-size-image-uri="https://images.example/full.png"><img class="repaired-image" src="https://images.example/preview.png"></div>
  </model-response></div>`;
  stop = await installGeminiSelectorPatch({ 'context.images': ['.repaired-image'] });
  expect(
    readGeminiContextImages(document.querySelector('model-response')!).map((image) => image.src),
  ).toEqual(['https://images.example/preview.png']);
});

it('an outer Voyager wrapper does not lose search captions inside the supplied native host', async () => {
  document.body.innerHTML = `<div class="gv-export-content"><model-response><message-content>
    <div class="repaired-card" data-full-size-image-uri="https://images.example/full.png">
      <img src="https://images.example/preview.png" alt="Search result"><div class="caption">Kept caption</div>
    </div>
  </message-content></model-response></div>`;
  stop = await installGeminiSelectorPatch({ 'imageExport.searchHosts': ['.repaired-card'] });
  const extractor = createContentExtractor(
    buildGeminiAdapter(geminiAdapter, getGeminiSelectorView()),
  );
  expect(extractor.extractAssistantContent(document.querySelector('model-response')!).text).toBe(
    '![Search result](https://images.example/preview.png)\n*Kept caption*',
  );
});
