import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { catalogRuntimeData } from './bundledOffCatalogData';

const FIXTURES = join(import.meta.dirname, 'fixtures/bundled-off');
const CATALOG = join(process.cwd(), 'src/features/plugins/catalog/sites');

interface CatalogCase {
  readonly name: string;
  readonly kind: 'site' | 'plugin';
  readonly input: unknown;
  readonly expected: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cases(): CatalogCase[] {
  return readdirSync(FIXTURES)
    .filter((file) => file.includes('-metadata-') && file.endsWith('.json'))
    .flatMap((file) => {
      const site = file.split('-metadata-')[0];
      const entries: unknown = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
      if (!Array.isArray(entries)) throw new Error(`Invalid catalog fixture: ${file}`);
      return entries.map((entry: unknown): CatalogCase => {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !isRecord(entry[1]))
          throw new Error(`Invalid catalog entry: ${file}`);
        return {
          name: `${site}/${entry[0]}`,
          kind: entry[0] === 'site.json' ? 'site' : 'plugin',
          input: JSON.parse(readFileSync(join(CATALOG, site, entry[0]), 'utf8')),
          expected: entry[1],
        };
      });
    });
}

type JsonPath = readonly (string | number)[];
interface Change {
  readonly path: JsonPath;
  readonly value: unknown;
}

/** Change each independently pinned leaf, and reverse ordered arrays that have distinct items. */
function runtimeChanges(value: unknown, path: JsonPath = []): Change[] {
  if (Array.isArray(value)) {
    const reversed = [...value].reverse();
    const order =
      value.length > 1 && JSON.stringify(value) !== JSON.stringify(reversed)
        ? [{ path, value: reversed }]
        : [];
    return [...order, ...value.flatMap((entry, index) => runtimeChanges(entry, [...path, index]))];
  }
  if (isRecord(value))
    return Object.entries(value).flatMap(([key, entry]) => runtimeChanges(entry, [...path, key]));
  return [
    {
      path,
      value:
        typeof value === 'boolean'
          ? !value
          : typeof value === 'number'
            ? value + 1
            : `${String(value)}-changed`,
    },
  ];
}

function replaceAt(value: unknown, path: JsonPath, replacement: unknown): unknown {
  if (path.length === 0) return replacement;
  const [part, ...rest] = path;
  if (Array.isArray(value) && typeof part === 'number')
    return value.map((entry, index) =>
      index === part ? replaceAt(entry, rest, replacement) : entry,
    );
  if (isRecord(value) && typeof part === 'string')
    return { ...value, [part]: replaceAt(value[part], rest, replacement) };
  throw new Error(`Catalog field is missing: ${path.join('.')}`);
}

it.each(cases())('a routine catalog release breaks the OFF snapshot: $name', (entry) => {
  if (!isRecord(entry.input)) throw new Error(`Invalid catalog source: ${entry.name}`);
  expect(catalogRuntimeData(entry.input, entry.kind)).toEqual(entry.expected);
  const metadata = {
    $schema: 'https://example.test/new-schema.json',
    version: '999.9.9',
    label: 'Revised site label',
    name: 'Revised plugin name',
    description: 'Revised description',
    author: 'Another maintainer',
    category: 'productivity',
    license: 'MIT',
    homepage: 'https://example.test/plugin',
    changelog: 'Routine release notes',
    i18n: { zh: { name: '更新名称', changelog: '发布说明' } },
    releaseNotes: { version: '999.9.9', text: 'Unconsumed authoring metadata' },
  };
  // Property order and release copy cannot alter any OFF runtime input.
  const changed = Object.fromEntries(Object.entries({ ...entry.input, ...metadata }).reverse());
  expect(catalogRuntimeData(changed, entry.kind)).toEqual(entry.expected);
});

it.each(cases())('an OFF runtime change disappears from the catalog snapshot: $name', (entry) => {
  expect(catalogRuntimeData(entry.input, entry.kind)).toEqual(entry.expected);
  for (const change of runtimeChanges(entry.expected)) {
    const changed = replaceAt(entry.input, change.path, change.value);
    expect(
      catalogRuntimeData(changed, entry.kind),
      `${entry.name}/${change.path.join('.')}`,
    ).not.toEqual(entry.expected);
  }
});
