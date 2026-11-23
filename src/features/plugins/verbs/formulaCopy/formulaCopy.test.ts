import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateFormulaCopy } from '@/features/formulaCopy';

import { PluginScope } from '../../runtime/pluginScope';
import type { PrimitiveContext } from '../types';
import { formulaCopyPrimitive } from './index';

const setPreferences = vi.fn();

vi.mock('@/features/formulaCopy', () => ({
  activateFormulaCopy: vi.fn((scope: PluginScope) => {
    scope.effect(() => () => {}, 'formula-copy');
    return { setPreferences };
  }),
}));

function context(doc: Document): PrimitiveContext & { counters: Array<() => number> } {
  const counters: Array<() => number> = [];
  return {
    doc,
    adapter: null,
    pluginId: 'test.formula',
    settings: {},
    counters,
    setTargetCounter: (count) => counters.push(count),
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.mocked(activateFormulaCopy).mockClear();
  setPreferences.mockClear();
});

describe('formulaCopy primitive', () => {
  it('accepts only an empty params object', () => {
    expect(formulaCopyPrimitive.validateParams(undefined)).toEqual({ success: true, data: {} });
    expect(formulaCopyPrimitive.validateParams({})).toEqual({ success: true, data: {} });
    expect(formulaCopyPrimitive.validateParams({ scope: '.x' }).success).toBe(false);
    expect(formulaCopyPrimitive.validateParams('nope').success).toBe(false);
  });

  it('activates the shared formula-copy feature under the plugin scope and counts formula targets', () => {
    document.body.innerHTML =
      '<div class="katex">a</div><span data-math="x"></span><p>no formula</p>';
    const scope = new PluginScope();
    const ctx = context(document);

    formulaCopyPrimitive.activate(scope, {}, ctx);

    // Declaring no formula settings leaves the service on the shared storage keys.
    expect(activateFormulaCopy).toHaveBeenCalledWith(scope, null);
    expect(ctx.counters).toHaveLength(1);
    expect(ctx.counters[0]()).toBe(2);
    expect(scope.getEffects()).toContain('formula-copy');
  });

  it('hands the declared format and selection setting to the service, and later ones in place', () => {
    const scope = new PluginScope();
    const ctx = { ...context(document), settings: { format: 'notion', selectionLatex: false } };

    const handle = formulaCopyPrimitive.activate(scope, {}, ctx);

    expect(activateFormulaCopy).toHaveBeenCalledWith(scope, {
      format: 'notion',
      selectionLatex: false,
    });
    expect(handle).toHaveProperty('updateSettings');
    (handle as { updateSettings(settings: object): void }).updateSettings({
      format: 'unicodemath',
      selectionLatex: true,
    });
    expect(setPreferences).toHaveBeenCalledExactlyOnceWith({
      format: 'unicodemath',
      selectionLatex: true,
    });
    expect(activateFormulaCopy).toHaveBeenCalledTimes(1);
  });
});
