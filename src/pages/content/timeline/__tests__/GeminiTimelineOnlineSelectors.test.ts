import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installGeminiTurnPatch } from '../../__tests__/geminiOnlineTurnFixture';
import { GeminiTimelineTurnSource } from '../GeminiTimelineTurnSource';
import { TimelineTurns } from '../TimelineTurns';

describe('timeline turn discovery with online profiles', () => {
  let stopSelectors: (() => void) | undefined;
  let source: GeminiTimelineTurnSource | undefined;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `<main>
      <section class="conversation-container" id="1111111111111111">
        <div class="user-query-bubble-with-background online-user">First question</div>
        <model-response class="online-assistant"><message-content>First answer</message-content></model-response>
      </section>
      <section class="conversation-container" id="2222222222222222">
        <div class="user-query-bubble-with-background online-user">Second question</div>
        <model-response class="online-assistant"><message-content>Second answer</message-content></model-response>
      </section>
    </main>`;
  });

  afterEach(() => {
    source?.stop();
    stopSelectors?.();
    source = undefined;
    stopSelectors = undefined;
    localStorage.clear();
    document.body.replaceChildren();
  });

  async function start(): Promise<GeminiTimelineTurnSource> {
    source = new GeminiTimelineTurnSource(false);
    await source.initialize(new AbortController().signal);
    return source;
  }

  it('keeps the same nodes, order, summaries and server ids through renamed turn hosts', async () => {
    const before = (await start()).read([]);
    source?.stop();
    localStorage.setItem('geminiTimelineUserTurnSelectorAuto', '.stale-user');
    stopSelectors = await installGeminiTurnPatch({
      'turn.user': ['.online-user'],
      'turn.assistant': ['.online-assistant'],
    });

    const after = (await start()).read([]);

    expect(after).toEqual(before);
    expect(after.markers.map(({ id }) => id)).toEqual(['s-1111111111111111', 's-2222222222222222']);
    expect(localStorage.getItem('geminiTimelineUserTurnSelectorAuto')).toBe('.stale-user');
  });

  it('keeps first-selector priority instead of collecting every online profile entry', async () => {
    const users = document.querySelectorAll<HTMLElement>('.online-user');
    users[0].classList.add('earlier');
    users[1].classList.add('preferred');
    stopSelectors = await installGeminiTurnPatch({ 'turn.user': ['.preferred', '.earlier'] });

    const timeline = await start();

    expect(timeline.read([]).markers.map(({ element }) => element)).toEqual([users[1]]);
    expect(timeline.count()).toBe(1);
  });

  it('observes the conversation for an unfamiliar online selector and follows later sibling turns', async () => {
    stopSelectors = await installGeminiTurnPatch({ 'turn.user': ['.online-user'] });
    document.querySelectorAll('.user-query-bubble-with-background').forEach((node) => {
      node.classList.remove('user-query-bubble-with-background');
    });
    const timeline = await start();
    let changes = 0;
    timeline.observe(() => {
      changes += 1;
    });
    const section = document.createElement('section');
    section.innerHTML = '<div class="online-user">Third question</div>';
    document.querySelector('main')!.append(section);
    await Promise.resolve();

    expect(timeline.root).toBe(document.querySelector('main'));
    expect(changes).toBeGreaterThan(0);
    expect(timeline.read([]).markers.map(({ summary }) => summary)).toEqual([
      'First question',
      'Second question',
      'Third question',
    ]);
    timeline.stop();
    changes = 0;
    section.append(document.createElement('p'));
    await Promise.resolve();
    expect(changes).toBe(0);
  });

  it('falls back the entire timeline read when the online user profile has no turn', async () => {
    stopSelectors = await installGeminiTurnPatch({
      'turn.user': ['.missing-user'],
      'turn.assistant': ['.missing-assistant'],
    });
    const timeline = await start();
    const snapshot = timeline.read([]);

    expect(snapshot.markers.map(({ assistantSummary }) => assistantSummary)).toEqual([
      'First answer',
      'Second answer',
    ]);
    expect(snapshot.markers.map(({ id }) => id)).toEqual([
      's-1111111111111111',
      's-2222222222222222',
    ]);
    expect(timeline.count()).toBe(2);
  });

  it('keeps one conversation observer when fallback finds turns outside the old remote parent', async () => {
    const main = document.querySelector('main')!;
    main.innerHTML = `
      <section class="conversation-container" id="1111111111111111">
        <article data-author="user" id="online-user">Original question</article>
      </section>
      <section class="conversation-container" id="2222222222222222">
        <div class="user-query-bubble-with-background" id="bundled-user">Fallback question</div>
      </section>`;
    // A known attribute selector historically used its immediate parent in bundled discovery.
    stopSelectors = await installGeminiTurnPatch({ 'turn.user': ['article[data-author="user"]'] });
    const timeline = await start();
    const previous = timeline.read([]).markers;
    let changes = 0;
    timeline.observe(() => {
      changes += 1;
    });
    document.getElementById('online-user')!.remove();
    await Promise.resolve();
    const next = timeline.read(previous).markers;

    expect(timeline.root).toBe(main);
    expect(timeline.count()).toBe(1);
    expect(next.map(({ element, id }) => ({ element, id }))).toEqual([
      { element: document.getElementById('bundled-user'), id: 's-2222222222222222' },
    ]);
    changes = 0;
    document.getElementById('bundled-user')!.append(document.createElement('span'));
    await Promise.resolve();
    expect(changes).toBeGreaterThan(0);
  });

  it('keeps explicit user overrides ahead of the active online user profile', async () => {
    const users = document.querySelectorAll<HTMLElement>('.online-user');
    users[1].classList.add('chosen-by-user');
    localStorage.setItem('geminiTimelineUserTurnSelector', '.chosen-by-user');
    stopSelectors = await installGeminiTurnPatch({ 'turn.user': ['.online-user'] });

    const timeline = await start();

    expect(timeline.read([]).markers.map(({ element }) => element)).toEqual([users[1]]);
    expect(localStorage.getItem('geminiTimelineUserTurnSelectorAuto')).toBeNull();
  });

  it('keeps the bundled winning selector latched while that turn shape is absent', async () => {
    const timeline = await start();
    document.querySelector('main')!.innerHTML =
      '<article data-author="user">Different shape</article>';

    expect(timeline.count()).toBe(0);
    expect(timeline.read([]).markers).toEqual([]);
    expect(timeline.refresh()).toBe(false);
  });

  it('reads online assistant summaries with the same ids as the bundled preview reader', async () => {
    const main = document.querySelector('main')!;
    const turns = new TimelineTurns();
    const before = turns.commit(turns.plan(main, '.online-user'));
    stopSelectors = await installGeminiTurnPatch({ 'turn.assistant': ['.online-assistant'] });
    const after = turns.commit(turns.plan(main, '.online-user', before));

    expect(
      after.map(({ id, element, assistantSummary }) => ({ id, element, assistantSummary })),
    ).toEqual(
      before.map(({ id, element, assistantSummary }) => ({ id, element, assistantSummary })),
    );
  });

  it('keeps usable user markers when the online assistant preview matches nothing', async () => {
    stopSelectors = await installGeminiTurnPatch({ 'turn.assistant': ['.missing-preview'] });
    const timeline = await start();
    const markers = timeline.read([]).markers;

    expect(markers.map(({ id }) => id)).toEqual(['s-1111111111111111', 's-2222222222222222']);
    expect(markers.map(({ assistantSummary }) => assistantSummary)).toEqual(['', '']);
  });

  it('does not let an uncommitted identity plan change the next positional allocation', () => {
    const main = document.querySelector('main')!;
    const turns = new TimelineTurns();
    const rejected = turns.plan(main, '.online-user');
    expect(rejected.markers.map(({ id }) => id)).toEqual([
      's-1111111111111111',
      's-2222222222222222',
    ]);
    expect(
      Array.from(main.querySelectorAll<HTMLElement>('.online-user'), (node) => node.dataset.turnId),
    ).toEqual([undefined, undefined]);

    main.innerHTML = '<div class="accepted-user">No server id</div>';
    const [accepted] = turns.commit(turns.plan(main, '.accepted-user'));

    expect(accepted.id).toBe('u-0');
    expect(accepted.element.dataset.turnId).toBe('u-0');
  });
});
