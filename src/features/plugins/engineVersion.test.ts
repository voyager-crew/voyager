import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PLUGIN_ENGINE_VERSION } from './constants';
import {
  LAST_SEPARATE_ENGINE,
  nextReleaseVersion,
  resolveEngineVersion,
  resolveManifestEngine,
} from './engineVersion';
import { engineSatisfied } from './semver';

const nextEngine = resolveEngineVersion('next');

afterEach(() => {
  vi.doUnmock('./verbs/contractModules');
  vi.resetModules();
});

const versionFile = (path: string): string =>
  (JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as { version: string }).version;

const catalogDir = resolve(process.cwd(), 'src/features/plugins/catalog');
const catalogEngines = readdirSync(catalogDir, { recursive: true, encoding: 'utf8' })
  .filter((path) => path.split(sep).at(-1) === 'plugin.json')
  .map((path) => {
    const manifest = JSON.parse(readFileSync(resolve(catalogDir, path), 'utf8')) as {
      engine: string;
    };
    return { path, engine: resolveEngineVersion(manifest.engine) };
  });

describe('engine version', () => {
  it('is the extension version every release surface carries', () => {
    for (const path of [
      'package.json',
      'manifest.json',
      'manifest.dev.json',
      'packages/create-voyager-plugin/package.json',
    ]) {
      expect(versionFile(path), path).toBe(PLUGIN_ENGINE_VERSION);
    }
  });

  it('loads every catalog plugin and declares no floor that no released client reports', () => {
    expect(catalogEngines.length).toBeGreaterThan(0);
    for (const { path, engine } of catalogEngines) {
      expect(engineSatisfied(engine, PLUGIN_ENGINE_VERSION), path).toBe(true);
      // A floor above engine 1.11.0 but at most 2.3.1 refuses 2.3.1 while naming its version.
      const unreachable =
        engineSatisfied(engine, LAST_SEPARATE_ENGINE.voyager) &&
        !engineSatisfied(engine, LAST_SEPARATE_ENGINE.engine);
      expect(
        unreachable,
        `${path}: ${engine}; use >=${LAST_SEPARATE_ENGINE.engine} or >=next`,
      ).toBe(false);
    }
  });

  it('makes released clients refuse a plugin that needs the coming release, which accepts it', () => {
    const range = resolveEngineVersion('>=next');
    expect(range).toBe(`>=${nextReleaseVersion(PLUGIN_ENGINE_VERSION)}`);
    expect(engineSatisfied(range, LAST_SEPARATE_ENGINE.engine)).toBe(false);
    expect(engineSatisfied(range, PLUGIN_ENGINE_VERSION)).toBe(false);
    expect(engineSatisfied(range, nextReleaseVersion(PLUGIN_ENGINE_VERSION))).toBe(true);
  });
});

describe('unreleased plugin engines', () => {
  it('names the release the bump makes by default: next patch, rolling over at 10', () => {
    expect(nextReleaseVersion('2.3.1')).toBe('2.3.2');
    expect(nextReleaseVersion('2.3.9')).toBe('2.4.0');
    expect(nextReleaseVersion('2.9.9')).toBe('3.0.0');
    expect(() => nextReleaseVersion('invalid')).toThrow('Cannot resolve');
  });

  it('resolves next and its minimum range to the release that ships it', () => {
    expect(nextEngine).toBe(nextReleaseVersion(PLUGIN_ENGINE_VERSION));
    expect(resolveEngineVersion('next', '2.4.0')).toBe('2.4.0');
    expect(resolveEngineVersion('>=next', '2.4.0')).toBe('>=2.4.0');
    expect(resolveEngineVersion('>=1.3.0', '2.4.0')).toBe('>=1.3.0');
  });

  it('resolves only the engine field without mutating manifest data', () => {
    const raw = { engine: '>=next', name: 'next', contributes: { styles: [{ css: 'next' }] } };
    const resolved = resolveManifestEngine(raw);
    expect(resolved).toEqual({ ...raw, engine: `>=${nextEngine}` });
    expect(raw.engine).toBe('>=next');
    expect(resolveManifestEngine(null)).toBeNull();
  });

  it.each([
    { sinceEngine: '1.4.0', paramEngine: undefined, effective: PLUGIN_ENGINE_VERSION },
    { sinceEngine: 'next', paramEngine: undefined, effective: nextEngine },
    { sinceEngine: '1.4.0', paramEngine: 'next', effective: nextEngine },
  ])(
    'loads concrete contracts for $sinceEngine / $paramEngine',
    async ({ sinceEngine, paramEngine, effective }) => {
      vi.resetModules();
      vi.doMock('./verbs/contractModules', () => ({
        PRIMITIVE_CONTRACT_MODULES: {
          './demo/contract.ts': {
            name: 'demo',
            sinceEngine,
            semantic: [],
            description: 'Demo',
            params: {
              option: {
                type: 'boolean',
                required: false,
                description: 'Option',
                ...(paramEngine ? { sinceEngine: paramEngine } : {}),
              },
            },
          },
        },
      }));
      const contracts = await import('./verbs/contracts');
      expect(contracts.EFFECTIVE_PLUGIN_ENGINE_VERSION).toBe(effective);
      expect(contracts.getPrimitiveContract('demo')?.sinceEngine).toBe(
        sinceEngine === 'next' ? nextEngine : sinceEngine,
      );
      expect(contracts.getPrimitiveContract('demo')?.params.option.sinceEngine).toBe(
        paramEngine ? nextEngine : undefined,
      );
    },
  );
});
