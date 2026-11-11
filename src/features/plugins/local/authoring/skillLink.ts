/**
 * Where the public authoring documents live. `bun run skills:build` writes the
 * skill's files (SKILL.md plus the site, primitive and example files it links)
 * to `docs/public/skills/write-voyager-plugin/` and one chat page per site to
 * `docs/public/create/`, which the docs site serves at these URLs. The popup
 * hands the SKILL.md URL to a coding agent and a site's page URL to the chat AI
 * on that site.
 */
export const WRITE_PLUGIN_SKILL_NAME = 'write-voyager-plugin';
export const WRITE_PLUGIN_SKILL_BASE_URL = `https://voyager.nagi.fun/skills/${WRITE_PLUGIN_SKILL_NAME}/`;
export const WRITE_PLUGIN_SKILL_URL = `${WRITE_PLUGIN_SKILL_BASE_URL}SKILL.md`;
/** The npm package that scaffolds and checks a plugin offline. */
export const PLUGIN_CLI_PACKAGE = 'create-voyager-plugin';

export const CREATE_PAGE_BASE_URL = 'https://voyager.nagi.fun/create/';

/** A site's chat page, relative to `docs/public/create/`. */
export function createPageFile(siteId: string): string {
  return `${siteId}.md`;
}

/** The page a chat AI on `siteId` reads before it writes a plugin. */
export function createPageUrl(siteId: string): string {
  return `${CREATE_PAGE_BASE_URL}${createPageFile(siteId)}`;
}
