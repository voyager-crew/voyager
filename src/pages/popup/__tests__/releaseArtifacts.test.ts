import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** release.yml and the stage workflows it calls (`release-*.yml`), as one text. */
function readReleaseWorkflows(): string {
  const dir = resolve(process.cwd(), '.github/workflows');
  return readdirSync(dir)
    .filter((file) => file === 'release.yml' || /^release-.+\.yml$/.test(file))
    .sort()
    .map((file) => readFileSync(resolve(dir, file), 'utf8'))
    .join('\n');
}

describe('release artifacts', () => {
  it('documents the browser-ready Voyager artifacts instead of source archives', () => {
    const template = readFileSync(resolve(process.cwd(), '.github/RELEASE_TEMPLATE.md'), 'utf8');

    expect(template).toContain('voyager-chrome-v{VERSION}.zip');
    expect(template).toContain('voyager-firefox-v{VERSION}.xpi');
    expect(template).toContain('Source code (zip/tar.gz)');
    expect(template).not.toContain('gemini-voyager-chrome-{VERSION}.zip');
  });

  it('validates the Chrome release zip root before publishing', () => {
    const workflow = readReleaseWorkflows();

    expect(workflow).toContain('voyager-chrome-${TAG}.zip');
    expect(workflow).toContain("grep -qx 'manifest.json' chrome-zip-files.txt");
    expect(workflow).toContain("grep -qx '_locales/en/messages.json' chrome-zip-files.txt");
  });

  it('checks release outputs for private data and keeps AMO secrets out of workflow commands', () => {
    const workflow = readReleaseWorkflows();

    expect(workflow).toContain(
      'node scripts/verify-release-privacy.mjs dist_chrome dist_firefox dist_safari',
    );
    expect(workflow).toContain('node scripts/verify-release-privacy.mjs dist_edge');
    expect(workflow).toContain('AMO_JWT_SECRET: ${{ secrets.AMO_JWT_SECRET }}');
    expect(workflow).not.toContain('--api-secret=${{ secrets.AMO_JWT_SECRET }}');
  });

  it('supports a Firefox-only four-part hotfix without changing other store versions', () => {
    const workflow = readReleaseWorkflows();
    const firefoxConfig = readFileSync(resolve(process.cwd(), 'vite.config.firefox.ts'), 'utf8');

    expect(workflow).toContain('publish_firefox_only');
    expect(workflow).toContain('publish-firefox-hotfix:');
    expect(workflow).toContain('VOYAGER_FIREFOX_VERSION: ${{ inputs.version }}');
    expect(workflow).toContain('node scripts/verify-release-privacy.mjs dist_firefox');
    expect(workflow).toContain('--channel=listed');
    expect(workflow).toContain('Refresh Firefox asset on the base GitHub Release');
    expect(workflow).toContain('permissions:\n      contents: write');
    expect(workflow).toContain('gh release upload "v${BASE_VERSION}" "$RELEASE_ASSET"');
    expect(workflow).toContain('--clobber');
    expect(firefoxConfig).toContain('process.env.VOYAGER_FIREFOX_VERSION');
    expect(firefoxConfig).toContain('version: firefoxVersionOverride ?? pkg.version');
  });

  it('keeps full Safari support guidance collapsed without restoring obsolete limitations', () => {
    const workflow = readReleaseWorkflows();
    const safariDetails = workflow.match(
      /<details>\s*<summary><b>[^<]*Safari[^<]*<\/b><\/summary>[\s\S]*?<\/details>/,
    )?.[0];

    expect(safariDetails).toBeDefined();
    expect(safariDetails).toContain('image extraction in conversation exports are supported');
    expect(safariDetails).toContain('voyager.nagi.fun/guide/safari-migration');
    expect(safariDetails).not.toContain(
      'Image extraction in chat exports remains limited by Safari',
    );
  });

  it('does not assign to zsh reserved variables while reading notarization results', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/build-safari-release.sh'), 'utf8');

    expect(script).toContain('local notary_status');
    expect(script).not.toMatch(/\blocal status\b/);
    expect(script).not.toContain('submission_id');
  });

  it('builds a branded Safari DMG with a fixed drag-to-Applications layout', () => {
    const workflow = readReleaseWorkflows();
    const script = readFileSync(resolve(process.cwd(), 'scripts/build-safari-release.sh'), 'utf8');
    const background = readFileSync(
      resolve(process.cwd(), 'scripts/assets/safari-dmg-background.png'),
    );

    const settings = readFileSync(resolve(process.cwd(), 'scripts/safari-dmg-settings.py'), 'utf8');

    expect(workflow).toContain("'dmgbuild==1.6.7'");
    expect(script).toContain('dmgbuild');
    expect(script).toContain('-D "background=$DMG_BACKGROUND"');
    expect(settings).toContain('"Voyager.app": (174, 255)');
    expect(settings).toContain('"Applications": (665, 215)');
    expect(settings).toContain('"READ ME — Safari Upgrade.html": (426, 330)');
    expect(settings).toContain('show_sidebar = False');
    expect(background.subarray(1, 4).toString()).toBe('PNG');
    expect(background.readUInt32BE(16)).toBe(840);
    expect(background.readUInt32BE(20)).toBe(460);
    expect(background[25]).toBe(6);
  });

  it('builds and stores the Edge release variant independently from Chrome', () => {
    const ci = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.chrome.ts'), 'utf8');
    const edgeBuild = readFileSync(resolve(process.cwd(), 'scripts/build-edge.js'), 'utf8');

    expect(ci).toContain('browser: [chrome, edge, firefox, safari]');
    expect(viteConfig).toContain("process.env.VOYAGER_BUILD_TARGET === 'edge'");
    expect(viteConfig).toContain("? 'dist_edge'");
    expect(viteConfig).toContain("? 'dist_chrome_dev'");
    expect(viteConfig).toContain(": 'dist_chrome'");
    expect(edgeBuild).toContain("path.join(rootDir, 'dist_edge')");
  });
});
