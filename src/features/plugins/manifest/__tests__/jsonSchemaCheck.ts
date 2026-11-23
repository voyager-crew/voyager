/**
 * The JSON Schema checker and the fixtures the schema tests share. See
 * `../schema.test.ts` for why the checker is local and what it covers.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
export const catalogSites = join(repoRoot, 'src/features/plugins/catalog/sites');

export type JsonSchema = Record<string, unknown>;

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

// ---------------------------------------------------------------------------
// A minimal JSON Schema (draft 2020-12) checker — only the keywords used here
// ---------------------------------------------------------------------------

export interface CheckOptions {
  /**
   * Report every object property the schema does not name, as if each object
   * schema carried `additionalProperties: false`. This is how "the schema
   * documents every field the validator emits" is asserted; normal validation
   * stays lenient, matching the validators, which ignore unknown keys.
   */
  readonly strictProperties?: boolean;
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function typeMatches(value: unknown, type: string): boolean {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return jsonType(value) === type;
}

/** The directory each loaded schema document came from, so its relative `$ref`s resolve. */
const schemaDirs = new WeakMap<JsonSchema, string>();

export function loadSchema(path: string): JsonSchema {
  const schema = readJson(path) as JsonSchema;
  schemaDirs.set(schema, dirname(path));
  return schema;
}

/**
 * The schema `ref` names, and the document it lives in: `#/…` within `root`,
 * `file.schema.json` or `file.schema.json#/…` in a file next to `root` (a site
 * schema keeps each large section in `site-sections/`).
 */
function resolveRef(
  ref: string,
  root: JsonSchema,
): { target: JsonSchema; root: JsonSchema } | null {
  const hash = ref.indexOf('#');
  const file = hash === -1 ? ref : ref.slice(0, hash);
  const pointer = hash === -1 ? '' : ref.slice(hash + 1);
  let document = root;
  if (file) {
    const dir = schemaDirs.get(root);
    if (!dir) return null;
    document = loadSchema(join(dir, file));
  }
  if (pointer !== '' && !pointer.startsWith('/')) return null;
  let node: unknown = document;
  for (const rawSegment of pointer ? pointer.slice(1).split('/') : []) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'object' && node !== null
    ? { target: node as JsonSchema, root: document }
    : null;
}

export const pluginSchema = loadSchema(join(repoRoot, 'docs/public/plugin.schema.json'));
export const siteSchema = loadSchema(join(repoRoot, 'docs/public/site.schema.json'));

/** Own enumerable properties, treating an explicitly-undefined value as absent. */
function definedEntries(value: Record<string, unknown>): [string, unknown][] {
  return Object.entries(value).filter(([, item]) => item !== undefined);
}

function checkSchema(
  value: unknown,
  schema: JsonSchema | boolean,
  root: JsonSchema,
  options: CheckOptions,
  path: string,
): string[] {
  if (typeof schema === 'boolean') return schema ? [] : [`${path}: no value is allowed here`];

  if (typeof schema.$ref === 'string') {
    const resolved = resolveRef(schema.$ref, root);
    if (!resolved) return [`${path}: unresolvable $ref "${schema.$ref}"`];
    return checkSchema(value, resolved.target, resolved.root, options, path);
  }

  const errors: string[] = [];

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((type) => typeMatches(value, type))) {
      errors.push(`${path}: expected ${types.join(' | ')}, got ${jsonType(value)}`);
      return errors;
    }
  }
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }

  if (typeof value === 'string') {
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: does not match /${schema.pattern}/`);
    }
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path}: shorter than ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path}: longer than ${schema.maxLength}`);
    }
    if (schema.format === 'regex') {
      try {
        new RegExp(value);
      } catch {
        errors.push(`${path}: not a valid regular expression`);
      }
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: below the minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path}: above the maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path}: fewer than ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path}: more than ${schema.maxItems} items`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => {
        errors.push(
          ...checkSchema(
            item,
            schema.items as JsonSchema | boolean,
            root,
            options,
            `${path}[${index}]`,
          ),
        );
      });
    }
  }

  if (jsonType(value) === 'object') {
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    const additional = schema.additionalProperties;

    for (const key of (schema.required ?? []) as string[]) {
      if (object[key] === undefined) errors.push(`${path}: missing required "${key}"`);
    }
    for (const [key, item] of definedEntries(object)) {
      const child = `${path}.${key}`;
      if (schema.propertyNames !== undefined) {
        errors.push(
          ...checkSchema(key, schema.propertyNames as JsonSchema, root, options, `${child} (name)`),
        );
      }
      if (properties[key] !== undefined) {
        errors.push(...checkSchema(item, properties[key], root, options, child));
        continue;
      }
      if (additional !== undefined && additional !== false && additional !== true) {
        errors.push(...checkSchema(item, additional as JsonSchema, root, options, child));
        continue;
      }
      // Only a schema that actually names properties can call a key
      // undescribed. A composition wrapper (`anyOf` / `oneOf` with no
      // `properties` of its own) describes nothing directly — its branches do,
      // and one of them matching is what counts.
      if (
        additional === false ||
        (options.strictProperties && schema.properties !== undefined && additional === undefined)
      ) {
        errors.push(`${child}: not described by the schema`);
      }
    }
  }

  if (schema.if !== undefined) {
    const matches = checkSchema(value, schema.if as JsonSchema, root, {}, path).length === 0;
    const branch = matches ? schema.then : schema.else;
    // A conditional only adds constraints; the enclosing schema already
    // describes (and strict-checks) every key, so the branch runs lenient.
    if (branch !== undefined) {
      errors.push(...checkSchema(value, branch as JsonSchema, root, {}, path));
    }
  }

  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const branches = schema[keyword] as (JsonSchema | boolean)[] | undefined;
    if (!Array.isArray(branches)) continue;
    const failures = branches.map((branch) =>
      checkSchema(value, branch, root, options, `${path}<${keyword}>`),
    );
    const passing = failures.filter((branch) => branch.length === 0).length;
    if (keyword === 'anyOf' && passing === 0) {
      errors.push(`${path}: matched no anyOf branch (${failures.flat().join('; ')})`);
    }
    if (keyword === 'oneOf' && passing !== 1) {
      errors.push(`${path}: matched ${passing} oneOf branches, expected exactly 1`);
    }
  }

  return errors;
}

export function check(value: unknown, schema: JsonSchema, options: CheckOptions = {}): string[] {
  return checkSchema(value, schema, schema, options, '$');
}

/** JSON round trip: drops `undefined`, mirroring what a published file carries. */
export function serialized(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

export function listDirs(dir: string): readonly string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function listBundledSites(): readonly { label: string; raw: Record<string, unknown> }[] {
  return listDirs(catalogSites).map((site) => ({
    label: `sites/${site}`,
    raw: readJson(join(catalogSites, site, 'site.json')) as Record<string, unknown>,
  }));
}
