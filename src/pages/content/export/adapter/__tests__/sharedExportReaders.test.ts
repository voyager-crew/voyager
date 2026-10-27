// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://custom.example/app/abcdef1234" }
import { afterEach, describe, expect, it } from 'vitest';

import { geminiAdapter } from '@/features/plugins/sites/adapters/gemini';

import { pickAssistantExportElement } from '../../conversationDom';
import { buildGeminiAdapter } from '../platform/gemini';
import { buildGenericExportAdapter } from '../platform/generic';
import { pickGenericAssistantExportElement } from '../platform/genericDom';

const adapters = [buildGeminiAdapter(geminiAdapter), buildGenericExportAdapter()];
afterEach(() => {
  document.body.replaceChildren();
  document.title = '';
});

it('Gemini and custom export preserve title priority from folder selection through current row and page fallback', () => {
  document.title = 'Page title';
  document.body.innerHTML =
    '<div class="gv-folder-conversation-selected"><span class="gv-conversation-title">Filed title</span></div><div data-test-id="conversation" jslog="c_abcdef1234"><h3>Current row</h3><a href="/app/abcdef1234" aria-label="Link title"></a></div><mat-list-item aria-current="page"><span mat-line>Active title</span></mat-list-item>';
  const titles = () => adapters.map((adapter) => adapter.extractConversationTitle());
  expect(titles()).toEqual(['Filed title', 'Filed title']);
  document.querySelector('.gv-folder-conversation-selected')!.remove();
  expect(titles()).toEqual(['Current row', 'Current row']);
  document.querySelector('h3')!.remove();
  expect(titles()).toEqual(['Link title', 'Link title']);
  document.querySelector('[data-test-id="conversation"]')!.remove();
  expect(titles()).toEqual(['Page title', 'Page title']);
  document.title = 'Gemini';
  expect(titles()).toEqual(['Active title', 'Active title']);
  document.querySelector('mat-list-item')!.remove();
  expect(titles()).toEqual(['Conversation abcdef12', 'Conversation abcdef12']);
});

describe.each([
  [
    '<model-thoughts><message-content>Private</message-content></model-thoughts><message-content id="answer">Answer</message-content><div class="markdown">Other</div>',
    '#answer',
  ],
  [
    '<div class="markdown" id="answer">Markdown answer</div><div class="response-content">Other</div>',
    '#answer',
  ],
  [
    '<div class="response-content" id="answer">Presented answer</div><response-element>Other</response-element>',
    '#answer',
  ],
  ['<response-element id="answer">Response answer</response-element>', '#answer'],
  ['No inner wrapper', 'article'],
])('shared assistant export preference', (markup, expected) => {
  it('reads the same original element through Gemini and the custom-host profile', () => {
    document.body.innerHTML = `<article>${markup}</article>`;
    const host = document.querySelector('article')!;
    const answer = document.querySelector(expected);
    expect(pickAssistantExportElement(host)).toBe(answer);
    expect(pickGenericAssistantExportElement(host)).toBe(answer);
  });
});

it('the presented ancestor keeps precedence over its nested fallback content in both profiles', () => {
  document.body.innerHTML =
    '<section class="presented-response-container"><article><div class="response-content">Answer</div></article></section>';
  const host = document.querySelector('article')!;
  expect(pickAssistantExportElement(host)).toBe(document.querySelector('section'));
  expect(pickGenericAssistantExportElement(host)).toBe(document.querySelector('section'));
});
