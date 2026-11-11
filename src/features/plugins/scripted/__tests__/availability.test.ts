import { describe, expect, it } from 'vitest';

import { type UserScriptsProbe, chromeMajorVersion, probeUserScripts } from '../availability';

const WORKING = { getScripts: async () => [] };
const THROWING = {
  getScripts: async () => {
    throw new Error('The userScripts API is not available');
  },
};

function probe(overrides: Partial<UserScriptsProbe> = {}): UserScriptsProbe {
  return {
    target: 'chrome',
    formFactor: 'desktop',
    chromeMajor: 140,
    userScripts: WORKING,
    ...overrides,
  };
}

describe('probeUserScripts', () => {
  it('is available when getScripts answers', async () => {
    expect(await probeUserScripts(probe())).toEqual({ kind: 'available' });
    expect(await probeUserScripts(probe({ target: 'edge' }))).toEqual({ kind: 'available' });
  });

  it('reports the Allow User Scripts toggle from Chrome 138 when getScripts throws', async () => {
    await expect(probeUserScripts(probe({ userScripts: THROWING }))).resolves.toEqual({
      kind: 'toggle-off',
      needs: 'allow-user-scripts',
    });
  });

  it('reports the toggle when Chrome hides the namespace', async () => {
    expect(await probeUserScripts(probe({ userScripts: undefined }))).toEqual({
      kind: 'toggle-off',
      needs: 'allow-user-scripts',
    });
  });

  it('reports Developer mode before Chrome 138', async () => {
    expect(await probeUserScripts(probe({ chromeMajor: 135, userScripts: THROWING }))).toEqual({
      kind: 'toggle-off',
      needs: 'developer-mode',
    });
  });

  it('is unsupported on Safari, Firefox, phones and Chrome before per-plugin worlds', async () => {
    expect(await probeUserScripts(probe({ target: 'safari' }))).toEqual({
      kind: 'unsupported',
      browser: 'safari',
    });
    expect(await probeUserScripts(probe({ target: 'firefox' }))).toEqual({
      kind: 'unsupported',
      browser: 'firefox',
    });
    expect(await probeUserScripts(probe({ formFactor: 'mobile' }))).toEqual({
      kind: 'unsupported',
      browser: 'mobile',
    });
    expect(await probeUserScripts(probe({ chromeMajor: 132 }))).toEqual({
      kind: 'unsupported',
      browser: 'old',
    });
  });
});

describe('chromeMajorVersion', () => {
  it('reads Chrome and Edge user agents', () => {
    expect(
      chromeMajorVersion(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      ),
    ).toBe(141);
    expect(
      chromeMajorVersion(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0',
      ),
    ).toBe(137);
    expect(chromeMajorVersion('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Firefox/140.0')).toBe(
      undefined,
    );
  });
});
