import { describe, expect, it } from 'vitest';

import type { ManifestIssue } from '../manifest/validate';
import { validateLocalManifest } from './validateLocalManifest';

function authored(
  contributes: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'me.tweak',
    name: 'Tweak',
    version: '1.0.0',
    description: 'A local tweak',
    author: 'me',
    category: 'layout',
    license: 'MIT',
    engine: '>=1.0.0',
    tier: 'declarative',
    matches: ['https://claude.ai/*'],
    contributes,
    ...overrides,
  };
}

function issues(input: unknown): ManifestIssue[] {
  const result = validateLocalManifest(input);
  return result.success ? [] : result.error;
}

const userTurn = { kind: 'semantic', key: 'userTurn' };

describe('local plugin classes', () => {
  it('refuses a class without the gv- prefix, which would restyle the host through its own names', () => {
    expect(
      issues(authored({ domOps: [{ op: 'addClass', target: userTurn, className: 'rounded' }] })),
    ).toEqual([
      {
        path: 'contributes.domOps[0].className',
        message:
          '"rounded" must be one class name starting with "gv-" (for example "gv-plugin-my-change")',
      },
    ]);
  });

  it('refuses several classes in one addClass, which the page would reject at runtime', () => {
    const op = { op: 'addClass', target: userTurn, className: 'gv-a gv-b' };
    expect(issues(authored({ domOps: [op] })).map((issue) => issue.path)).toEqual([
      'contributes.domOps[0].className',
    ]);
  });

  it('accepts a gv- class', () => {
    const op = { op: 'addClass', target: userTurn, className: 'gv-plugin-tweak' };
    expect(issues(authored({ domOps: [op] }))).toEqual([]);
  });
});

describe('local plugin semantic keys', () => {
  it('refuses a key outside the vocabulary instead of importing a plugin that never runs', () => {
    const op = { op: 'hide', target: { kind: 'semantic', key: 'messageList' } };
    const [issue] = issues(authored({ domOps: [op] }));
    expect(issue.path).toBe('contributes.domOps[0].target.key');
    expect(issue.message).toMatch(
      /^"messageList" is not a semantic key \(the vocabulary is userTurn,/,
    );
  });

  it('refuses a key the targeted site does not declare, naming what it does declare', () => {
    const op = { op: 'hide', target: { kind: 'semantic', key: 'thinkingBlock' } };
    expect(issues(authored({ domOps: [op] }))).toEqual([
      {
        path: 'contributes.domOps[0].target.key',
        message: expect.stringMatching(
          /^Claude does not declare semantic key "thinkingBlock" .*target a CSS selector instead$/,
        ),
      },
    ]);
    // DeepSeek declares it, so the same op imports there.
    expect(
      issues(authored({ domOps: [op] }, { matches: ['https://chat.deepseek.com/*'] })),
    ).toEqual([]);
  });

  it('refuses a key that only some of the targeted sites declare', () => {
    const op = { op: 'hide', target: { kind: 'semantic', key: 'thinkingBlock' } };
    const both = { matches: ['https://chat.deepseek.com/*', 'https://claude.ai/*'] };
    expect(issues(authored({ domOps: [op] }, both))[0].message).toMatch(
      /^Claude does not declare semantic key "thinkingBlock"/,
    );
  });

  it('refuses requires.semantic and primitive keys the site lacks', () => {
    expect(issues(authored({}, { requires: { semantic: ['codeBlock'] } }))).toEqual([
      {
        path: 'requires.semantic',
        message: expect.stringMatching(/^Claude does not declare semantic key "codeBlock" /),
      },
    ]);
    expect(
      validateLocalManifest(authored({}, { requires: { semantic: ['sidePanel'] } })).success,
    ).toBe(true);
    const mermaid = { op: 'native', handler: 'mermaid', params: {} };
    expect(issues(authored({ domOps: [mermaid] }, { engine: '>=1.7.0' }))).toEqual([
      {
        path: 'contributes.domOps[0]',
        message: expect.stringMatching(
          /^Claude does not declare semantic key "codeBlock" .*which primitive "mermaid" reads$/,
        ),
      },
    ]);
  });

  it('refuses a key a primitive param names at that param, without requires.semantic', () => {
    const copy = { op: 'native', handler: 'copyButton', params: { target: 'thinkingBlock' } };
    expect(issues(authored({ domOps: [copy] }, { engine: '>=1.8.0' }))).toEqual([
      {
        path: 'contributes.domOps[0].params.target',
        message: expect.stringMatching(/^Claude does not declare semantic key "thinkingBlock" /),
      },
    ]);
    const deepseek = { engine: '>=1.8.0', matches: ['https://chat.deepseek.com/*'] };
    expect(issues(authored({ domOps: [copy] }, deepseek))).toEqual([]);
  });
});

describe('local plugin settings', () => {
  it.each(['string', 'color'])(
    'refuses a %s setting, which the popup cannot show a control for',
    (type) => {
      const settings = { accent: { type, label: 'Accent', default: '#4d6bfe' } };
      expect(issues(authored({ settings }))).toEqual([
        {
          path: 'contributes.settings.accent.type',
          message: `"${type}" settings have no control in the popup yet: use boolean, number, select`,
        },
      ]);
    },
  );

  it('accepts boolean, number and select settings used through {{tokens}}', () => {
    const contributes = {
      settings: {
        on: { type: 'boolean', label: 'On', default: true },
        width: { type: 'number', label: 'Width', default: 3, min: 1, max: 8 },
        tone: {
          type: 'select',
          label: 'Tone',
          default: 'soft',
          options: [
            { value: 'soft', label: 'Soft' },
            { value: 'loud', label: 'Loud' },
          ],
        },
      },
      styles: [{ css: '.gv-plugin-tweak{border-left:var(--gv-plugin-tweak-w) solid}' }],
      domOps: [
        { op: 'addClass', target: userTurn, className: 'gv-plugin-tweak' },
        { op: 'setStyle', target: userTurn, styles: { '--gv-plugin-tweak-w': '{{width}}px' } },
        { op: 'setAttribute', target: userTurn, name: 'data-gv-tone', value: '{{tone}}' },
      ],
    };
    expect(issues(authored(contributes))).toEqual([]);
  });
});
