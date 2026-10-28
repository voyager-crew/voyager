import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { readContentStyle } from '@/tests/contentStyle';
import * as translations from '@/utils/translations';

import {
  hasUnreadChangelog,
  openChangelog,
  resolveChangelogImageUrl,
  rewriteChangelogImageUrls,
} from '../index';
import { createChangelogModal } from '../modal';
import { NOTE_LOCALES, noteBody, notePath, pickNoteLocale } from '../noteSections';

const parseMarkdown = vi.hoisted(() => vi.fn());
vi.mock('marked', () => ({ marked: { parse: parseMarkdown } }));
vi.mock('@/utils/i18n', () => ({ getCurrentLanguage: async () => 'en' }));

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('pickNoteLocale', () => {
  const has = (lang: string) => lang === 'en' || lang === 'zh';

  it('uses the requested language when that note exists', () => {
    expect(pickNoteLocale('zh', has)).toBe('zh');
  });

  it('falls back to English when the requested language is missing', () => {
    expect(pickNoteLocale('fr', has)).toBe('en');
  });

  it('returns null when neither the requested language nor English exists', () => {
    expect(pickNoteLocale('fr', () => false)).toBeNull();
  });
});

describe('noteBody', () => {
  it('strips front matter and trims the body', () => {
    const withFrontMatter = `---
images:
  hero: ./assets/1.2.8-hero.gif
---

### What's New
- Feature A
`;

    expect(noteBody(withFrontMatter)).toBe("### What's New\n- Feature A");
    expect(noteBody('\n> _quote_\n')).toBe('> _quote_');
  });
});

describe('release note quotes', () => {
  const notesDir = resolve(process.cwd(), 'src/pages/content/changelog/notes');
  const parts = (version: string) => version.split('.').map(Number);
  /** From 2.1.1 every release opens with a quote (the release skill's changelog guide). */
  const sinceQuotesRequired = (version: string) => {
    const [major, minor, patch] = parts(version);
    return major * 1e6 + minor * 1e3 + patch >= 2_001_001;
  };
  const languageFiles = () => NOTE_LOCALES.map((locale) => `${locale}.md`).sort();

  it('does not let a release note ship without its opening quote in every locale', () => {
    const versions = readdirSync(notesDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          /^\d+\.\d+\.\d+$/.test(entry.name) &&
          sinceQuotesRequired(entry.name),
      )
      .map((entry) => entry.name);
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      const versionDir = resolve(notesDir, version);
      const files = readdirSync(versionDir)
        .filter((name) => name.endsWith('.md'))
        .sort();
      expect(files).toEqual(languageFiles());
      for (const locale of NOTE_LOCALES) {
        const body = noteBody(readFileSync(resolve(versionDir, `${locale}.md`), 'utf8'));
        expect(`${version} ${locale}: ${body}`).toMatch(
          new RegExp(`^${version.replace(/\./g, '\\.')} ${locale}: > _`),
        );
      }
    }
  });

  it('keeps the 1.6.0 quote at the start of its English and Chinese notes', () => {
    const versionDir = resolve(notesDir, '1.6.0');

    expect(noteBody(readFileSync(resolve(versionDir, 'en.md'), 'utf8'))).toMatch(
      /^> \*"Not all those who wander are lost\."/,
    );
    expect(noteBody(readFileSync(resolve(versionDir, 'zh.md'), 'utf8'))).toMatch(
      /^> \*「并非所有流浪者都迷失了方向。/,
    );
  });
});

describe('changelog quote styles', () => {
  it('gives the leading quote an explicit cross-browser presentation', async () => {
    const overlay = await createChangelogModal(
      '<blockquote>Opening quote</blockquote><p>Notes</p>',
      'en',
    );
    const leadingElement = overlay.querySelector('.gv-changelog-body')?.firstElementChild;
    const css = readContentStyle();

    expect(leadingElement?.classList.contains('gv-changelog-quote')).toBe(true);
    expect(leadingElement?.tagName).toBe('BLOCKQUOTE');
    expect(css).toMatch(/\.gv-changelog-body > \.gv-changelog-quote\s*\{[^}]*display:\s*block;/s);
  });

  it('leaves a quote after the opening paragraph unclassified', async () => {
    const overlay = await createChangelogModal(
      '<p>Notes</p><blockquote>Later quote</blockquote>',
      'en',
    );

    expect(overlay.querySelector('blockquote')?.classList.contains('gv-changelog-quote')).toBe(
      false,
    );
  });
});

describe('resolveChangelogImageUrl', () => {
  it('rewrites github raw promotion image URLs to runtime URLs', () => {
    const source =
      'https://github.com/voyager-crew/voyager/raw/main/docs/public/assets/promotion/Activity-View.png';

    const result = resolveChangelogImageUrl(source, (path) => `moz-extension://test-id/${path}`);

    expect(result).toBe('moz-extension://test-id/changelog-activity-view.png');
  });

  it('rewrites raw.githubusercontent.com promotion image URLs to runtime URLs', () => {
    const source =
      'https://raw.githubusercontent.com/voyager-crew/voyager/main/docs/public/assets/promotion/Activity-View.png';

    const result = resolveChangelogImageUrl(source, (path) => `moz-extension://test-id/${path}`);

    expect(result).toBe('moz-extension://test-id/changelog-activity-view.png');
  });

  // A changelog image must be bundled, not fetched: Firefox applies the host
  // page's CSP to DOM a content script injects, and GitHub is unreachable for a
  // sizeable part of the user base. An image added outside the promotion path,
  // or without a getPromotionRuntimePath entry, fails silently — it renders in
  // Chrome on a good connection and is broken everywhere else. Only the release
  // being shipped is pinned; images in older notes stay remote by choice, since
  // their assets are no longer carried in the package.
  it('resolves every image in the current release note to a runtime URL', () => {
    const version = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
      .version as string;
    const versionDir = resolve(__dirname, `../notes/${version}`);
    const files = readdirSync(versionDir)
      .filter((name) => name.endsWith('.md'))
      .sort();
    expect(files).toEqual(NOTE_LOCALES.map((locale) => `${locale}.md`).sort());

    const unresolved = NOTE_LOCALES.flatMap((locale) => {
      const markdown = readFileSync(
        resolve(__dirname, `../notes/${notePath(version, locale)}`),
        'utf8',
      );
      return [...markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g)]
        .map((match) => match[1])
        .filter(
          (url) =>
            resolveChangelogImageUrl(url, (path) => `moz-extension://test-id/${path}`) === url,
        )
        .map((url) => `${locale}: ${url}`);
    });

    expect(unresolved).toEqual([]);
  });

  it('keeps unsupported image URLs unchanged', () => {
    const source =
      'https://github.com/voyager-crew/voyager/raw/main/docs/public/assets/promotion/Promo-Unknown.png';

    const result = resolveChangelogImageUrl(source, (path) => `moz-extension://test-id/${path}`);

    expect(result).toBe(source);
  });
});

describe('changelog sanitizer URI policy', () => {
  it('keeps the release unread when its language cannot be loaded', async () => {
    vi.mocked(chrome.storage.local.set).mockClear();
    vi.spyOn(translations, 'loadTranslations').mockRejectedValueOnce(
      new Error('language chunk unavailable'),
    );

    await expect(openChangelog()).rejects.toThrow('language chunk unavailable');

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(document.querySelector('.gv-changelog-overlay')).toBeNull();
  });

  // The bundled screenshot resolves to a chrome-extension:// or moz-extension://
  // URL. DOMPurify's default URI policy allows neither, so it strips the src and
  // renders a broken image with no error anywhere — the exact failure this pins.
  it('sanitizes markup before mounting the changelog', async () => {
    parseMarkdown.mockReturnValue('<script>alert(1)</script><p onclick="alert(1)">Notes</p>');

    expect(await openChangelog()).toBe(true);
    const body = document.querySelector('.gv-changelog-body');
    expect(body?.querySelector('script')).toBeNull();
    expect(body?.querySelector('p')?.hasAttribute('onclick')).toBe(false);
  });

  it.each([
    ['chrome-extension://abc/changelog-activity-view.png'],
    ['moz-extension://abc/changelog-activity-view.png'],
    ['https://voyager.nagi.fun/assets/promotion/Activity-View.png'],
  ])('keeps the src for %s', async (src) => {
    parseMarkdown.mockReturnValue(`<img src="${src}" alt="x">`);

    expect(await openChangelog()).toBe(true);
    expect(document.querySelector('.gv-changelog-body img')?.getAttribute('src')).toBe(src);
  });

  it('still drops a javascript: src', async () => {
    parseMarkdown.mockReturnValue('<img src="javascript:alert(1)" alt="x">');

    expect(await openChangelog()).toBe(true);
    expect(document.querySelector('.gv-changelog-body img')?.getAttribute('src')).toBeNull();
  });
});

describe('rewriteChangelogImageUrls', () => {
  it('rewrites supported markdown image URLs and preserves others', () => {
    const source = [
      '![banner](https://github.com/voyager-crew/voyager/raw/main/docs/public/assets/promotion/Activity-View.png)',
      '![external](https://example.com/banner.png)',
    ].join('\n');

    const result = rewriteChangelogImageUrls(source, (path) => `moz-extension://test-id/${path}`);

    expect(result).toContain('![banner](moz-extension://test-id/changelog-activity-view.png)');
    expect(result).toContain('![external](https://example.com/banner.png)');
  });

  it('falls back to original URL when runtime URL resolution fails', () => {
    const source =
      '![banner](https://github.com/voyager-crew/voyager/raw/main/docs/public/assets/promotion/Activity-View.png)';

    const result = rewriteChangelogImageUrls(source, () => null);

    expect(result).toBe(source);
  });

  it('skips rewriting when rewrite flag is disabled', () => {
    const source =
      '![banner](https://github.com/voyager-crew/voyager/raw/main/docs/public/assets/promotion/Activity-View.png)';

    const result = rewriteChangelogImageUrls(
      source,
      (path) => `moz-extension://test-id/${path}`,
      false,
    );

    expect(result).toBe(source);
  });
});

describe('hasUnreadChangelog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false on first install (no dismissed version stored)', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    expect(await hasUnreadChangelog()).toBe(false);
  });

  it('returns true when dismissed version differs from current', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [StorageKeys.CHANGELOG_DISMISSED_VERSION]: '0.0.1',
    });
    expect(await hasUnreadChangelog()).toBe(true);
  });

  it('returns false when dismissed version matches current', async () => {
    const { EXTENSION_VERSION } = await import('@/core/utils/version');
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [StorageKeys.CHANGELOG_DISMISSED_VERSION]: EXTENSION_VERSION,
    });
    expect(await hasUnreadChangelog()).toBe(false);
  });
});
