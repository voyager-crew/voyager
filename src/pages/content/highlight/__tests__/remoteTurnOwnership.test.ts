import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accountIsolationService } from '@/core/services/AccountIsolationService';

import { installGeminiTurnPatch } from '../../__tests__/geminiOnlineTurnFixture';
import { HighlightClient } from '../client';
import { HighlightManager } from '../manager';
import { makeRecord, selectText } from './fixtures';

vi.mock('@/core/services/AccountIsolationService', () => ({
  detectAccountContextFromDocument: vi.fn(() => ({ routeUserId: '0', email: null })),
  accountIsolationService: { resolveAccountScope: vi.fn() },
}));

describe('highlight saves with remote turn profiles', () => {
  let stopSelectors: (() => void) | undefined;
  let manager: HighlightManager | undefined;

  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, '', '/app/test');
    vi.mocked(accountIsolationService.resolveAccountScope).mockResolvedValue({
      accountKey: 'route:0',
      accountId: 1,
      routeUserId: '0',
      emailHash: null,
    });
    document.body.innerHTML = `<main>
      <section class="conversation-container" id="1111111111111111">
        <div class="user-query-container online-user">First question</div>
        <model-response class="online-assistant"><message-content>First answer</message-content></model-response>
      </section>
      <section class="conversation-container" id="2222222222222222">
        <div class="user-query-container online-user preferred">Second question</div>
        <model-response class="online-assistant"><message-content id="selected-answer">Second answer</message-content></model-response>
      </section>
    </main>`;
  });

  afterEach(() => {
    manager?.destroy();
    stopSelectors?.();
    manager = undefined;
    stopSelectors = undefined;
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.replaceChildren();
    document.getElementById('gv-highlight-style')?.remove();
  });

  it('a remote turn order cannot save a highlight under another turns ID', async () => {
    stopSelectors = await installGeminiTurnPatch({
      'turn.user': ['.preferred', '.online-user'],
      'turn.assistant': ['.online-assistant'],
    });
    const client = new HighlightClient();
    vi.spyOn(client, 'list').mockResolvedValue([]);
    const save = vi
      .spyOn(client, 'create')
      .mockImplementation(async (_scope, input) => makeRecord(input.anchor, { ...input }));
    manager = new HighlightManager(client);
    await manager.init();

    const answer = document.getElementById('selected-answer')!;
    await expect(manager.createFromRange(selectText(answer, 'Second answer'))).resolves.toBe(true);

    expect(save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ accountKey: 'route:0' }),
      expect.objectContaining({
        turnId: 's-2222222222222222',
        anchor: expect.objectContaining({
          quote: expect.objectContaining({ exact: 'Second answer' }),
        }),
      }),
    );
    expect(document.querySelector('.gv-highlight-mark')?.textContent).toBe('Second answer');
  });
});
