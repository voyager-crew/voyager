/**
 * The shared chat page for the scripted tier, `docs/public/create/scripted.md`,
 * which every site's create page points at when a request needs code. It is
 * written by `bun run skills:build` with the create pages; its example runs
 * through the scripted gate in tests.
 */
import { MAX_SCRIPT_SOURCE_CHARS } from '../../manifest/scriptedChecks';
import type { SiteAdapter } from '../../types';
import { SKILL_PRIMITIVES_FILE } from './authoringDocs';
import { renderExample } from './pluginContract';
import type { PluginExample } from './pluginExamples';
import { SCRIPTED_REQUIREMENT } from './scriptedContract';
import { isUnrestrictedSite, siteAnchors } from './siteFacts';
import { WRITE_PLUGIN_SKILL_BASE_URL } from './skillLink';

const EXAMPLE_SOURCE = [
  '// Conversation timer: a small badge with how long this conversation has been open.',
  "const badge = document.createElement('div');",
  "badge.className = 'gv-plugin-chat-timer';",
  'Object.assign(badge.style, {',
  "  position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647',",
  "  padding: '4px 8px', borderRadius: '8px', font: '12px system-ui, sans-serif',",
  "  background: 'rgba(0, 0, 0, 0.6)', color: '#fff', pointerEvents: 'none',",
  '});',
  'document.body.append(badge);',
  '',
  'let path = location.pathname;',
  'let openedAt = Date.now();',
  '',
  'function render() {',
  '  // The site switches conversations without reloading, so watch the address.',
  '  if (location.pathname !== path) {',
  '    path = location.pathname;',
  '    openedAt = Date.now();',
  '  }',
  '  const minutes = Math.floor((Date.now() - openedAt) / 60000);',
  '  badge.textContent = `Open for ${minutes} min`;',
  '}',
  '',
  'render();',
  'setInterval(render, 1000);',
  '',
].join('\n');

/** The page's worked example, for `site`; tests run it through the scripted gate on every site. */
export function buildScriptedExample(site: SiteAdapter): PluginExample {
  return {
    title: 'A scripted plugin (a timer badge)',
    manifest: {
      id: 'me.chat-timer',
      name: 'Conversation timer',
      version: '1.0.0',
      description: 'Show how long the current conversation has been open',
      author: 'me',
      category: 'productivity',
      license: 'MIT',
      engine: '>=1.0.0',
      tier: 'scripted',
      matches: [...site.matches],
      contributes: { script: { source: EXAMPLE_SOURCE } },
    },
  };
}

function selectorLines(site: SiteAdapter): string[] {
  const anchors = siteAnchors(site);
  if (anchors.length === 0) return [`- ${site.label}: none declared`];
  return [`- ${site.label}:`, ...anchors.map((key) => `  - ${key}: \`${site.selectors[key]}\``)];
}

/** The shared page; the example targets the first site without primitive or theme limits. */
export function renderScriptedPage(sites: readonly SiteAdapter[]): string {
  const site = sites.find(isUnrestrictedSite) ?? sites[0];
  if (!site) throw new Error('no site adapters to render the scripted page from');
  return [
    '# Voyager plugins that run code (scripted tier)',
    '',
    `You were sent here from a Voyager create page because the request may need JavaScript. Everything on that page still applies (fields, "matches", engine, reply format) except what this page changes. First check whether a primitive in ${WRITE_PLUGIN_SKILL_BASE_URL}${SKILL_PRIMITIVES_FILE} or plain CSS and page changes already do it: then write that declarative plugin instead, because it runs on every browser and the user has less to review.`,
    '',
    '## Manifest',
    '',
    '- "tier": "scripted".',
    `- "contributes": { "script": { "source": "<JavaScript>" } } and nothing else: no "styles", "domOps", "settings" or "theme". Style what you add from the script itself (inline styles, or a <style> element you add). The source is at most ${MAX_SCRIPT_SOURCE_CHARS.toLocaleString('en-US')} characters, as a JSON string (newlines written as \\n).`,
    '- "matches", "id", "engine" and the other fields as on the create page. There are no settings: put any value the user may want to change in a named constant at the top of the source.',
    '',
    '## How it runs',
    '',
    '- Voyager registers it with Chrome’s userScripts API. It runs once the page’s document has loaded (document idle), in the top frame only, in its own isolated world: it shares the page’s DOM but not its JavaScript globals, and cannot use any browser extension API.',
    '- It runs again on every full page load, and only then. The chat site is a single-page app: opening another conversation or a new chat does not reload the page, so watch for that yourself (compare location.pathname on a timer, or observe a container the site keeps).',
    '- Turning the plugin off takes effect when the page reloads. Keep changes additive and give every element you add a gv-plugin-<name> class.',
    '',
    '## Rules',
    '',
    '- Never observe your own DOM changes: ignore mutations of nodes you added, or disconnect while you write, and debounce. Voyager disconnects a MutationObserver whose callback runs more than 200 times in a second, and raises any setInterval delay below 50 ms to 50 ms.',
    '- No network: no fetch, XMLHttpRequest, WebSocket, remote images, fonts or scripts, no eval, new Function or code from strings. The plugin’s world blocks its own requests; do not try to get around it.',
    '- Change the page through the DOM: create elements and set textContent, never innerHTML (some sites enforce Trusted Types).',
    '- Read the page’s text only for what the request needs, and keep it on the page. To remember something across visits, use one localStorage key named after the plugin.',
    '- Write clean, readable source: the user reads all of it before turning the plugin on. One comment line at the top saying what it does, short functions, plain names, no minified or obfuscated code.',
    '- Find elements with the selectors below where one fits (they can change when the site is redesigned), and handle their absence: return quietly when an element is missing.',
    '',
    '## Where it runs',
    '',
    `The user needs ${SCRIPTED_REQUIREMENT}. Voyager walks them through the toggle. Elsewhere (Safari, Firefox, phones) the plugin installs paused. Before the json block, say in one line that this plugin runs code and needs that toggle.`,
    '',
    '## Selectors Voyager uses on each site',
    '',
    ...sites.flatMap(selectorLines),
    '',
    `## Example (for ${site.label}; use your create page’s "matches")`,
    '',
    ...renderExample(buildScriptedExample(site), 3),
    '## Reply format',
    '',
    'Exactly one fenced code block labeled json with the complete manifest, as the create page says.',
    '',
  ].join('\n');
}
