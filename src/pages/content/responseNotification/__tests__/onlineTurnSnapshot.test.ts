import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getBundledGeminiTurnView } from '@/core/gemini/selectors';
import { getAssistantTurnSelectors, getUserTurnSelectors } from '@/core/utils/selectors';

import { installGeminiTurnPatch } from '../../__tests__/geminiOnlineTurnFixture';
import {
  getAssistantResponses,
  getLatestAssistantResponse,
  getUserPromptElements,
} from '../pageSnapshot';

describe('notification page snapshots with online host profiles', () => {
  let stopSelectors: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = `<main>
      <user-query class="online-user" id="prompt">Question</user-query>
      <model-response class="online-assistant" id="outer">
        <div class="presented-response-container online-assistant" id="inner">Answer</div>
      </model-response>
    </main>`;
  });

  afterEach(() => {
    stopSelectors?.();
    stopSelectors = undefined;
    document.body.replaceChildren();
  });

  it('keeps nested assistant hosts in document order and the same latest response', async () => {
    const before = getAssistantResponses();
    const latest = getLatestAssistantResponse();
    stopSelectors = await installGeminiTurnPatch({
      'turn.assistantWithHosts': ['.online-assistant'],
    });

    expect(getAssistantResponses()).toEqual(before);
    expect(getLatestAssistantResponse()).toBe(latest);
    expect(before.map(({ id }) => id)).toEqual(['outer', 'inner']);
  });

  it('uses bundled nonempty responses when the online hosts have no readable response', async () => {
    document
      .querySelector('main')!
      .insertAdjacentHTML('beforeend', '<div class="empty-online-response"></div>');
    stopSelectors = await installGeminiTurnPatch({
      'turn.assistantWithHosts': ['.empty-online-response'],
    });

    expect(getAssistantResponses().map(({ id }) => id)).toEqual(['outer', 'inner']);
    expect(getLatestAssistantResponse()?.id).toBe('inner');
  });

  it('keeps user-like descendants of an empty assistant host out of prompt evidence', async () => {
    document
      .querySelector('main')!
      .insertAdjacentHTML(
        'beforeend',
        '<div class="empty-online-response"><div data-test-id="user-placeholder" id="false-prompt"></div></div>',
      );
    stopSelectors = await installGeminiTurnPatch({
      'turn.assistantWithHosts': ['.online-assistant', '.empty-online-response'],
    });

    expect(getUserPromptElements().map(({ id }) => id)).toEqual(['prompt']);
  });

  it('lets shared selector readers use one explicit bundled view or the effective host view', async () => {
    const bundle = getBundledGeminiTurnView();
    const beforeUsers = Array.from(
      document.querySelectorAll(getUserTurnSelectors(bundle).join(',')),
    );
    const beforeAssistants = Array.from(
      document.querySelectorAll(getAssistantTurnSelectors(bundle).join(',')),
    );
    stopSelectors = await installGeminiTurnPatch({
      'turn.userWithHosts': ['.online-user'],
      'turn.assistantWithHosts': ['.online-assistant'],
    });

    expect(Array.from(document.querySelectorAll(getUserTurnSelectors().join(',')))).toEqual(
      beforeUsers,
    );
    expect(Array.from(document.querySelectorAll(getAssistantTurnSelectors().join(',')))).toEqual(
      beforeAssistants,
    );
    document.getElementById('prompt')!.classList.remove('online-user');
    expect(document.querySelector(getUserTurnSelectors().join(','))).toBeNull();
    expect(document.querySelector(getUserTurnSelectors(bundle).join(','))?.id).toBe('prompt');
  });
});
