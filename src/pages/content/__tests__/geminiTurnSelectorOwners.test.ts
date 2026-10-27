/**
 * Characterizes which Gemini turn shapes each owner recognizes.
 *
 * The owners read different lists on purpose (see `src/core/gemini/turnSelectors.ts`), so every
 * case asserts both the shapes an owner matches and the ones it must keep ignoring. A refactor that
 * unions the lists fails here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAssistantTurnSelectors, getUserTurnSelectors } from '@/core/utils/selectors';
import { geminiAdapter } from '@/features/plugins/sites/adapters/gemini';

import { buildChatWidthCss, chatWidthPx } from '../chatWidth/chatWidthCss';
import { buildGeminiAdapter } from '../export/adapter/platform/gemini';
import { collectForkChatPairs } from '../fork/chatPairs';
import { collectHighlightTurns } from '../highlight/dom';
import { TimelineTurns } from '../timeline/TimelineTurns';

/** One element per user-turn shape Voyager has ever recognized on Gemini. */
const USER_SHAPES: Record<string, string> = {
  'u.bubble': '<div data-v="u.bubble" class="user-query-bubble-with-background">u.bubble</div>',
  'u.bubbleContainer':
    '<div data-v="u.bubbleContainer" class="user-query-bubble-container">u.bubbleContainer</div>',
  'u.queryContainer':
    '<div data-v="u.queryContainer" class="user-query-container">u.queryContainer</div>',
  'u.contentBubble':
    '<user-query-content data-v="u.contentBubble"><span data-v="u.contentBubble.inner" class="user-query-bubble-with-background">u.contentBubble</span></user-query-content>',
  'u.contentHost': '<user-query-content data-v="u.contentHost">u.contentHost</user-query-content>',
  'u.host': '<user-query data-v="u.host">u.host</user-query>',
  'u.aria': '<div data-v="u.aria" aria-label="User message">u.aria</div>',
  'u.articleAuthor':
    '<article data-v="u.articleAuthor" data-author="user">u.articleAuthor</article>',
  'u.articleTurn': '<article data-v="u.articleTurn" data-turn="user">u.articleTurn</article>',
  'u.role': '<div data-v="u.role" data-message-author-role="user">u.role</div>',
  'u.listitem': '<div data-v="u.listitem" role="listitem" data-user="true">u.listitem</div>',
};

/** One element per assistant-turn shape Voyager has ever recognized on Gemini. */
const ASSISTANT_SHAPES: Record<string, string> = {
  'a.aria': '<div data-v="a.aria" aria-label="Gemini response">a.aria</div>',
  'a.roleAssistant':
    '<div data-v="a.roleAssistant" data-message-author-role="assistant">a.roleAssistant</div>',
  'a.roleModel': '<div data-v="a.roleModel" data-message-author-role="model">a.roleModel</div>',
  'a.articleAuthor':
    '<article data-v="a.articleAuthor" data-author="assistant">a.articleAuthor</article>',
  'a.articleTurnAssistant':
    '<article data-v="a.articleTurnAssistant" data-turn="assistant">a.articleTurnAssistant</article>',
  'a.articleTurnModel':
    '<article data-v="a.articleTurnModel" data-turn="model">a.articleTurnModel</article>',
  'a.modelResponseTag':
    '<model-response data-v="a.modelResponseTag">a.modelResponseTag</model-response>',
  'a.modelResponseClass':
    '<div data-v="a.modelResponseClass" class="model-response">a.modelResponseClass</div>',
  'a.responseContainerTag':
    '<response-container data-v="a.responseContainerTag">a.responseContainerTag</response-container>',
  'a.responseContainerClass':
    '<div data-v="a.responseContainerClass" class="response-container">a.responseContainerClass</div>',
  'a.presented': '<div data-v="a.presented" class="presented-response-container">a.presented</div>',
  'a.listitem': '<div data-v="a.listitem" role="listitem">a.listitem</div>',
};

const ALL_USER = Object.keys(USER_SHAPES);
const ALL_ASSISTANT = Object.keys(ASSISTANT_SHAPES);

function mountAllShapes(): void {
  document.body.innerHTML = `<main>${Object.values(USER_SHAPES).join('')}${Object.values(
    ASSISTANT_SHAPES,
  ).join('')}</main>`;
}

/** For each selector, in list order, the shapes it matches in document order. */
function profile(selectors: readonly string[]): string[][] {
  return selectors.map((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)).map(
      (element) => element.dataset.v ?? '',
    ),
  );
}

/** Top-level shape ids (not inner elements) matched by a selector list. */
function matchedShapes(ids: readonly string[], selector: string): string[] {
  return ids.filter((id) =>
    Array.from(
      document.querySelectorAll<HTMLElement>(`[data-v="${id}"], [data-v="${id}.inner"]`),
    ).some((element) => element.matches(selector)),
  );
}

function without(ids: readonly string[], excluded: readonly string[]): string[] {
  return ids.filter((id) => !excluded.includes(id));
}

const BUNDLED_USER_PROFILE = [
  ['u.bubble', 'u.contentBubble.inner'],
  ['u.bubbleContainer'],
  ['u.queryContainer'],
  ['u.contentBubble.inner'],
  ['u.aria'],
  ['u.articleAuthor'],
  ['u.articleTurn'],
  ['u.role'],
  ['u.listitem'],
];

/** Shapes the user-turn list shared by timeline, export, fork and highlight recognizes. */
const SHARED_USER_SHAPES = without(ALL_USER, ['u.contentHost', 'u.host']);
/** Shapes the assistant-turn list of export and fork recognizes. */
const PAIRING_ASSISTANT_SHAPES = without(ALL_ASSISTANT, ['a.responseContainerTag', 'a.presented']);

describe('Gemini turn selector owners', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('core getters (plugin adapter, Quote Reply, response notification)', () => {
    it('lists user selectors including the Angular host elements', () => {
      mountAllShapes();
      expect(profile(getUserTurnSelectors())).toEqual([
        ['u.bubble', 'u.contentBubble.inner'],
        ['u.bubbleContainer'],
        ['u.queryContainer'],
        ['u.contentBubble.inner'],
        ['u.contentBubble', 'u.contentHost'],
        ['u.host'],
        ['u.aria'],
        ['u.articleAuthor'],
        ['u.articleTurn'],
        ['u.role'],
        ['u.listitem'],
      ]);
    });

    it('lists assistant selectors including response hosts and the listitem fallback', () => {
      mountAllShapes();
      expect(profile(getAssistantTurnSelectors())).toEqual([
        ['a.aria'],
        ['a.roleAssistant'],
        ['a.roleModel'],
        ['a.articleAuthor'],
        ['a.articleTurnAssistant'],
        ['a.articleTurnModel'],
        ['a.modelResponseTag'],
        ['a.modelResponseClass'],
        ['a.responseContainerTag'],
        ['a.responseContainerClass'],
        ['a.presented'],
        ['a.listitem'],
      ]);
    });

    it('feeds the Gemini plugin adapter every user and assistant shape', () => {
      mountAllShapes();
      expect(matchedShapes(ALL_USER, geminiAdapter.selectors.userTurn)).toEqual(ALL_USER);
      expect(matchedShapes(ALL_ASSISTANT, geminiAdapter.selectors.assistantTurn)).toEqual(
        ALL_ASSISTANT,
      );
      expect(matchedShapes(ALL_ASSISTANT, geminiAdapter.selectors.userTurn)).toEqual([]);
      expect(matchedShapes(ALL_USER, geminiAdapter.selectors.assistantTurn)).toEqual([]);
    });
  });

  describe('export adapter', () => {
    const adapter = () => buildGeminiAdapter(geminiAdapter);

    it('lists the shared user selectors in priority order without Angular hosts', () => {
      mountAllShapes();
      expect(profile(adapter().getUserSelectors())).toEqual(BUNDLED_USER_PROFILE);
    });

    it('puts the override, else the Auto cache, ahead of the bundled user selectors', () => {
      mountAllShapes();
      localStorage.setItem('geminiTimelineUserTurnSelectorAuto', 'user-query');
      expect(profile(adapter().getUserSelectors())).toEqual([['u.host'], ...BUNDLED_USER_PROFILE]);

      localStorage.setItem('geminiTimelineUserTurnSelector', 'article[data-turn="user"]');
      expect(profile(adapter().getUserSelectors())).toEqual([
        ['u.articleTurn'],
        ...BUNDLED_USER_PROFILE.filter((matches) => matches[0] !== 'u.articleTurn'),
      ]);
    });

    it('matches assistant turns without bare response hosts', () => {
      mountAllShapes();
      // Every export consumer joins the list into one query.
      const selector = adapter().getAssistantSelectors().join(',');
      expect(matchedShapes(ALL_ASSISTANT, selector)).toEqual(PAIRING_ASSISTANT_SHAPES);
      expect(matchedShapes(ALL_USER, selector)).toEqual([]);
    });
  });

  describe('fork pairs', () => {
    beforeEach(() => {
      // DOMContentExtractor warns when a bare fixture has no response container.
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('recognizes the shared user shapes', () => {
      const recognized = ALL_USER.filter((id) => {
        document.body.innerHTML = `<main>${USER_SHAPES[id]}<div class="response-container">reply</div></main>`;
        return collectForkChatPairs().length === 1;
      });
      expect(recognized).toEqual(SHARED_USER_SHAPES);
    });

    it('pairs the export assistant shapes', () => {
      const paired = ALL_ASSISTANT.filter((id) => {
        document.body.innerHTML = `<main><div class="user-query-container">prompt</div>${ASSISTANT_SHAPES[id]}</main>`;
        const pairs = collectForkChatPairs();
        return pairs.length === 1 && pairs[0].assistant.includes(id);
      });
      expect(paired).toEqual(PAIRING_ASSISTANT_SHAPES);
    });
  });

  describe('highlight turns', () => {
    it('recognizes the shared user shapes', () => {
      const recognized = ALL_USER.filter((id) => {
        document.body.innerHTML = `<main>${USER_SHAPES[id]}<div class="response-container">reply</div></main>`;
        return collectHighlightTurns().length === 1;
      });
      expect(recognized).toEqual(SHARED_USER_SHAPES);
    });

    it('pairs the export assistant shapes', () => {
      const paired = ALL_ASSISTANT.filter((id) => {
        document.body.innerHTML = `<main><div class="user-query-container">prompt</div>${ASSISTANT_SHAPES[id]}</main>`;
        const turns = collectHighlightTurns();
        return turns.length === 1 && turns[0].assistantHost.dataset.v === id;
      });
      expect(paired).toEqual(PAIRING_ASSISTANT_SHAPES);
    });

    it('uses a generic listitem only when no specific assistant turn is mounted', () => {
      document.body.innerHTML = `<main>
        <div class="user-query-container">prompt</div>
        ${ASSISTANT_SHAPES['a.listitem']}
        ${ASSISTANT_SHAPES['a.modelResponseTag']}
      </main>`;
      expect(collectHighlightTurns().map((turn) => turn.assistantHost.dataset.v)).toEqual([
        'a.modelResponseTag',
      ]);

      document.body.innerHTML = `<main>
        <div class="user-query-container">prompt</div>
        ${ASSISTANT_SHAPES['a.listitem']}
      </main>`;
      expect(collectHighlightTurns().map((turn) => turn.assistantHost.dataset.v)).toEqual([
        'a.listitem',
      ]);
    });

    it('ignores a configured selector that is not valid CSS', () => {
      localStorage.setItem('geminiTimelineUserTurnSelector', 'div[');
      document.body.innerHTML = `<main>${USER_SHAPES['u.bubble']}<div class="response-container">reply</div></main>`;
      expect(collectHighlightTurns()).toHaveLength(1);
    });
  });

  describe('timeline previews', () => {
    it('summarizes the assistant shapes without response hosts or listitems', () => {
      const summarized = ALL_ASSISTANT.filter((id) => {
        document.body.innerHTML = `<main><div class="gv-test-user">prompt</div>${ASSISTANT_SHAPES[id]}</main>`;
        const main = document.querySelector('main') as HTMLElement;
        const [marker] = new TimelineTurns().plan(main, '.gv-test-user').markers;
        return marker?.assistantSummary === id;
      });
      expect(summarized).toEqual(
        without(ALL_ASSISTANT, ['a.responseContainerTag', 'a.presented', 'a.listitem']),
      );
    });
  });

  describe('chat width', () => {
    let styleText = '';

    beforeEach(() => {
      styleText = buildChatWidthCss(chatWidthPx(80));
    });

    function ruleSelector(comment: string): string {
      const start = styleText.indexOf(`/* ${comment} */`);
      expect(start).toBeGreaterThanOrEqual(0);
      const afterComment = styleText.slice(start + comment.length + 6);
      return afterComment.slice(0, afterComment.indexOf('{')).trim();
    }

    it('widens user containers but leaves the bubble, data-turn and listitem shapes alone', () => {
      mountAllShapes();
      expect(matchedShapes(ALL_USER, ruleSelector('User query containers'))).toEqual(
        without(ALL_USER, ['u.bubble', 'u.articleTurn', 'u.listitem']),
      );
      // The bubble inside `user-query-content` must not be widened either.
      const inner = document.querySelector('[data-v="u.contentBubble.inner"]') as HTMLElement;
      expect(inner.matches(ruleSelector('User query containers'))).toBe(false);
    });

    it('widens response containers but leaves data-turn articles and listitems alone', () => {
      mountAllShapes();
      expect(matchedShapes(ALL_ASSISTANT, ruleSelector('Model response containers'))).toEqual(
        without(ALL_ASSISTANT, ['a.articleTurnAssistant', 'a.articleTurnModel', 'a.listitem']),
      );
      expect(matchedShapes(ALL_USER, ruleSelector('Model response containers'))).toEqual([]);
    });
  });
});
