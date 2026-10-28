import { afterAll, describe, expect, it } from 'vitest';

import { cleanupFixtures, lintFiles, lintSource, repositoryFixture } from './testing.mjs';

afterAll(cleanupFixtures);

const code = 'voyager(no-unforgeable-global-stub)';

function expectFlagged(source, count = 1, filename = 'scratch.test.ts') {
  const result = lintSource(source, filename);
  expect(result.status).toBe(1);
  expect(result.diagnostics).toHaveLength(count);
  for (const diagnostic of result.diagnostics) {
    expect(diagnostic.code).toBe(code);
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.message).toMatch(/setPageUrl\(\).*@\/tests\/pageUrl/);
  }
}

describe('no-unforgeable-global-stub', () => {
  it.each([
    "Object.defineProperty(window, 'location', { configurable: true, value: new URL('https://a.test/') });",
    "Object.defineProperty(globalThis, 'location', { value: { hostname: 'a.test' } });",
    "Reflect.defineProperty(window, 'window', { value: {} });",
    "Object.defineProperty(globalThis, 'document', { configurable: true, value: undefined });",
    "Object.defineProperty(self, 'top', { value: {} });",
    "Object.defineProperty(globalThis.window, 'location', { value: {} });",
    "globalThis.Object.defineProperty(window, 'location', { value: {} });",
    'Object.defineProperty(window, `location`, { value: {} });',
    "const name = 'location'; Object.defineProperty(window, name, { value: {} });",
    "const { defineProperty } = Object; defineProperty(window, 'location', { value: {} });",
    "const saved = Object.getOwnPropertyDescriptor(window, 'location')!; Object.defineProperty(window, 'location', saved);",
    "vi.stubGlobal('location', new URL('https://a.test/'));",
    "vi.stubGlobal('window', undefined);",
    "vi.stubGlobal('document', {});",
    "import { vi as mock } from 'vitest'; mock.stubGlobal('location', {});",
    "import * as vitest from 'vitest'; vitest.vi.stubGlobal('top', {});",
  ])('rejects %s', (source) => {
    expectFlagged(source);
  });

  it('reports every redefinition in a file', () => {
    expectFlagged(
      `vi.stubGlobal('location', new URL('https://a.test/'));
       Object.defineProperty(window, 'location', { value: {} });`,
      2,
    );
  });

  it('allows redefinable globals, other objects and shadowed names', () => {
    const result = lintSource(`
      vi.stubGlobal('fetch', vi.fn());
      vi.stubGlobal('navigator', { clipboard: {} });
      vi.stubGlobal('matchMedia', vi.fn());
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn() });
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {} });
      const page = { location: {} };
      Object.defineProperty(page, 'location', { value: {} });
      function scoped(window: object) {
        Object.defineProperty(window, 'location', { value: {} });
      }
      scoped({});
      const vi2 = { stubGlobal: (_name: string, _value: unknown) => {} };
      vi2.stubGlobal('location', {});
    `);
    expect(result).toEqual({ status: 0, diagnostics: [] });
  });

  it.each(['node', 'edge-runtime'])('allows a file that runs in the %s environment', (env) => {
    expect(lintSource(`// @vitest-environment ${env}\nvi.stubGlobal('window', {});`)).toEqual({
      status: 0,
      diagnostics: [],
    });
  });

  it('still checks a file that declares jsdom', () => {
    expectFlagged("// @vitest-environment jsdom\nvi.stubGlobal('location', {});");
  });

  it('checks test helpers in __tests__ and src/tests, and leaves production code alone', () => {
    expectFlagged("vi.stubGlobal('location', {});", 1, '__tests__/pageHarness.ts');
    const source = "Object.defineProperty(window, 'location', { value: {} });";
    const helper = repositoryFixture(source, 'src/tests/pageHelper.ts');
    const helperResult = lintFiles([helper.file], undefined, helper.workspace);
    expect(helperResult.diagnostics.map((entry) => entry.code)).toEqual([code]);
    const production = repositoryFixture(source, 'src/pages/content/feature.ts');
    expect(lintFiles([production.file], undefined, production.workspace)).toEqual({
      status: 0,
      diagnostics: [],
    });
  });
});
