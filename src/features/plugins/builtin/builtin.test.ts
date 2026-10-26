import { describe, expect, it } from 'vitest';

import { NATIVE_HANDLER_BINDINGS } from '@/pages/content/pluginNativeRegistration';

import { checkPrimitivesAreShippable } from '../../../../scripts/lib/pluginChecks';
import { validateManifest } from '../manifest/validate';
import { legacyValueBindingsFor } from '../storage/legacyValueBindings';
import { BUILTIN_PLUGINS, NATIVE_BUILTIN_PLUGIN_IDS } from './index';

describe('BUILTIN_PLUGINS', () => {
  it('every builtin manifest passes validation', () => {
    for (const m of BUILTIN_PLUGINS) {
      expect(validateManifest(m).success).toBe(true);
    }
  });

  it('every builtin engine floor covers the primitives and params it uses', () => {
    for (const m of BUILTIN_PLUGINS) {
      expect(checkPrimitivesAreShippable(m, `builtin ${m.id}`)).toEqual([]);
    }
  });

  it('includes the formula-copy native function plugin scoped to Claude/ChatGPT', () => {
    const fc = BUILTIN_PLUGINS.find((m) => m.id === 'voyager.formula-copy');
    expect(fc).toBeDefined();
    expect(fc?.matches).toEqual([
      'https://claude.ai/*',
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
    ]);
    // Its behaviour is the formulaCopy primitive, invoked through a native op.
    expect(fc?.contributes.styles ?? []).toEqual([]);
    expect(fc?.contributes.domOps).toEqual([{ op: 'native', handler: 'formulaCopy', params: {} }]);
    expect(fc?.requires).toEqual({ handlers: ['formulaCopy'] });
    expect(fc?.i18n?.zh?.name).toBe('公式复制');
    expect(fc?.i18n?.ja?.description).toContain('LaTeX');
  });

  it('includes the input Vim native function plugin scoped to Claude/ChatGPT', () => {
    const vim = BUILTIN_PLUGINS.find((m) => m.id === 'voyager.input-vim');
    expect(vim).toBeDefined();
    expect(vim?.matches).toEqual([
      'https://claude.ai/*',
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
    ]);
    expect(vim?.contributes.styles ?? []).toEqual([]);
    expect(vim?.contributes.domOps).toEqual([{ op: 'native', handler: 'vimInput', params: {} }]);
    expect(vim?.requires).toEqual({ handlers: ['vimInput'], semantic: ['composer'] });
    expect(vim?.i18n?.zh?.name).toBe('Vim 输入');
  });

  it('includes the ChatGPT export plugin scoped to ChatGPT', () => {
    const exportPlugin = BUILTIN_PLUGINS.find((m) => m.id === 'voyager.chatgpt-export');
    expect(exportPlugin).toBeDefined();
    expect(exportPlugin?.matches).toEqual(['https://chatgpt.com/*', 'https://chat.openai.com/*']);
    expect(exportPlugin?.contributes.styles ?? []).toEqual([]);
    // Its behaviour is the conversationExport primitive, invoked through a native op.
    expect(exportPlugin?.contributes.domOps).toEqual([
      { op: 'native', handler: 'conversationExport', params: {} },
    ]);
    expect(exportPlugin?.requires?.formFactors).toEqual(['desktop', 'mobile']);
    expect(exportPlugin?.i18n?.zh?.name).toBe('ChatGPT · 对话导出');
  });

  it('keeps temporary-chat handoff separate from conversation export', () => {
    const handoff = BUILTIN_PLUGINS.find(
      (plugin) => plugin.id === 'voyager.chatgpt-temporary-handoff',
    );
    expect(handoff).toBeDefined();
    expect(handoff?.matches).toEqual(['https://chatgpt.com/*', 'https://chat.openai.com/*']);
    expect(handoff?.contributes.styles ?? []).toEqual([]);
    expect(handoff?.contributes.domOps ?? []).toEqual([]);
    expect(handoff?.i18n?.zh?.name).toBe('ChatGPT · 临时对话反悔');
    expect(handoff?.i18n?.zh_TW?.name).toBe('ChatGPT · 暫時對話反悔');
    expect(handoff?.id).not.toBe('voyager.chatgpt-export');
  });

  it('includes the Claude timeline native function plugin', () => {
    const timeline = BUILTIN_PLUGINS.find((m) => m.id === 'voyager.claude-timeline');
    expect(timeline).toBeDefined();
    expect(timeline?.matches).toEqual(['https://claude.ai/*']);
    expect(timeline?.contributes.styles ?? []).toEqual([]);
    // Its behaviour is the turnNavigator primitive; Claude keeps the guide
    // closed while an artifact frame is open, and names each thread's conversation.
    expect(timeline?.contributes.domOps).toEqual([
      {
        op: 'native',
        handler: 'turnNavigator',
        params: {
          conversationIdAttribute: 'data-conv-id',
        },
      },
    ]);
    expect(timeline?.engine).toBe('>=1.6.0');
    expect(timeline?.requires).toEqual({
      handlers: ['turnNavigator'],
      semantic: ['userTurn'],
      formFactors: ['desktop', 'mobile'],
    });
    expect(timeline?.contributes.settings?.timelineStyle).toEqual({
      type: 'select',
      label: 'Timeline style',
      default: 'dots',
      options: [
        { value: 'dots', label: 'Nodes' },
        { value: 'compact', label: 'Compact' },
        { value: 'ruler', label: 'Ruler' },
      ],
    });
    expect(timeline?.i18n?.zh?.name).toBe('Claude · 时间线');
    expect(timeline?.i18n?.zh?.settings?.timelineStyle?.label).toBe('时间线样式');
  });

  it("includes the ChatGPT timeline, which needs the engine that reads a turn's item", () => {
    const timeline = BUILTIN_PLUGINS.find((m) => m.id === 'voyager.chatgpt-timeline');
    expect(timeline).toBeDefined();
    expect(timeline?.matches).toEqual(['https://chatgpt.com/*', 'https://chat.openai.com/*']);
    expect(timeline?.engine).toBe('>=1.6.0');
    expect(timeline?.contributes.domOps).toMatchObject([
      {
        op: 'native',
        handler: 'turnNavigator',
        params: {
          turnItem: '[data-turn-key]',
          conversationIdAttribute: 'data-chatgpt-selection-conversation-id',
        },
      },
    ]);
    expect(timeline?.requires).toEqual({
      handlers: ['turnNavigator'],
      semantic: ['userTurn'],
      formFactors: ['desktop', 'mobile'],
    });
    expect(timeline?.contributes.settings?.timelineStyle?.default).toBe('dots');
    const locales = ['zh', 'zh_TW', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'ar'] as const;
    for (const locale of locales) {
      expect(timeline?.i18n?.[locale]?.name, locale).toContain('ChatGPT');
      expect(timeline?.i18n?.[locale]?.description, locale).toContain('ChatGPT');
      expect(timeline?.i18n?.[locale]?.settings?.timelineStyle?.label, locale).toBeTruthy();
    }
  });

  it('scopes the Gemini chat width builtin to gemini.google.com and binds it to its handler', () => {
    const width = BUILTIN_PLUGINS.find((m) => m.id === 'voyager.gemini-chat-width');
    // Not Gemini Enterprise or a custom host: the native module never ran there.
    expect(width?.matches).toEqual(['https://gemini.google.com/*']);
    expect(width?.contributes.domOps).toBeUndefined();
    expect(width?.contributes.settings?.widthPercent).toMatchObject({
      type: 'number',
      default: 70,
      min: 30,
      max: 100,
    });
    for (const locale of ['zh', 'zh_TW', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'ar'] as const) {
      expect(width?.i18n?.[locale]?.settings?.widthPercent?.label, locale).toBeTruthy();
    }
    expect(NATIVE_BUILTIN_PLUGIN_IDS).toContain('voyager.gemini-chat-width');
    expect(NATIVE_HANDLER_BINDINGS['voyager.gemini-chat-width']?.updateSettings).toBeTypeOf(
      'function',
    );
  });

  it('scopes the Gemini edit input width builtin to gemini.google.com and binds it to its handler', () => {
    const width = BUILTIN_PLUGINS.find((m) => m.id === 'voyager.gemini-edit-input-width');
    // Not Gemini Enterprise or a custom host: the native module never ran there.
    expect(width?.matches).toEqual(['https://gemini.google.com/*']);
    expect(width?.contributes.domOps).toBeUndefined();
    expect(width?.contributes.settings?.widthPercent).toMatchObject({
      type: 'number',
      default: 60,
      min: 30,
      max: 100,
    });
    for (const locale of ['zh', 'zh_TW', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'ar'] as const) {
      expect(width?.i18n?.[locale]?.name, locale).toBeTruthy();
      expect(width?.i18n?.[locale]?.description, locale).not.toBe(width?.description);
      expect(width?.i18n?.[locale]?.settings?.widthPercent?.label, locale).toBeTruthy();
    }
    expect(NATIVE_BUILTIN_PLUGIN_IDS).toContain('voyager.gemini-edit-input-width');
    expect(NATIVE_HANDLER_BINDINGS['voyager.gemini-edit-input-width']?.updateSettings).toBeTypeOf(
      'function',
    );
  });

  it('ships recent Gems with the existing count range and all localized setting labels', () => {
    const id = 'voyager.gemini-gems-sidebar';
    const manifest = BUILTIN_PLUGINS.find((m) => m.id === id);
    expect(manifest?.matches).toEqual(['https://gemini.google.com/*']);
    expect(manifest?.contributes.domOps).toBeUndefined();
    expect(manifest?.contributes.settings?.count).toMatchObject({
      type: 'number',
      default: 3,
      min: 0,
      max: 10,
    });
    expect(NATIVE_BUILTIN_PLUGIN_IDS).toContain(id);
    expect(NATIVE_HANDLER_BINDINGS[id]?.updateSettings).toBeTypeOf('function');
    expect(legacyValueBindingsFor(id).map((entry) => entry.settingKey)).toEqual(['count']);
    for (const locale of ['zh', 'zh_TW', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'ar'] as const) {
      expect(manifest?.i18n?.[locale]?.name, locale).toBeTruthy();
      expect(manifest?.i18n?.[locale]?.description, locale).toBeTruthy();
      expect(manifest?.i18n?.[locale]?.settings?.count?.label, locale).toBeTruthy();
    }
  });

  it('ships sidebar width for Gemini with localized settings', () => {
    const id = 'voyager.gemini-sidebar-width';
    const width = BUILTIN_PLUGINS.find((m) => m.id === id);
    expect(width?.matches).toEqual(['https://gemini.google.com/*']);
    expect(NATIVE_BUILTIN_PLUGIN_IDS).toContain(id);
    for (const locale of ['zh', 'zh_TW', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'ar'] as const) {
      expect(width?.i18n?.[locale]?.settings?.widthPx?.label, locale).toBeTruthy();
      expect(width?.i18n?.[locale]?.description, locale).toBeTruthy();
    }
  });

  it('ships AI Studio sidebar width on both hosts with a fixed native binding and localized settings', () => {
    const id = 'voyager.aistudio-sidebar-width';
    const width = BUILTIN_PLUGINS.find((manifest) => manifest.id === id);
    expect(width?.matches).toEqual([
      'https://aistudio.google.com/*',
      'https://aistudio.google.cn/*',
    ]);
    expect(width?.contributes.domOps).toBeUndefined();
    expect(width?.contributes.settings?.widthPx).toMatchObject({
      type: 'number',
      default: 280,
      min: 240,
      max: 600,
    });
    expect(NATIVE_BUILTIN_PLUGIN_IDS).toContain(id);
    expect(NATIVE_HANDLER_BINDINGS[id]?.activate).toBeTypeOf('function');
    expect(NATIVE_HANDLER_BINDINGS[id]?.updateSettings).toBeTypeOf('function');
    for (const locale of ['zh', 'zh_TW', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'ar'] as const) {
      expect(width?.i18n?.[locale]?.name, locale).toContain('AI Studio');
      expect(width?.i18n?.[locale]?.description, locale).not.toBe(width?.description);
      expect(width?.i18n?.[locale]?.settings?.widthPx?.label, locale).toBeTruthy();
    }
  });

  it('scopes the Gemini prompt history builtin to gemini.google.com with no settings of its own', () => {
    const history = BUILTIN_PLUGINS.find((m) => m.id === 'voyager.gemini-prompt-history');
    // Not Gemini Enterprise or a custom host: the native module never ran there.
    expect(history?.matches).toEqual(['https://gemini.google.com/*']);
    // Its switch is gvPromptHistoryEnabled; the manifest offers nothing to set.
    expect(history?.contributes).toEqual({});
    for (const locale of ['zh', 'zh_TW', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'ar'] as const) {
      expect(history?.i18n?.[locale]?.name, locale).toBeTruthy();
      expect(history?.i18n?.[locale]?.description, locale).toBeTruthy();
    }
    expect(NATIVE_HANDLER_BINDINGS['voyager.gemini-prompt-history']?.activate).toBeTypeOf(
      'function',
    );
  });

  it('scopes the Gemini input collapse builtin to gemini.google.com with the native sub-switch as its one setting', () => {
    const collapse = BUILTIN_PLUGINS.find((m) => m.id === 'voyager.gemini-input-collapse');
    expect(collapse?.matches).toEqual(['https://gemini.google.com/*']);
    expect(collapse?.contributes.settings?.collapseWhenNotEmpty).toMatchObject({
      type: 'boolean',
      default: false,
      messageKeys: { label: 'allowCollapseWhenNotEmpty', hint: 'allowCollapseWhenNotEmptyHint' },
    });
    // The host fills exactly the declared setting from gvInputCollapseWhenNotEmpty, default included.
    const bindings = legacyValueBindingsFor('voyager.gemini-input-collapse');
    expect(bindings.map((entry) => entry.settingKey)).toEqual(['collapseWhenNotEmpty']);
    expect(bindings[0].read(undefined)).toBe(false);
    for (const locale of ['zh', 'zh_TW', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'ar'] as const) {
      expect(collapse?.i18n?.[locale]?.name, locale).toBeTruthy();
      expect(collapse?.i18n?.[locale]?.description, locale).toBeTruthy();
      expect(collapse?.i18n?.[locale]?.settings?.collapseWhenNotEmpty?.label, locale).toBeTruthy();
    }
    const handler = NATIVE_HANDLER_BINDINGS['voyager.gemini-input-collapse'];
    expect(handler?.activate).toBeTypeOf('function');
    expect(handler?.updateSettings).toBeTypeOf('function');
  });

  it.each([
    ['Markdown rendering fix', 'voyager.gemini-markdown-fix'],
    ['Message timestamps', 'voyager.gemini-message-timestamps'],
    ['conversation export', 'voyager.gemini-export'],
    ['canvas copy', 'voyager.gemini-canvas-copy'],
    ['Deep Research export', 'voyager.gemini-deep-research-export'],
    ['context sync', 'voyager.gemini-context-sync'],
    ['auto-hide sidebar', 'voyager.gemini-sidebar-auto-hide'],
    ['fully hide sidebar', 'voyager.gemini-sidebar-full-hide'],
    ['research pack', 'voyager.gemini-research-pack'],
    ['default model', 'voyager.gemini-default-model'],
    ['fork', 'voyager.gemini-fork'],
    ['usage status', 'voyager.gemini-usage-status'],
    ['quote reply', 'voyager.gemini-quote-reply'],
    ['highlight', 'voyager.gemini-highlight'],
    ['prevent auto-scroll', 'voyager.gemini-prevent-auto-scroll'],
    ['response notification', 'voyager.gemini-response-notification'],
    ['timeline', 'voyager.gemini-timeline'],
  ])('gives the %s manifest a name and description in all ten locales', (_label, id) => {
    const manifest = BUILTIN_PLUGINS.find((m) => m.id === id);
    // Not Gemini Enterprise or a custom host: the native module never ran there.
    expect(manifest?.matches).toEqual(['https://gemini.google.com/*']);
    // Its switch is the native one; the manifest offers nothing to set.
    expect(manifest?.contributes).toEqual({});
    expect(manifest?.name).toBeTruthy();
    expect(manifest?.description).toBeTruthy();
    for (const locale of ['zh', 'zh_TW', 'ja', 'ko', 'fr', 'es', 'pt', 'ru', 'ar'] as const) {
      expect(manifest?.i18n?.[locale]?.name, locale).toBeTruthy();
      expect(manifest?.i18n?.[locale]?.description, locale).toBeTruthy();
      expect(manifest?.i18n?.[locale]?.description, locale).not.toBe(manifest?.description);
    }
    expect(NATIVE_BUILTIN_PLUGIN_IDS).toContain(id);
    expect(NATIVE_HANDLER_BINDINGS[id]?.activate).toBeTypeOf('function');
  });

  it('does not expose the retired Claude usage plugin', () => {
    const usage = BUILTIN_PLUGINS.find((m) => m.id === 'voyager.claude-usage');
    expect(usage).toBeUndefined();
  });
});
