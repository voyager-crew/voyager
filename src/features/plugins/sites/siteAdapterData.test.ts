import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isSameSiteAdapter } from '../remote/siteOverride';
import {
  isValidSelectorSyntax,
  readSiteAdapterData,
  siteAdapterToData,
  validateSiteAdapterData,
} from './siteAdapterData';

const VALID = {
  id: 'deepseek',
  label: 'DeepSeek',
  matches: ['https://chat.deepseek.com/*'],
  selectors: {
    userTurn: '.ds-message.user',
    composer: 'textarea.ds-scroll-area',
  },
  theme: { hostSelector: 'body', lightSelector: 'body.light', darkSelector: 'body.dark' },
  brandColor: '#4d6bfe',
  capabilities: ['chat', 'composer', 'darkMode'],
  conversationIdPattern: '^/a/chat/s/([^/?#]+)',
};

const MODEL_PICKER = {
  format: 1,
  triggerLabels: { en: ['Choose a model'] },
  effortStatus: { en: '{label}, item {position} of {count}.' },
  models: {
    m1: {
      labels: { en: ['Model One'] },
      efforts: [
        { id: 'low', labels: { en: ['Low'] } },
        { id: 'high', labels: { en: ['High'] } },
      ],
    },
    m2: { labels: { en: ['Model Two'] } },
  },
  presets: {
    pro: { mode: 'chat', model: 'm1', effort: 'high' },
    plain: { mode: 'chat', model: 'm2' },
  },
};

function issuesOf(raw: unknown): string[] {
  const result = validateSiteAdapterData(raw);
  return result.success ? [] : result.error.map((issue) => issue.path);
}

describe('validateSiteAdapterData', () => {
  it('accepts a complete site.json and builds a SiteAdapter with a capability Set', () => {
    const result = validateSiteAdapterData(VALID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe('deepseek');
    expect(result.data.capabilities).toEqual(new Set(['chat', 'composer', 'darkMode']));
    expect(result.data.selectors).toEqual(VALID.selectors);
    expect(result.data.conversationIdPattern).toBe('^/a/chat/s/([^/?#]+)');
  });

  it('round-trips through siteAdapterToData', () => {
    const result = validateSiteAdapterData(VALID);
    if (!result.success) throw new Error('fixture must validate');
    const data = siteAdapterToData(result.data);
    expect(data).toEqual({ ...VALID, capabilities: ['chat', 'composer', 'darkMode'] });
    expect(validateSiteAdapterData(data)).toEqual(result);
  });

  it('a freshness stamp survives publication and cache serialization without changing unstamped data', () => {
    const stamped = { ...VALID, catalogRevision: 42 };
    const result = validateSiteAdapterData(stamped);
    if (!result.success) throw new Error('fixture must validate');
    expect(result.data.catalogRevision).toBe(42);
    expect(
      validateSiteAdapterData(JSON.parse(JSON.stringify(siteAdapterToData(result.data)))),
    ).toEqual(result);
    for (const catalogRevision of [
      -1,
      0.5,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      '42',
      null,
    ]) {
      expect(issuesOf({ ...VALID, catalogRevision })).toEqual(['catalogRevision']);
    }
    expect(issuesOf(VALID)).toEqual([]);
  });

  it('fails the authoring verdict for a selector key outside the vocabulary', () => {
    expect(issuesOf({ ...VALID, selectors: { ...VALID.selectors, messageBubble: '.x' } })).toEqual([
      'selectors.messageBubble',
    ]);
    // Alongside other errors, so a typo is never hidden behind them.
    expect(issuesOf({ ...VALID, id: 'Deep Seek', selectors: { messageBubble: '.x' } })).toEqual([
      'id',
      'selectors.messageBubble',
    ]);
  });

  it('a newer catalog key no longer drops every remote selector fix', () => {
    const read = readSiteAdapterData({
      ...VALID,
      selectors: { ...VALID.selectors, messageBubble: '.x' },
    });
    expect(read.result.success).toBe(true);
    if (!read.result.success) return;
    expect(read.result.data.selectors).toEqual(VALID.selectors);
    expect(read.sectionIssues).toEqual([
      { path: 'selectors.messageBubble', message: 'unknown semantic selector key' },
    ]);
  });

  it('a broken known locator falls back without discarding the other site data', () => {
    document.body.innerHTML =
      '<div class="ds-message"><div class="ds-collapsible-text">Question</div></div><textarea class="ds-scroll-area">Draft</textarea>';
    const read = readSiteAdapterData({
      ...VALID,
      selectors: { ...VALID.selectors, messageBubble: '.x', userTurn: '[' },
    });
    expect(read.result.success).toBe(true);
    if (!read.result.success) throw new Error('Expected the surviving adapter');
    expect(document.querySelector(read.result.data.selectors.userTurn)?.textContent).toBe(
      'Question',
    );
    expect(document.querySelector(read.result.data.selectors.composer)?.textContent).toBe('Draft');
    expect(read.sectionIssues.map((issue) => issue.path)).toEqual([
      'selectors.messageBubble',
      'selectors.userTurn',
    ]);
    document.body.replaceChildren();
  });

  it('rejects malformed ids, labels, matches, colours, capabilities and patterns', () => {
    expect(issuesOf({ ...VALID, id: 'Deep Seek' })).toEqual(['id']);
    expect(issuesOf({ ...VALID, label: '' })).toEqual(['label']);
    expect(issuesOf({ ...VALID, matches: [] })).toEqual(['matches']);
    expect(issuesOf({ ...VALID, matches: ['chat.deepseek.com'] })).toEqual(['matches']);
    expect(issuesOf({ ...VALID, brandColor: 'blue' })).toEqual(['brandColor']);
    expect(issuesOf({ ...VALID, capabilities: ['chat', 'voice'] })).toEqual(['capabilities[1]']);
    expect(issuesOf({ ...VALID, conversationIdPattern: '(' })).toEqual(['conversationIdPattern']);
    expect(issuesOf({ ...VALID, conversationIdPattern: '^/(a+)+$' })).toEqual([
      'conversationIdPattern',
    ]);
    expect(issuesOf({ ...VALID, conversationIdPattern: '^/(a|aa)+$' })).toEqual([
      'conversationIdPattern',
    ]);
    expect(issuesOf({ ...VALID, conversationIdPattern: '^/((a+))+$' })).toEqual([
      'conversationIdPattern',
    ]);
    expect(issuesOf({ ...VALID, theme: { hostSelector: 'body' } })).toEqual([
      'theme.lightSelector',
      'theme.darkSelector',
    ]);
    expect(issuesOf(null)).toEqual(['']);
  });

  it('rejects selectors that do not parse instead of letting the engine skip them silently', () => {
    expect(issuesOf({ ...VALID, selectors: { ...VALID.selectors, userTurn: '[' } })).toEqual([
      'selectors.userTurn',
    ]);
    expect(issuesOf({ ...VALID, theme: { ...VALID.theme, darkSelector: 'body]' } })).toEqual([
      'theme.darkSelector',
    ]);
    expect(isValidSelectorSyntax('.ds-message:has(.x):not([data-a="b"])')).toBe(true);
    // Without a DOM: siteAdapterDataWithoutDom.test.ts.
  });

  it('a remote turn key that is not a plain attribute name cannot reach a selector', () => {
    const keyed = { ...VALID, turnKeyAttributes: ['data-message-id'] };
    const result = validateSiteAdapterData(keyed);
    if (!result.success) throw new Error('fixture must validate');
    expect(validateSiteAdapterData(siteAdapterToData(result.data))).toEqual(result);
    for (const turnKeyAttributes of [[], ['x],*'], ['Data-Id'], 'data-id', [1]]) {
      expect(issuesOf({ ...VALID, turnKeyAttributes })).toEqual(['turnKeyAttributes']);
    }
  });

  it('treats brandColor, capabilities and conversationIdPattern as optional', () => {
    const { brandColor, capabilities, conversationIdPattern, ...minimal } = VALID;
    void brandColor;
    void capabilities;
    void conversationIdPattern;
    const result = validateSiteAdapterData(minimal);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.brandColor).toBeUndefined();
    expect(result.data.capabilities.size).toBe(0);
    expect(result.data.conversationIdPattern).toBeUndefined();
  });
});

describe('optional site sections', () => {
  const BRIDGE = { format: 1, allow: ['conversation.open', 'composer.send'] };

  it('keeps a valid bridge policy through the cache round trip', () => {
    const result = validateSiteAdapterData({ ...VALID, bridge: BRIDGE });
    if (!result.success) throw new Error('fixture must validate');
    expect(result.data.bridge).toEqual(BRIDGE);
    const reread = validateSiteAdapterData(siteAdapterToData(result.data));
    expect(reread.success && reread.data.bridge).toEqual(BRIDGE);
  });

  it.each([
    ['not an object', 'allow-everything'],
    ['an unknown format', { format: 2, allow: ['composer.send'] }],
    ['allow that is not a list', { format: 1, allow: 'composer.send' }],
    ['a duplicate op', { format: 1, allow: ['composer.send', 'composer.send'] }],
    ['a non-string op', { format: 1, allow: [1] }],
  ])('drops a bridge policy with %s but still updates the site', (_label, bridge) => {
    const read = readSiteAdapterData({ ...VALID, bridge });
    expect(read.result.success).toBe(true);
    if (!read.result.success) return;
    expect(read.result.data.bridge).toBeUndefined();
    expect(read.result.data.selectors).toEqual(VALID.selectors);
    expect(read.sectionIssues.length).toBeGreaterThan(0);
  });

  it('skips an op this build does not know, without dropping the rest', () => {
    const read = readSiteAdapterData({
      ...VALID,
      bridge: { format: 1, allow: ['composer.send', 'canvas.paint'] },
    });
    expect(read.result.success && read.result.data.bridge?.allow).toEqual(['composer.send']);
    expect(read.sectionIssues.map((issue) => issue.path)).toEqual(['bridge.allow[1]']);
  });

  it('drops a modelPicker section in a format this build does not read', () => {
    const read = readSiteAdapterData({ ...VALID, modelPicker: { ...MODEL_PICKER, format: 2 } });
    expect(read.result.success && read.result.data.modelPicker).toBeUndefined();
    expect(read.sectionIssues.map((issue) => issue.path)).toEqual(['modelPicker.format']);
  });

  it('keeps a format-1 modelPicker section through a publish round trip', () => {
    const read = readSiteAdapterData({ ...VALID, modelPicker: MODEL_PICKER });
    expect(read.sectionIssues).toEqual([]);
    if (!read.result.success) throw new Error('fixture must validate');
    expect(read.result.data.modelPicker).toEqual(MODEL_PICKER);
    const again = readSiteAdapterData(
      JSON.parse(JSON.stringify(siteAdapterToData(read.result.data))),
    );
    expect(again.result.success && again.result.data.modelPicker).toEqual(MODEL_PICKER);
  });

  it.each([
    [
      'a preset naming an effort its model lacks',
      { presets: { pro: { mode: 'chat', model: 'm1', effort: 'max' } } },
      'modelPicker.presets.pro.effort',
    ],
    [
      'a preset naming an unknown model',
      { presets: { pro: { mode: 'chat', model: 'm9' } } },
      'modelPicker.presets.pro.model',
    ],
    [
      'a status template without its label',
      { effortStatus: { en: 'Item {position}' } },
      'modelPicker.effortStatus.en',
    ],
    ['an unknown key', { menuSelector: '[role=menu]' }, 'modelPicker.menuSelector'],
  ])('drops a modelPicker section with %s, keeping the adapter', (_label, patch, path) => {
    const read = readSiteAdapterData({ ...VALID, modelPicker: { ...MODEL_PICKER, ...patch } });
    expect(read.result.success).toBe(true);
    expect(read.result.success && read.result.data.modelPicker).toBeUndefined();
    expect(read.sectionIssues.map((issue) => issue.path)).toContain(path);
  });

  describe('projects section', () => {
    const shipped = JSON.parse(
      readFileSync(join(__dirname, '../catalog/sites/chatgpt/site.json'), 'utf8'),
    ) as Record<string, unknown>;
    const PROJECTS = shipped.projects as Record<string, unknown>;
    const SIDEBAR = PROJECTS.sidebar as Record<string, unknown>;

    it('keeps the shipped ChatGPT projects data through a publish round trip', () => {
      const read = readSiteAdapterData({ ...VALID, projects: PROJECTS });
      expect(read.sectionIssues).toEqual([]);
      if (!read.result.success) throw new Error('fixture must validate');
      expect(read.result.data.projects).toEqual(PROJECTS);
      const again = readSiteAdapterData(
        JSON.parse(JSON.stringify(siteAdapterToData(read.result.data))),
      );
      expect(again.result.success && again.result.data.projects).toEqual(PROJECTS);
    });

    it.each([
      [
        'a route pattern without its id group',
        { projectPagePattern: '^/g/g-p-[0-9a-f]{32}/project$' },
        'projects.projectPagePattern',
      ],
      [
        'a title template without {name}',
        { titleTemplates: ['ChatGPT'] },
        'projects.titleTemplates[0]',
      ],
      [
        'a selector that does not parse',
        { sidebar: { ...SIDEBAR, row: 'li >> a' } },
        'projects.sidebar.row',
      ],
      [
        'an attribute name that is not one',
        { sidebar: { ...SIDEBAR, idAttribute: 'data id' } },
        'projects.sidebar.idAttribute',
      ],
      ['an unknown key', { workButton: 'button' }, 'projects.workButton'],
    ])('drops a projects section with %s, keeping the adapter', (_label, patch, path) => {
      const read = readSiteAdapterData({ ...VALID, projects: { ...PROJECTS, ...patch } });
      expect(read.result.success).toBe(true);
      expect(read.result.success && read.result.data.projects).toBeUndefined();
      expect(read.sectionIssues.map((issue) => issue.path)).toContain(path);
    });

    it('treats changed projects data as a different adapter, so plugins pick it up', () => {
      const before = validateSiteAdapterData({ ...VALID, projects: PROJECTS });
      const after = validateSiteAdapterData({
        ...VALID,
        projects: { ...PROJECTS, sourcesQuery: 'view=files' },
      });
      if (!before.success || !after.success) throw new Error('fixtures must validate');
      expect(isSameSiteAdapter(before.data, after.data)).toBe(false);
    });
  });

  describe('pageHooks section', () => {
    const shipped = JSON.parse(
      readFileSync(join(__dirname, '../catalog/sites/chatgpt/site.json'), 'utf8'),
    ) as Record<string, unknown>;
    const HOOKS = shipped.pageHooks as Record<string, unknown>;
    const SWITCH = HOOKS.modeSwitch as Record<string, unknown>;

    it('keeps the shipped ChatGPT page hooks through a publish round trip', () => {
      const read = readSiteAdapterData({ ...VALID, pageHooks: HOOKS });
      expect(read.sectionIssues).toEqual([]);
      if (!read.result.success) throw new Error('fixture must validate');
      expect(read.result.data.pageHooks).toEqual(HOOKS);
      const again = readSiteAdapterData(
        JSON.parse(JSON.stringify(siteAdapterToData(read.result.data))),
      );
      expect(again.result.success && again.result.data.pageHooks).toEqual(HOOKS);
    });

    it.each([
      ['an unknown format', { format: 2 }, 'pageHooks.format'],
      ['an unknown key', { home: {} }, 'pageHooks.home'],
      [
        'a selector that does not parse',
        { modelPickerTrigger: 'button >> x' },
        'pageHooks.modelPickerTrigger',
      ],
      [
        'a switch order that is not chat and work',
        { modeSwitch: { ...SWITCH, order: ['chat', 'chat'] } },
        'pageHooks.modeSwitch.order',
      ],
      ['a pattern that could backtrack', { replyFailed: ['(a+)+$'] }, 'pageHooks.replyFailed[0]'],
    ])('drops a pageHooks section with %s, keeping the adapter', (_label, patch, path) => {
      const read = readSiteAdapterData({ ...VALID, pageHooks: { ...HOOKS, ...patch } });
      expect(read.result.success).toBe(true);
      expect(read.result.success && read.result.data.pageHooks).toBeUndefined();
      expect(read.sectionIssues.map((issue) => issue.path)).toContain(path);
    });

    it('treats changed page hooks as a different adapter, so plugins pick them up', () => {
      const before = validateSiteAdapterData({ ...VALID, pageHooks: HOOKS });
      const after = validateSiteAdapterData({
        ...VALID,
        pageHooks: { ...HOOKS, modelPickerTrigger: 'button[data-picker]' },
      });
      if (!before.success || !after.success) throw new Error('fixtures must validate');
      expect(isSameSiteAdapter(before.data, after.data)).toBe(false);
    });
  });

  it('does not treat a bridge policy change as a different adapter, so plugins stay mounted', () => {
    const before = validateSiteAdapterData({ ...VALID, bridge: BRIDGE });
    const after = validateSiteAdapterData({ ...VALID, bridge: { format: 1, allow: [] } });
    if (!before.success || !after.success) throw new Error('fixtures must validate');
    expect(isSameSiteAdapter(before.data, after.data)).toBe(true);
  });
});
