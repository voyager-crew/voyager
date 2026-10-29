// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function checkGraph(
  module: string,
  entry = 'import { run } from "./request"; run();',
  files: Readonly<Record<string, string>> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'voyager-panel-api-'));
  directories.push(directory);
  symlinkSync(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
  writeFileSync(join(directory, 'entry.ts'), entry);
  writeFileSync(join(directory, 'request.ts'), module);
  for (const [name, code] of Object.entries(files)) writeFileSync(join(directory, name), code);
  return spawnSync('bun', [resolve('scripts/check-panel-apis.ts'), join(directory, 'entry.ts')], {
    encoding: 'utf8',
  });
}

describe('panel API contract through bundled fixture graphs', () => {
  it('accepts runtime messaging and unrelated objects with a tabs property', () => {
    const result = checkGraph(
      'export function run() { const local = { tabs: { query() {} } }; local.tabs.query(); return chrome.runtime.sendMessage({ type: "request" }); }',
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it('does not confuse locally shadowed browser names or dynamic keys with API access', () => {
    const result = checkGraph(
      'export function run() { const chrome = { tabs: { query() {} } }; const browser = chrome; browser.tabs.query(); const tabs = "runtime"; return globalThis.chrome[tabs].sendMessage({}); }',
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it('accepts runtime messaging through the real webextension-polyfill package', () => {
    const result = checkGraph(
      'import api from "webextension-polyfill"; export function run() { return api.runtime.sendMessage({ type: "request" }); }',
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    'const { default: api } = await import("webextension-polyfill"); return api.runtime.sendMessage({});',
    'const w: { extension?: typeof chrome } = {}; w["extension"] = chrome; return w.extension.runtime.sendMessage({});',
    'return import("webextension-polyfill").then(({ default: api }) => api.runtime.sendMessage({}));',
    'return import("webextension-polyfill").then((module) => module.default).then((api) => api.runtime.sendMessage({}));',
    'const key = location.hash.slice(1); const local = { tabs: { query() {} } }; return local[key];',
    'const wrapped = { extension: chrome, tabs: { query() {} } }; wrapped.tabs.query(); return wrapped.extension.runtime.sendMessage({});',
    'const getApi = () => chrome; return getApi().runtime.sendMessage({});',
    'function getLocal() { return { tabs: { query() {} } }; } return getLocal().tabs.query();',
  ])('accepts wrappers that do not access forbidden browser APIs: %s', (operation) => {
    const result = checkGraph(`export async function run() { ${operation} }`);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    'const { default: api } = await import("webextension-polyfill"); return api.tabs.query({});',
    'const w: { extension?: typeof chrome } = {}; w["extension"] = chrome; return w.extension.tabs.query({});',
    'const w = {}; w["extension"] = chrome; return w.extension.tabs.query({});',
    'const w = {}; w["extension"] = chrome; return w["extension"].windows.getCurrent();',
    'return import("webextension-polyfill").then(({ default: api }) => api.tabs.query({}));',
    'const callback = ({ default: api }) => api.windows.getCurrent(); return import("webextension-polyfill").then(callback);',
    'const key = location.hash.slice(1); return chrome[key].query({});',
    'const key = location.hash.slice(1); const w = { extension: chrome }; return w.extension[key];',
    'const key = location.hash.slice(1); const w = { extension: chrome }; return w[key].tabs.query({});',
    'const key = location.hash.slice(1); const w = { services: { extension: chrome }, tabs: {} }; return w[key];',
    'return import("webextension-polyfill").then((module) => module.default).then((api) => api.tabs.query({}));',
    'const key = location.hash.slice(1); browser[key] = {};',
    'const imported = await import("webextension-polyfill"); return imported.default.windows.getCurrent();',
    'const wrapped = { extension: chrome }; return wrapped.extension.tabs.query({});',
    'const wrapped = { services: { extension: chrome } }; const { extension } = wrapped.services; return extension.windows.getCurrent();',
    'function getApi() { return chrome; } return getApi().tabs.query({});',
    'const getApi = () => chrome; const load = getApi; return load().windows.getCurrent();',
  ])('rejects API provenance through dynamic imports, objects and functions: %s', (operation) => {
    const result = checkGraph(`export async function run() { ${operation} }`);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('forbidden browser API');
  });

  it('resolves repository dependencies that use the project TypeScript aliases', () => {
    const result = checkGraph(
      `import { PANEL_MESSAGE } from ${JSON.stringify(resolve('src/features/panel/protocol.ts'))}; export function run() { return chrome.runtime.sendMessage({ type: PANEL_MESSAGE.close }); }`,
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    'import api from "webextension-polyfill"; export function run() { return api.tabs.query({}); }',
    'import api from "webextension-polyfill"; export function run() { const { windows: current } = api; return current.getCurrent(); }',
    'import * as extension from "webextension-polyfill"; export function run() { return extension.default.tabs.query({}); }',
    'import { tabs as current } from "webextension-polyfill"; export function run() { return current.query({}); }',
  ])('rejects forbidden access imported from webextension-polyfill: %s', (module) => {
    const result = checkGraph(module);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('forbidden browser API');
  });

  it('accepts a polyfill wrapper that only provides runtime messaging', () => {
    const result = checkGraph(
      'import { extension } from "./wrapper"; export function run() { return extension.runtime.sendMessage({}); }',
      undefined,
      { 'wrapper.ts': 'import api from "webextension-polyfill"; export const extension = api;' },
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    'import api from "webextension-polyfill"; export const extension = api;',
    'import api from "webextension-polyfill"; export { api as extension };',
    'export { default as extension } from "webextension-polyfill";',
  ])('rejects forbidden calls through an exported polyfill alias: %s', (wrapper) => {
    const result = checkGraph(
      'import { extension } from "./wrapper"; export function run() { const current = extension; return current.tabs.query({}); }',
      undefined,
      { 'wrapper.ts': wrapper },
    );
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('forbidden browser API tabs');
  });

  it('rejects forbidden calls through multiple re-export hops', () => {
    const result = checkGraph(
      'import { browser } from "./barrel"; export function run() { const { windows } = browser; return windows.getCurrent(); }',
      undefined,
      {
        'wrapper.ts': 'import api from "webextension-polyfill"; export default api;',
        'bridge.ts': 'export { default as extension } from "./wrapper";',
        'barrel.ts': 'export { extension as browser } from "./bridge";',
      },
    );
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('forbidden browser API windows');
  });

  it.each([
    'const extension = facade.extension;',
    'const extension = facade["extension"];',
    'const { extension } = facade;',
  ])('rejects an API alias obtained from a namespace barrel: %s', (alias) => {
    const result = checkGraph(
      `import * as facade from "./barrel"; export function run() { ${alias} return extension.tabs.query({}); }`,
      undefined,
      {
        'wrapper.ts': 'import api from "webextension-polyfill"; export const extension = api;',
        'barrel.ts': 'export * from "./wrapper";',
      },
    );
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('forbidden browser API tabs');
  });

  it.each([
    'chrome.tabs.query({})',
    'browser.windows.getCurrent()',
    'globalThis.chrome["tabs"].create({})',
    'globalThis.chrome?.tabs?.query?.({})',
    'browser?.windows?.getCurrent?.()',
    'const api = browser; const { tabs: current } = api; current.query({})',
    'let api; api = chrome; const query = api.tabs.query; query({})',
    'const { browser: api } = window; const { windows: current } = api; current.getCurrent()',
    'const { tabs: { query } } = chrome; query({})',
    'const { chrome: { tabs: current } } = globalThis; current.query({})',
    'let api; ({ browser: api } = self); api.windows.getCurrent()',
    'const api = globalThis.chrome; const namespace = "tabs"; api[namespace].query({})',
  ])('rejects forbidden browser access in an imported module: %s', (operation) => {
    const result = checkGraph(`export function run() { ${operation}; }`);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('forbidden browser API');
  });

  it('checks a dynamic import before it can become a panel feature', () => {
    const result = checkGraph(
      'export function run() { return chrome.tabs.query({}); }',
      'void import("./request").then(({ run }) => run());',
    );
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('forbidden browser API tabs');
  });

  it('checks modules selected by Vite globs even when their exports are not called', () => {
    const result = checkGraph(
      'export function run() { return browser.windows.getCurrent(); }',
      'const modules = import.meta.glob("./request.ts", { eager: true }); void modules;',
    );
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('forbidden browser API windows');
  });
});
