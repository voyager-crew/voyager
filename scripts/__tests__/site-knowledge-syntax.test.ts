import { describe, expect, it } from 'vitest';

import { inspectSiteKnowledge } from '../lib/siteKnowledge';

function inspect(text: string, file = 'src/consumer.ts') {
  return inspectSiteKnowledge({
    siteIds: ['gemini', 'claude', 'chatgpt'],
    owners: { file: 'fixture/owners.ts', entries: [] },
    exceptions: [],
    sources: [{ file, text }],
  });
}

describe('site ids in TypeScript syntax', () => {
  it.each([
    'read("gemini");',
    'read(`gemini`);',
    'read("ge" + "mini");',
    'read(("ge" as const) + "mini");',
    'read((("ge" + "mi") satisfies string) + "ni");',
    'read("ge" + (`mi` + "ni"));',
    'read((<string>"ge") + "mini");',
  ])('reports one folded literal for %s', (text) => {
    const { occurrences, diagnostics } = inspect(text);
    expect(occurrences).toEqual([
      { file: 'src/consumer.ts', line: 1, site: 'gemini', form: 'literal' },
    ]);
    expect(diagnostics).toHaveLength(1);
  });

  it.each([
    'const x = { gemini: value };',
    'const x = { "gemini": value };',
    'const x = { ["gemini"]: value };',
    'const x = { ["ge" + "mini"]: value };',
    'const x = { [`gem${"ini"}`]: value };',
    'const x = { [(`ge${"mi" + "ni"}` as const)]: value };',
    'const x = { gemini };',
    'table.gemini;',
    'table?.gemini;',
    'table["gemini"];',
    'table[`gemini`];',
    'table["ge" + "mini"];',
    'table[`gem${"ini"}`];',
    'table[`ge${`mi${"ni"}`}`];',
    'const { gemini: alias } = table;',
    'const { "gemini": alias } = table;',
    'const { ["ge" + "mini"]: alias } = table;',
    'const { [`gem${"ini"}`]: alias } = table;',
    'const { gemini } = table;',
    'enum Sites { gemini }',
    'type Table = { gemini: string };',
    'class Table { gemini() {} }',
    'class Table { constructor(public gemini: string) {} }',
    'type Site = Tables.gemini;',
  ])('counts a property once as a key for %s', (text) => {
    const { occurrences, diagnostics } = inspect(text);
    expect(occurrences).toEqual([
      { file: 'src/consumer.ts', line: 1, site: 'gemini', form: 'key' },
    ]);
    expect(diagnostics[0].reason).toContain('"gemini" (key)');
  });

  it('keeps key and value occurrences separate, including destructuring defaults and enums', () => {
    const { occurrences } = inspect(
      'const {gemini = "claude"} = table; enum Sites {gemini = "gemini"}',
    );
    expect(occurrences.map(({ site, form }) => [site, form])).toEqual([
      ['gemini', 'key'],
      ['claude', 'literal'],
      ['gemini', 'key'],
      ['gemini', 'literal'],
    ]);
  });

  it('folds adjacent static operands on either side of dynamic concatenation', () => {
    expect(inspect('read(prefix + "ge" + "mini");').occurrences).toEqual([
      { file: 'src/consumer.ts', line: 1, site: 'gemini', form: 'literal' },
    ]);
    expect(inspect('read(prefix + "gemini" + "-parser");').occurrences).toEqual([]);
    expect(
      inspect('read("ge" + choose("claude") + "mini");').occurrences.map(({ site }) => site),
    ).toEqual(['claude']);
  });

  it('detects union literal types and the types inside folded wrappers and keys', () => {
    const { occurrences } = inspect(
      'type Site = "gemini" | "claude"; read("gemini" as "gemini"); table["gemini" as "gemini"];',
    );
    expect(occurrences.map(({ site, form }) => [site, form])).toEqual([
      ['gemini', 'literal'],
      ['claude', 'literal'],
      ['gemini', 'literal'],
      ['gemini', 'literal'],
      ['gemini', 'key'],
      ['gemini', 'literal'],
    ]);
  });

  it('finds each template static part and traverses interpolated expressions', () => {
    const { occurrences } = inspect('read(`gemini${choose("chatgpt")}claude`);');
    expect(occurrences.map(({ site, form }) => [site, form])).toEqual([
      ['gemini', 'literal'],
      ['chatgpt', 'literal'],
      ['claude', 'literal'],
    ]);
    expect(inspect('read(`${flag ? "gemini" : table.claude}`);').diagnostics).toHaveLength(2);
    expect(inspect('read(`gem${"ini"}`);').occurrences).toEqual([]);
    expect(inspect('read(`${"gemini"}claude`);').occurrences.map(({ site }) => site)).toEqual([
      'gemini',
      'claude',
    ]);
  });

  it('does not count a folded template key twice or hide its literal types', () => {
    const result = inspect('table[`${"gemini" as "gemini"}`]; table[`gem${part}`];');
    expect(result.occurrences.map(({ form }) => form)).toEqual(['key', 'literal']);
    expect(inspect('table[`gemini${part}`];').occurrences.map(({ form }) => form)).toEqual([
      'literal',
    ]);
  });

  it('continues scanning keys and expressions inside dynamic computed names', () => {
    expect(
      inspect('table[choose("gemini")]; const x = { [table.claude]: value };').occurrences.map(
        ({ form }) => form,
      ),
    ).toEqual(['literal', 'key']);
  });

  it('checks JSX prop names while leaving ordinary parameter names alone', () => {
    const result = inspect(
      'function render(gemini: string) { return <Widget gemini />; }',
      'src/component.tsx',
    );
    expect(result.occurrences).toEqual([
      { file: 'src/component.tsx', line: 1, site: 'gemini', form: 'key' },
    ]);
  });

  it('finds static parts and literal unions in template literal types', () => {
    const result = inspect('type Route<T extends string> = `gemini${T | "chatgpt"}claude`;');
    expect(result.occurrences.map(({ site }) => site)).toEqual(['gemini', 'chatgpt', 'claude']);
  });

  it('ignores comments, identifiers, substrings, and statically joined longer strings', () => {
    expect(
      inspect(
        [
          '// "gemini" and table.claude',
          '/* {chatgpt: "gemini"} */',
          'const geminiParser = "geminiParser";',
          'const gemini = "gemini-voyager.folders.v1"; read(gemini);',
          'read("gemini:conv:123"); read("gemini" + "-suffix");',
          'table.geminiParser; const {other: claude} = table;',
          'const { ...gemini } = table; function rest({ ...claude }) {}',
          'function chatgpt(gemini: string) { return gemini; }',
        ].join('\n'),
      ).occurrences,
    ).toEqual([]);
  });

  it('ignores module specifiers without hiding the rest of the file', () => {
    const result = inspect(
      [
        'import "gemini";',
        'import x from "claude";',
        'export * from "gemini";',
        'export { x } from "claude";',
        'import data = require("gemini");',
        'const dynamic = import("chat" + "gpt");',
        'const common = require("gemini");',
        'type External = import("claude").External;',
        'read("gemini");',
      ].join('\n'),
    );
    expect(result.occurrences).toEqual([
      { file: 'src/consumer.ts', line: 9, site: 'gemini', form: 'literal' },
    ]);
  });

  it('still checks runtime expressions and type annotations within dynamic module paths', () => {
    const result = inspect(
      [
        'import(resolveForSite("gemini"));',
        'require(resolveForSite("claude"));',
        'import(`prefix/${resolveForSite("chatgpt")}`);',
        'import("other" as "gemini");',
        'import(flag ? "gemini" : "claude");',
        'import(path ?? "gemini");',
        'import(path || "claude");',
        'import(resolveForSite("gemini") ?? "claude");',
      ].join('\n'),
    );
    expect(result.occurrences.map(({ site, line }) => [site, line])).toEqual([
      ['gemini', 1],
      ['claude', 2],
      ['chatgpt', 3],
      ['gemini', 4],
      ['gemini', 8],
    ]);
  });

  it('ignores ambient module names while scanning the declarations in their bodies', () => {
    const result = inspect(
      'declare module "gemini" { export type Site = "claude"; export const table: { gemini: string }; }',
    );
    expect(result.occurrences.map(({ site, form }) => [site, form])).toEqual([
      ['claude', 'literal'],
      ['gemini', 'key'],
    ]);
  });

  it('ignores string-named import and export specifiers without hiding ordinary exports', () => {
    const result = inspect(
      [
        'import { "gemini" as x } from "pkg";',
        'export { x as "gemini" };',
        'export { "claude" as "gemini" } from "pkg";',
        'export * as "gemini" from "pkg";',
        'export const value = "chatgpt";',
        'class Owner { #gemini = 1; read() { return this.#gemini; } }',
      ].join('\n'),
    );
    expect(result.occurrences).toEqual([
      { file: 'src/consumer.ts', line: 5, site: 'chatgpt', form: 'literal' },
    ]);
  });
});
