import { afterEach, describe, expect, it } from 'vitest';

import { getBundledSiteSelectorView } from '@/core/selectors';
import { SITE_SELECTOR_CONTRACTS } from '@/core/selectors/contracts';
import { validateHostCatalogFile } from '@/features/plugins/remote/hostCatalogFile';

import { build, makeTempDir, readHostFile, removeTempDirs } from './buildPluginCatalogFixtures';

/** Literal wire contracts stay independent of how fragments are grouped in the implementation. */
const PUBLISHED_KEYS = {
  aistudio: [
    'input.candidates',
    'input.sendContainers',
    'library.rows',
    'library.archivableRows',
    'library.table',
    'navigation.libraryLink',
  ],
  chatgpt: [
    'input.candidates',
    'input.handoff',
    'vim.candidates',
    'export.assistantContent',
    'bridge.replyContent',
  ],
  claude: ['input.candidates', 'input.handoff', 'vim.candidates', 'export.assistantContent'],
  deepseek: ['export.assistantContent'],
  kimi: ['input.candidates', 'vim.candidates', 'export.assistantContent'],
} as const;

const SEMANTIC_KEYS = {
  aistudio: [],
  chatgpt: ['composer', 'composerRoot', 'sendButton'],
  claude: ['composer', 'sendButton'],
  deepseek: [],
  kimi: ['composer'],
} as const;

const HOSTS = {
  aistudio: ['aistudio.google.com', 'aistudio.google.cn'],
  chatgpt: ['chatgpt.com', 'chat.openai.com'],
  claude: ['claude.ai'],
  deepseek: ['chat.deepseek.com'],
  kimi: ['www.kimi.com'],
} as const;

afterEach(() => {
  document.body.replaceChildren();
  removeTempDirs();
});

describe('all-site locator publication', () => {
  it('round-trips each literal site contract and reads the same page nodes as its bundle', async () => {
    document.body.innerHTML = `
      <div contenteditable="true" role="textbox" data-testid="chat-input" class="chat-input-editor">Draft</div>
      <textarea class="ds-scroll-area" aria-label="Prompt">Prompt</textarea>
      <main><div data-message-author-role="assistant"><article class="answer"><p>Complete reply</p></article></div></main>
      <ms-prompt-history-v3><a href="/library">Library</a></ms-prompt-history-v3>`;
    const out = makeTempDir();
    await build(out);
    for (const siteId of Object.keys(PUBLISHED_KEYS) as Array<keyof typeof PUBLISHED_KEYS>) {
      const keys = PUBLISHED_KEYS[siteId];
      expect([...SITE_SELECTOR_CONTRACTS[siteId].keys].sort()).toEqual(
        [...keys, ...SEMANTIC_KEYS[siteId]].sort(),
      );
      for (const host of HOSTS[siteId]) {
        const published = validateHostCatalogFile(readHostFile(out, host), host);
        expect(published?.siteIssues).toEqual([]);
        expect(Object.keys(published!.site!.locators!).sort()).toEqual([...keys].sort());
        const bundle = getBundledSiteSelectorView(siteId);
        for (const key of SEMANTIC_KEYS[siteId]) {
          const actual = published!.site!.selectors[key];
          expect(Array.from(document.querySelectorAll(actual))).toEqual(
            Array.from(document.querySelectorAll(bundle.profiles[key].join(','))),
          );
        }
        for (const key of keys) {
          const read = (selectors: readonly string[]) =>
            Array.from(document.querySelectorAll(selectors.join(',')));
          expect(read(published!.site!.locators![key])).toEqual(read(bundle.profiles[key]));
        }
        if ('input.candidates' in published!.site!.locators!) {
          expect(
            Array.from(
              document.querySelectorAll(published!.site!.locators!['input.candidates'].join(',')),
            ).map((node) => node.textContent),
          ).toEqual(['Draft', 'Prompt']);
        }
      }
    }
  });

  it('Enterprise receives Gemini data under the same packaged guard vocabulary', async () => {
    const out = makeTempDir();
    await build(out);
    const consumer = validateHostCatalogFile(
      readHostFile(out, 'gemini.google.com'),
      'gemini.google.com',
    );
    const enterprise = validateHostCatalogFile(
      readHostFile(out, 'business.gemini.google'),
      'business.gemini.google',
    );
    document.body.innerHTML =
      '<user-query>Question</user-query><model-response>Answer</model-response>';
    const read = (profiles: Readonly<Record<string, readonly string[]>>) =>
      Array.from(document.querySelectorAll(profiles['turn.userWithHosts'].join(','))).map(
        (node) => node.textContent,
      );
    expect(read(enterprise!.site!.locators!)).toEqual(['Question']);
    expect(read(enterprise!.site!.locators!)).toEqual(read(consumer!.site!.locators!));
    expect(enterprise?.manifests).toEqual([]);
    expect(enterprise?.site?.id).toBe('gemini');
  });
});
