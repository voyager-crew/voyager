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

  it.each([
    "'user-' + 'query'",
    '"user-" + `${kind}`',
    '("user-" as const) + "query"',
    '`${"user-" as string}query`',
    "('user-' + 'query') + ' > .query-text'",
    '`user-${kind}`',
    '`user-${kind} > .query-text`',
    "'user-query > .query-text'",
    "'user-query, model-response'",
    "'div.user-query-container'",
    "'section.user-query-container'",
    "':is(user-query, model-response) > .new-content'",
    "'.markdown-main-panel > p'",
    "'/*native*/user-query > .query-text'",
    "'/*native*/user-query'",
  ])('rejects a published locator hidden inside %s', (literal) => {
    const failures = inspectLocatorSource(consumer, `const copied = ${literal};`);
    expect(failures).toEqual([expect.objectContaining({ line: 1 })]);
    expect(failures[0].reason).toContain('bypasses contract');
  });

  it('keeps quoted attribute text intact while finding a real compound token', () => {
    expect(
      inspectLocatorSource(consumer, 'const source = "[data-label=\\\"user-query > main\\\"]";'),
    ).toEqual([]);
    expect(
      inspectLocatorSource(
        consumer,
        'const source = "div.user-query-container[data-label=\\\"a > b\\\"]";',
      ),
    ).toHaveLength(1);
  });

  it('rejects a commented spelling that still selects the original native turn', () => {
    const turn = document.createElement('user-query');
    document.body.appendChild(turn);
    try {
      expect(document.querySelector('/*native*/user-query')).toBe(turn);
      expect(inspectLocatorSource(consumer, 'query("/*native*/user-query")')).toHaveLength(1);
    } finally {
      turn.remove();
    }
  });

  it('checks shipped modules in a directory named tests', () => {
    expect(
      inspectLocatorSource('src/features/tests/native.ts', 'query("user-query")'),
    ).toHaveLength(1);
    expect(
      inspectLocatorSource('src/features/__tests__/fixture.ts', 'query("user-query")'),
    ).toEqual([]);
    expect(inspectLocatorSource('src/features/native.spec.ts', 'query("user-query")')).toEqual([]);
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

  it('rejects another use exported from a file with one reviewed native proof', () => {
    const failures = inspectLocatorSource(
      'src/core/gemini/code/hosts.ts',
      'code.closest("code-block");\nexport const bypass = "code-block";',
    );
    expect(failures.map(({ line }) => line)).toEqual([1, 2]);
    expect(failures[1].reason).toContain('occurrence count changed');
  });

  it('rejects another site fragment through relative imports, aliases, re-exports and dynamic imports', () => {
    const file = 'src/features/plugins/catalog/sites/claude/native.ts';
    for (const statement of [
      'import data from "../gemini/selector-data/turn.json";',
      'import data from "@/features/plugins/catalog/sites/claude/../gemini/selector-data/turn.json";',
      'import data from "@pages/../features/plugins/catalog/sites/gemini/selector-data/turn.json";',
      'export { default } from "@/features/plugins/catalog/sites/gemini/selector-data/turn.json";',
      'const data = import("@src/features/plugins/catalog/sites/gemini/selector-data/turn.json");',
      'const data = require("../gemini/selector-data/turn.json");',
      'import data = require("../gemini/selector-data/turn.json");',
    ]) {
      const failures = inspectLocatorSource(file, statement);
      expect(failures).toEqual([expect.objectContaining({ file, line: 1 })]);
      expect(failures[0].reason).toContain('selector-data import');
    }
  });

  it.each([
    'export { default as turns } from "@/features/plugins/catalog/sites/gemini/selector-data/turn.json";',
    'import turns from "@/features/plugins/catalog/sites/gemini/selector-data/turn.json"; export { turns };',
    'import turns from "@/features/plugins/catalog/sites/gemini/selector-data/turn.json"; export const forwarded = turns;',
    'import turns from "@/features/plugins/catalog/sites/gemini/selector-data/turn.json"; const alias = turns; export { alias };',
    'import turns from "@/features/plugins/catalog/sites/gemini/selector-data/turn.json"; export default { turns };',
    'import turns from "@/features/plugins/catalog/sites/gemini/selector-data/turn.json"; export const forwarded = turns["turn.user"];',
  ])('rejects foreign data laundered through a barrel: %s', (barrel) => {
    const modules = new Map([
      ['src/core/gemini/data.ts', barrel],
      ['src/core/gemini/index.ts', 'export * from "./data"; export { default } from "./data";'],
    ]);
    const failures = inspectLocatorSource(
      'src/features/plugins/catalog/sites/claude/native.ts',
      'import * as data from "@/core/gemini";',
      publishedLocatorValues(),
      (path) => modules.get(path),
    );
    expect(failures).toEqual([expect.objectContaining({ line: 1 })]);
    expect(failures[0].reason).toContain('including re-exports');
  });

  it('allows an imported guarded reader without exposing its data imports', () => {
    const modules = new Map([
      [
        'src/core/gemini/reader.ts',
        'import data from "@/features/plugins/catalog/sites/gemini/selector-data/turn.json"; export function read() { return prove(data); }',
      ],
    ]);
    expect(
      inspectLocatorSource(
        consumer,
        'import { read } from "@/core/gemini/reader";',
        publishedLocatorValues(),
        (path) => modules.get(path),
      ),
    ).toEqual([]);
  });

  it('does not confuse a local default reader with an ignored star re-export default', () => {
    const modules = new Map([
      [
        'src/core/gemini/data.ts',
        'export { default } from "@/features/plugins/catalog/sites/gemini/selector-data/turn.json";',
      ],
      [
        'src/core/gemini/index.ts',
        'export * from "./data"; export default function read() { return 1; }',
      ],
    ]);
    expect(
      inspectLocatorSource(
        consumer,
        'import read from "@/core/gemini";',
        publishedLocatorValues(),
        (path) => modules.get(path),
      ),
    ).toEqual([]);
    expect(
      inspectLocatorSource(
        consumer,
        'import * as readers from "@/core/gemini";',
        publishedLocatorValues(),
        (path) => modules.get(path),
      ),
    ).toEqual([]);
  });

  it('follows a selected namespace export without treating another data export as that reader', () => {
    const modules = new Map([
      [
        'src/core/gemini/data.ts',
        'export { default as data } from "@/features/plugins/catalog/sites/gemini/selector-data/turn.json"; export function read() { return 1; }',
      ],
      ['src/core/gemini/index.ts', 'import * as ns from "./data"; export const read = ns.read;'],
    ]);
    expect(
      inspectLocatorSource(
        consumer,
        'import { read } from "@/core/gemini";',
        publishedLocatorValues(),
        (path) => modules.get(path),
      ),
    ).toEqual([]);
  });

  it('preserves selected reader identity through a local namespace alias', () => {
    const modules = new Map([
      [
        'src/core/gemini/data.ts',
        'export { default as data } from "@/features/plugins/catalog/sites/gemini/selector-data/turn.json"; export function read() { return 1; }',
      ],
      [
        'src/core/gemini/index.ts',
        'import * as ns from "./data"; const alias = ns; export const read = alias.read;',
      ],
    ]);
    expect(
      inspectLocatorSource(
        consumer,
        'import { read } from "@/core/gemini";',
        publishedLocatorValues(),
        (path) => modules.get(path),
      ),
    ).toEqual([]);
  });

  it('finds foreign source data behind emitted JavaScript paths and destructured exports', () => {
    const modules = new Map([
      [
        'src/core/gemini/data.ts',
        'import turns from "@/features/plugins/catalog/sites/gemini/selector-data/turn.json"; export const { ["turn.user"]: users } = turns;',
      ],
    ]);
    const failures = inspectLocatorSource(
      consumer,
      'import { users } from "@/core/gemini/data.js";',
      publishedLocatorValues(),
      (path) => modules.get(path),
    );
    expect(failures).toEqual([expect.objectContaining({ line: 1 })]);
    expect(failures[0].reason).toContain('including re-exports');
  });

  it.each([
    'import(`../gemini/selector-data/${name}.json`)',
    'import(("../gemini/selector-data/turn.json" as string))',
    'import((`../gemini/selector-data/${name}.json`))',
    'import(`../gemini/${"selector-data"}/${name}.json`)',
    'import("../gemini/selector-data/" + name + ".json")',
    'import(`../${site}/selector-data/${name}.json`)',
    'import.meta.glob("../gemini/selector-data/*.json")',
    'import.meta.glob(("../gemini/selector-data/*.json"))',
    'import.meta.glob("../gemini/**/*.json")',
    'import.meta.glob("../gemini/**/composer.json")',
    'import.meta.glob("@/features/plugins/catalog/sites/**/*.json")',
    'import.meta.glob(["../gemini/selector-data/*.json", "./*.ts"])',
    'import.meta.glob(`../${site}/selector-data/*.json`)',
  ])('rejects a dynamic or glob fragment outside its loader: %s', (statement) => {
    const failures = inspectLocatorSource(
      'src/features/plugins/catalog/sites/claude/native.ts',
      `const data = ${statement};`,
    );
    expect(failures).toEqual([expect.objectContaining({ line: 1 })]);
    expect(failures[0].reason).toContain('outside its per-site loader');
  });

  it('limits variable fragment names to a statically owned per-site loader', () => {
    const statement =
      'const data = import(`@/features/plugins/catalog/sites/gemini/selector-data/${name}.json`)';
    expect(inspectLocatorSource('src/core/gemini/content/consumer.ts', statement)).toHaveLength(1);
    expect(inspectLocatorSource('src/core/gemini/selectors/bundle.ts', statement)).toEqual([]);
    expect(
      inspectLocatorSource(
        'src/core/gemini/selectors/bundle.ts',
        'import(`@/features/plugins/catalog/sites/${"gemini"}/selector-data/${name}.json`)',
      ),
    ).toEqual([]);
    expect(
      inspectLocatorSource(
        'src/core/gemini/content/consumer.ts',
        'import("@/features/plugins/catalog/sites/gemini/selector-data/turn.json")',
      ),
    ).toHaveLength(1);
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

  it('does not extend a shared loader exception to a different barrel or export', () => {
    const file = 'src/core/gemini/selectors/bundle.ts';
    const modules = new Map([
      [
        'src/core/selectors/contracts/placement.ts',
        'export { default as PLACEMENT_PROFILES, default as unrelated } from "@/features/plugins/catalog/sites/claude/selector-data/input.json";',
      ],
      [
        'src/core/selectors/other.ts',
        'export { default as PLACEMENT_PROFILES } from "@/features/plugins/catalog/sites/claude/selector-data/input.json";',
      ],
    ]);
    const read = (path: string) => modules.get(path);
    expect(
      inspectLocatorSource(
        file,
        'import { PLACEMENT_PROFILES } from "../../selectors/contracts/placement";',
        publishedLocatorValues(),
        read,
      ),
    ).toEqual([]);
    expect(
      inspectLocatorSource(
        file,
        'import { unrelated } from "../../selectors/contracts/placement";',
        publishedLocatorValues(),
        read,
      ),
    ).toHaveLength(1);
    expect(
      inspectLocatorSource(
        file,
        'import { PLACEMENT_PROFILES } from "../../selectors/other";',
        publishedLocatorValues(),
        read,
      ),
    ).toHaveLength(1);
  });
});
