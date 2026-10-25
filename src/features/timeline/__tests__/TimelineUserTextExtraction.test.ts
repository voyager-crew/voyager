import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import { claudeAdapter } from '@/features/plugins/sites/adapters/claude';
import { deepseekAdapter } from '@/features/plugins/sites/adapters/deepseek';
import type { SiteAdapter } from '@/features/plugins/types';
import { TimelineTurns } from '@/pages/content/timeline/TimelineTurns';

import { CatalogTimelineAdapter } from '../adapters/catalog/CatalogTimelineAdapter';
import { CatalogTurnOwnership } from '../adapters/catalog/CatalogTurnOwnership';
import { userTurnText } from '../userTurnText';

beforeEach(() => document.body.replaceChildren());
afterEach(() => document.body.replaceChildren());

function catalog(site: SiteAdapter): CatalogTimelineAdapter {
  const ownership = new CatalogTurnOwnership({
    routeId: () => location.href,
    starId: () => `${site.id}:conv:test`,
  });
  ownership.begin();
  return new CatalogTimelineAdapter(
    {
      siteId: site.id,
      siteLabel: site.label,
      turnSelector: site.selectors.userTurn,
      assistantTurnSelector: site.selectors.assistantTurn,
      conversationIdPattern: site.conversationIdPattern,
      position: 'right',
      pluginId: `voyager.${site.id}-timeline`,
      coachmarkId: 'test',
    },
    ownership,
  );
}

function gemini(markup: string): TimelineTurns {
  document.body.innerHTML = `<main><div class="user-query-bubble-with-background">${markup}</div><model-response><message-content>Assistant answer</message-content></model-response></main>`;
  return new TimelineTurns();
}

function geminiText(): string {
  return userTurnText(document.querySelector<HTMLElement>('.user-query-bubble-with-background')!);
}

function geminiMarkers(turns: TimelineTurns) {
  return turns.commit(
    turns.plan(document.querySelector<HTMLElement>('main')!, '.user-query-bubble-with-background'),
  );
}

describe('Gemini full user text', () => {
  it('a starred prompt keeps its line breaks without changing its summary or assistant preview', () => {
    const turns = gemini('<p>First<br>Second</p><p>Third</p>');
    const [marker] = geminiMarkers(turns);
    expect(geminiText()).toBe('First\nSecond\nThird');
    expect(marker).toMatchObject({
      summary: 'FirstSecondThird',
      assistantSummary: 'Assistant answer',
    });
    expect(geminiMarkers(turns)[0]?.id).toBe(marker?.id);
  });

  it('full user text restores LaTeX and omits hidden labels and injected controls', () => {
    gemini(
      '<div class="query-text"><span class="cdk-visually-hidden">You said</span><p>Formula <span data-user-latex-original="$x^2$">Rendered math</span></p><p>Next<br>line</p><button>Edit prompt</button><div class="gv-fork-indicator-group">Forked</div><div aria-hidden="true">Invisible label</div></div>',
    );
    expect(geminiText()).toBe('Formula $x^2$\nNext\nline');
    expect(document.querySelector('[data-user-latex-original]')?.textContent).toBe('Rendered math');
    expect(document.querySelector('.gv-fork-indicator-group')).not.toBeNull();
  });

  it('a hidden parent cannot make its old preferred text become the saved prompt', () => {
    gemini(
      '<div hidden><div class="query-text">Hidden old</div></div><div class="query-text">Visible prompt</div>',
    );
    expect(geminiText()).toBe('Visible prompt');
  });

  it('an assistant parent cannot make its preferred text become the saved prompt', () => {
    gemini(
      '<model-response><div class="query-text">Assistant answer in old content</div></model-response><div class="query-text">User prompt</div>',
    );
    expect(geminiText()).toBe('User prompt');
  });

  it('highlighted user words survive extraction without changing their host marks', () => {
    gemini(
      '<div class="query-text">Before <mark class="gv-highlight-mark" role="button">highlighted words</mark> after</div>',
    );
    expect(geminiText()).toBe('Before highlighted words after');
    expect(document.querySelector('mark.gv-highlight-mark')?.textContent).toBe('highlighted words');
    expect(document.querySelector('mark.gv-highlight-mark')?.getAttribute('role')).toBe('button');
  });

  it('editing only line breaks or the original LaTeX updates full text', () => {
    gemini('<p>First<br>Second</p><span data-user-latex-original="$x$">math</span>');
    expect(geminiText()).toBe('First\nSecond\n$x$');
    document.querySelector('p')!.innerHTML = 'First<br><br>Second';
    document
      .querySelector('[data-user-latex-original]')!
      .setAttribute('data-user-latex-original', '$y$');
    expect(geminiText()).toBe('First\n\nSecond\n$y$');
  });

  it('blank lines between inline rendered formulas remain in the full prompt', () => {
    gemini(
      '<div class="query-text" style="white-space:pre-wrap"><span data-user-latex-original="$x$">math</span>\n\n<span data-user-latex-original="$y$">math</span></div>',
    );
    expect(geminiText()).toBe('$x$\n\n$y$');
  });

  it('a prompt keeps its leading pre indentation and trailing authored newlines', () => {
    gemini('<pre>  first line\n<span>last</span>\n\n</pre>');
    expect(geminiText()).toBe('  first line\nlast\n\n');
  });

  it('a trailing explicit line break survives the terminal block separator', () => {
    gemini('<p>First<br></p>');
    expect(geminiText()).toBe('First\n');
  });

  it('hiding the user root removes its full text', () => {
    gemini('<p>Visible text</p>');
    expect(geminiText()).toBe('Visible text');
    const element = document.querySelector<HTMLElement>('.user-query-bubble-with-background')!;
    element.setAttribute('aria-hidden', 'true');
    expect(geminiText()).toBe('');
    element.removeAttribute('aria-hidden');
    expect(geminiText()).toBe('Visible text');
  });

  it('a host stylesheet hiding part of an unchanged turn removes that part', () => {
    const sheet = document.createElement('style');
    sheet.textContent = 'main.drafts-hidden .draft { display: none }';
    document.head.append(sheet);
    try {
      gemini('<p>Prompt<span class="draft"> draft</span></p>');
      expect(geminiText()).toBe('Prompt draft');
      document.querySelector('main')!.classList.add('drafts-hidden');
      expect(geminiText()).toBe('Prompt');
    } finally {
      sheet.remove();
    }
  });

  it('full user text keeps authored newlines and preformatted indentation', () => {
    gemini('<pre>line one\n  indented\n\nlast</pre><p>Following paragraph</p>');
    expect(geminiText()).toBe('line one\n  indented\n\nlast\nFollowing paragraph');
  });
});

describe('Catalog mounted full user text', () => {
  it.each([
    {
      site: chatgptAdapter,
      user: '<div data-message-author-role="user"><div data-user-message-bubble><div>First<br>Second</div><div>Third</div></div><button>Copy message</button></div>',
      assistant: '<div data-chatgpt-selection-message-id="reply">Assistant answer</div>',
    },
    {
      site: claudeAdapter,
      user: '<div data-testid="user-message"><span class="sr-only">You said</span><p>First<br>Second</p><p>Third</p><button>Copy message</button></div>',
      assistant: '<div data-testid="assistant-message">Assistant answer</div>',
    },
    {
      site: deepseekAdapter,
      user: '<div class="ds-message"><div class="ds-collapsible-text"><div>First<br>Second</div><div>Third</div></div><button>Copy message</button></div>',
      assistant:
        '<div class="ds-message"><div class="ds-assistant-message-main-content">Assistant answer</div></div>',
    },
  ])('$site.id stores only the user content with line breaks', ({ site, user, assistant }) => {
    document.body.innerHTML = `<main>${user}${assistant}</main>`;
    const adapter = catalog(site);
    try {
      const [marker] = adapter.turns.read([]).markers;
      expect(userTurnText(marker!.element)).toBe('First\nSecond\nThird');
      expect(marker?.assistantSummary).toBe('Assistant answer');
      expect(adapter.turns.read([]).markers[0]?.id).toBe(marker?.id);
    } finally {
      adapter.turns.stop();
    }
  });
});
