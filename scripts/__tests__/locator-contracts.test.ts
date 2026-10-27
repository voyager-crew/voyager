import { describe, expect, it } from 'vitest';

import {
  inspectLocatorSource,
  inspectSiteLoaders,
  publishedLocatorValues,
} from '../check-locator-contracts';
import { foreignSiteValue } from '../lib/siteFragmentOwnership';

const consumer = 'src/pages/content/prompt/newConsumer.ts';

describe('published locator boundaries', () => {
  it('reports a copied locator at its original source line even with escaped quotes', () => {
    const failures = inspectLocatorSource(
      consumer,
      '// a comment is not executable\nconst copied = "[data-test-id=\\"conversation\\"]";',
    );
    expect(failures).toEqual([expect.objectContaining({ file: consumer, line: 2 })]);
    expect(failures[0].reason).toContain('bypasses contract');
  });

  it('finds template literals while ignoring comments and unrelated strings', () => {
    expect(inspectLocatorSource(consumer, '// "user-query"\nconst caption = "Saved";')).toEqual([]);
    expect(inspectLocatorSource(consumer, 'const copied = `user-query`;')).toHaveLength(1);
  });

  it('allows native HTML construction but still rejects a host query for the same tag', () => {
    const failures = inspectLocatorSource(
      consumer,
      'document.createElement("textarea");\ndocument.querySelector("textarea");',
    );
    expect(failures).toEqual([expect.objectContaining({ line: 2 })]);
  });

  it('does not let a helper named el disguise a copied host locator', () => {
    expect(
      inspectLocatorSource(
        consumer,
        'const el = document.querySelector.bind(document); el("user-query");',
      ),
    ).toHaveLength(1);
  });

  it('rejects foreign host dialects but retains exact reviewed baseline fallbacks', () => {
    expect(foreignSiteValue('claude', 'ms-prompt-input', [])).toBe('aistudio');
    expect(foreignSiteValue('chatgpt', 'user-query .renamed', [])).toBe('gemini');
    expect(foreignSiteValue('gemini', 'rich-textarea', [])).toBeNull();
    expect(foreignSiteValue('claude', 'rich-textarea', ['rich-textarea'])).toBeNull();
  });

  it('keeps a reviewed native proof local to its owner file', () => {
    const source = 'code.closest("code-block")';
    expect(inspectLocatorSource('src/core/gemini/code/hosts.ts', source)).toEqual([]);
    expect(inspectLocatorSource(consumer, source)).toHaveLength(1);
  });

  it('rejects another site fragment through relative imports, aliases, re-exports and dynamic imports', () => {
    const file = 'src/features/plugins/catalog/sites/claude/native.ts';
    for (const statement of [
      'import data from "../gemini/selector-data/turn.json";',
      'export { default } from "@/features/plugins/catalog/sites/gemini/selector-data/turn.json";',
      'const data = import("@src/features/plugins/catalog/sites/gemini/selector-data/turn.json");',
      'const data = require("../gemini/selector-data/turn.json");',
      'import data = require("../gemini/selector-data/turn.json");',
    ]) {
      const failures = inspectLocatorSource(file, statement);
      expect(failures).toEqual([expect.objectContaining({ file, line: 1 })]);
      expect(failures[0].reason).toContain('cross-site selector-data import');
    }
  });

  it('allows site-owned modules and the explicit shared loaders', () => {
    const statement =
      'import claude from "@/features/plugins/catalog/sites/claude/selector-data/input.json";';
    expect(
      inspectLocatorSource('src/features/plugins/catalog/sites/claude/native.ts', statement),
    ).toEqual([]);
    expect(
      inspectLocatorSource('src/core/selectors/contracts/inputSurfaces.ts', statement),
    ).toEqual([]);
  });

  it('rejects a shared loader importing another site under the wrong binding', () => {
    const failures = inspectLocatorSource(
      'src/core/selectors/contracts/inputSurfaces.ts',
      'import chatgpt from "@/features/plugins/catalog/sites/claude/selector-data/input.json";',
    );
    expect(failures).toEqual([expect.objectContaining({ line: 1 })]);
    expect(failures[0].reason).toContain('cross-site selector-data import');
  });

  it('loads the complete published vocabulary from each own site fragment', () => {
    expect(publishedLocatorValues().get('user-query')).toContain('gemini:turn.userWithHosts');
    expect(inspectSiteLoaders()).toEqual([]);
  });
});
