import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { APP_LANGUAGES } from '@/utils/language';
import { getLoadedTranslations, isTranslationKey, loadTranslations } from '@/utils/translations';

const PRIMITIVES_DIR = join(process.cwd(), 'src/features/plugins/verbs');

/** Every `verbs/<primitive>/messages` folder, read from disk independently of the Vite glob. */
function primitiveMessageDirs(): string[] {
  return readdirSync(PRIMITIVES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(PRIMITIVES_DIR, entry.name, 'messages'))
    .filter((dir) => existsSync(dir));
}

describe('translations', () => {
  it('keeps other languages unloaded until requested and shares concurrent loads', async () => {
    expect(getLoadedTranslations('en')?.extName).toBe('Voyager');
    expect(getLoadedTranslations('ja')).toBeUndefined();
    const first = loadTranslations('ja');
    expect(loadTranslations('ja')).toBe(first);
    const ja = await first;
    expect(getLoadedTranslations('ja')).toBe(ja);
    expect(ja.commonClose).toBe('閉じる');
    expect(await loadTranslations('ja')).toBe(ja);
  });

  it('contains the same keys for all languages at runtime', async () => {
    const enKeys = Object.keys(await loadTranslations('en')).sort();
    for (const lang of APP_LANGUAGES) {
      const keys = Object.keys(await loadTranslations(lang)).sort();
      expect(keys).toEqual(enKeys);
    }
  });

  it('recognizes valid keys via isTranslationKey', () => {
    expect(isTranslationKey('extName')).toBe(true);
    expect(isTranslationKey('__not_a_real_key__')).toBe(false);
  });

  it("serves each primitive's own strings in every language", async () => {
    const dirs = primitiveMessageDirs();
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      for (const lang of APP_LANGUAGES) {
        const messages = JSON.parse(readFileSync(join(dir, `${lang}.json`), 'utf8')) as Record<
          string,
          { message: string }
        >;
        const strings: Record<string, string> = await loadTranslations(lang);
        for (const [key, { message }] of Object.entries(messages)) {
          expect(isTranslationKey(key)).toBe(true);
          expect(strings[key]).toBe(message);
        }
      }
    }
  });
});
