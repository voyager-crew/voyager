import { afterEach, expect, it } from 'vitest';

import { installGeminiTurnPatch } from '../../__tests__/geminiOnlineTurnFixture';
import {
  getAssistantResponses,
  getLatestUserPromptText,
  getUserPromptElements,
} from '../pageSnapshot';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
});

it('a repaired user host retains the same prompt elements and hidden-label stripping on the same DOM', async () => {
  document.body.innerHTML = `<div class="conversation-container">
    <user-query class="repair"><div class="user-query-container repair"><span class="user-query-text">Original prompt</span><span class="visually-hidden">You said</span></div></user-query>
    <model-response>Answer</model-response></div>`;
  const before = getUserPromptElements();
  const prompt = getLatestUserPromptText();
  stop = await installGeminiTurnPatch({ 'turn.userWithHosts': ['.repair'] });
  expect(getUserPromptElements()).toEqual(before);
  expect(getLatestUserPromptText()).toBe(prompt);
  expect(prompt).toBe('Original prompt');
});

it('a renamed user host supplies the latest notification prompt instead of an older prompt', async () => {
  document.body.innerHTML = `<div class="conversation-container"><section class="repair">First prompt</section><model-response>First answer</model-response></div>
    <div class="conversation-container"><section class="repair">Latest prompt<span class="visually-hidden">You said</span></section><model-response>Latest answer</model-response></div>`;
  stop = await installGeminiTurnPatch({ 'turn.userWithHosts': ['.repair'] });
  expect(getUserPromptElements().map((node) => node.textContent)).toEqual([
    'First prompt',
    'Latest promptYou said',
  ]);
  expect(getLatestUserPromptText()).toBe('Latest prompt');
});

it('a partial user alias cannot replace the latest bundled prompt with the first one', async () => {
  document.body.innerHTML = `<div class="conversation-container"><user-query class="repair">First prompt</user-query><model-response>First answer</model-response></div>
    <div class="conversation-container"><user-query>Latest prompt</user-query><model-response>Latest answer</model-response></div>`;
  stop = await installGeminiTurnPatch({ 'turn.userWithHosts': ['.repair'] });
  expect(getLatestUserPromptText()).toBe('Latest prompt');
  document.querySelectorAll('user-query')[1].classList.add('repair');
  expect(getUserPromptElements().map((node) => node.textContent)).toEqual([
    'First prompt',
    'Latest prompt',
  ]);
});

it('an unrelated user alias is rejected until it has a complete native conversation owner', async () => {
  document.body.innerHTML = '<section class="repair">Profile draft</section>';
  stop = await installGeminiTurnPatch({ 'turn.userWithHosts': ['.repair'] });
  expect(getLatestUserPromptText()).toBe('');
  document.body.innerHTML =
    '<div class="conversation-container"><section class="repair">Sent prompt</section><model-response>Answer</model-response></div>';
  expect(getLatestUserPromptText()).toBe('Sent prompt');
});

it.each([
  'model-thoughts',
  'deep-research-immersive-panel',
  'div class="thoughts-container"',
  'div class="thoughts-content"',
])('notification aliases inside %s cannot become a later prompt or answer', async (excluded) => {
  const tag = excluded.split(' ')[0];
  document.body.innerHTML = `<div class="conversation-container"><user-query class="repair">Real prompt</user-query><model-response class="reply-fix">Real answer</model-response></div><${excluded}><section class="repair">Hidden thought prompt</section><section class="reply-fix">Hidden thought answer</section></${tag}>`;
  stop = await installGeminiTurnPatch({
    'turn.userWithHosts': ['.repair'],
    'turn.assistantWithHosts': ['.reply-fix'],
  });
  expect(getLatestUserPromptText()).toBe('Real prompt');
  expect(getAssistantResponses().map((node) => node.textContent)).toEqual(['Real answer']);
});

it('a renamed prompt host excludes native action labels and thoughts from its notification text', async () => {
  document.body.innerHTML =
    '<div class="conversation-container"><section class="repair">Sent prompt<button>Edit prompt</button><model-thoughts>Hidden thought</model-thoughts><span class="visually-hidden">You said</span></section><model-response>Answer</model-response></div>';
  stop = await installGeminiTurnPatch({ 'turn.userWithHosts': ['.repair'] });
  expect(getLatestUserPromptText()).toBe('Sent prompt');
});
