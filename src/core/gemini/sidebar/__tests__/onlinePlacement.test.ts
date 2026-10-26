import { afterEach, expect, it, vi } from 'vitest';

import { getGeminiSelectorView, type GeminiSelectorProfileKey } from '@/core/gemini/selectors';
import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';
import { createCodeBlockCollapse } from '@/pages/content/codeBlockCollapse/engine';
import {
  createGeminiCodeBlockSite,
  geminiCodeBlockActions,
} from '@/pages/content/codeBlockCollapse/geminiSite';
import { DefaultStarView } from '@/pages/content/defaultModel/defaultStarView';
import { ModelPickerDom } from '@/pages/content/defaultModel/modelPickerDom';
import { createFolderProjectPicker } from '@/pages/content/folderProject/picker';
import { readProjectPlacement } from '@/pages/content/folderProject/placement';
import { startSentPromptChips } from '@/pages/content/prompt/SentPromptChips';
import { readSentChipTargets } from '@/pages/content/prompt/sentChipTargets';
import { getSidebarWidthButtons } from '@/pages/content/sidebarWidth/buttonTargets';

let retire = () => {};
let cleanup = () => {};
afterEach(() => {
  cleanup();
  retire();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface PlacementCase {
  key: GeminiSelectorProfileKey;
  markup: string;
  target(): HTMLElement | null;
  show(target: HTMLElement): Promise<void> | void;
}
const prompt = {
  id: 'test',
  name: 'Saved prompt',
  text: 'Explain the complete proof step by step with detailed examples.',
};
const cases: PlacementCase[] = [
  ...(['project.modelAnchor', 'project.inputAnchor', 'project.fontSource'] as const).map((key) => ({
    key,
    markup:
      key === 'project.inputAnchor'
        ? '<rich-textarea id="input"></rich-textarea>'
        : '<div class="model-picker-container" id="bundled"><button id="font" style="font-size:13px">Model</button></div>',
    target: () => readProjectPlacement(key),
    show: async (target: HTMLElement) => {
      const picker = createFolderProjectPicker({
        loadFolders: async () => ({ account: null, folders: [] }),
        canMount: () => true,
        onSelect: () => {},
      });
      cleanup = picker.remove;
      const showing = picker.show();
      if (key === 'project.inputAnchor') await vi.advanceTimersByTimeAsync(5100);
      await showing;
      const ui = document.querySelector<HTMLElement>('.gv-fp-picker-container');
      expect(ui).not.toBeNull();
      if (key === 'project.fontSource')
        expect(ui!.querySelector<HTMLElement>('.gv-fp-chip')?.style.fontSize).toBe(
          getComputedStyle(target).fontSize,
        );
      else expect(ui!.nextElementSibling).toBe(target);
    },
  })),
  {
    key: 'code.buttons',
    markup: `<code-block id="host"><div class="code-block-decoration"><div class="buttons" id="bundled"></div></div><pre><code>${Array.from({ length: 30 }, () => 'const value = 1;').join('\n')}</code></pre></code-block>`,
    target: () => geminiCodeBlockActions(document.getElementById('host')!),
    show: (target) => {
      const engine = createCodeBlockCollapse(createGeminiCodeBlockSite(document, 'code-block'));
      cleanup = () => engine.stop();
      engine.start();
      expect(target.querySelector('.gv-code-block-toggle')).not.toBeNull();
    },
  },
  ...(['modelPicker.modelTitleContainer', 'modelPicker.thinkingTitleContainer'] as const).map(
    (key) => ({
      key,
      markup:
        '<gem-menu-item id="host"><div class="label-container" id="bundled"></div></gem-menu-item>',
      target: () =>
        new ModelPickerDom(getGeminiSelectorView()).starAnchor(
          document.getElementById('host')!,
          key === 'modelPicker.modelTitleContainer' ? 'model' : 'thinking',
        ).container,
      show: (target: HTMLElement) => {
        const host = document.getElementById('host')!;
        const stars = new DefaultStarView();
        cleanup = () => stars.stop();
        stars.start();
        stars.appendStar(
          host,
          stars.createStar('model', async () => {}),
          new ModelPickerDom(getGeminiSelectorView()).starAnchor(
            host,
            key === 'modelPicker.modelTitleContainer' ? 'model' : 'thinking',
          ),
        );
        expect(target.querySelector('.gv-default-star-btn')).not.toBeNull();
      },
    }),
  ),
  {
    key: 'sentChips.anchor',
    markup: `<user-query id="host" class="user-query-container"><div class="query-text" id="bundled"><span class="query-text-line">${prompt.text}</span></div></user-query>`,
    target: () => readSentChipTargets(document)[0]?.anchor ?? null,
    show: (target) => {
      const chips = startSentPromptChips({ prompts: [prompt], scheme: () => 'light' });
      cleanup = chips.destroy;
      expect(target.nextElementSibling?.classList.contains('gv-pm-sent')).toBe(true);
      expect(target.nextElementSibling?.querySelector('.gv-pm-sent-chip')?.textContent).toBe(
        'Saved prompt',
      );
    },
  },
];

it.each(cases)(
  '$key moves real Voyager UI and falls back for missing or editable targets',
  async ({ key, markup, target, show }) => {
    vi.useFakeTimers();
    vi.stubGlobal('location', new URL('https://gemini.google.com/app/abcdef1234'));
    document.body.innerHTML = markup;
    const scope = document.getElementById('host') ?? document.body;
    const repaired = document.createElement('div');
    repaired.id = 'remote';
    repaired.style.fontSize = '27px';
    scope.append(repaired);
    for (const element of document.querySelectorAll<HTMLElement>('*'))
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 40, 32, 32));
    const bundled = target();
    expect(bundled).not.toBeNull();
    retire = await installGeminiSelectorPatch({ [key]: ['#remote'] });
    expect(target()).toBe(repaired);
    await show(repaired);
    cleanup();
    repaired.id = 'missing';
    expect(target()).toBe(bundled);
    await show(bundled!);
    cleanup();
    repaired.id = 'remote';
    repaired.setAttribute('contenteditable', 'true');
    expect(target()).toBe(bundled);
    await show(bundled!);
    cleanup();
    repaired.removeAttribute('contenteditable');
    expect(target()).toBe(repaired);
  },
);

it.each(['sidebarWidth.buttons', 'sidebarWidth.candidates'] as const)(
  '%s moves only the geometry prefilter and rejects missing/editable regions',
  async (key) => {
    document.body.innerHTML =
      '<bard-sidenav><button id="bundled" aria-label="Open sidebar"></button></bard-sidenav><div id="remote"></div>';
    for (const element of document.querySelectorAll<HTMLElement>('*'))
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 40, 32, 32));
    const bundled = getSidebarWidthButtons();
    retire = await installGeminiSelectorPatch({ [key]: ['#remote'] });
    const remote = document.getElementById('remote')!;
    expect(getSidebarWidthButtons()).toEqual([remote]);
    remote.id = 'missing';
    expect(getSidebarWidthButtons()).toEqual(bundled);
    remote.id = 'remote';
    remote.setAttribute('contenteditable', 'true');
    expect(getSidebarWidthButtons()).toEqual(bundled);
  },
);
