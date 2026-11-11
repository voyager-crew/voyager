/**
 * The steps a coding agent follows around the contract: scaffold, edit,
 * check offline, hand the files to the user to import. Shared by the public
 * SKILL.md and the scaffold's AGENTS.md so both name the same commands.
 */
import type { ContractSection } from './contractRules';
import { PLUGIN_CLI_PACKAGE } from './skillLink';

const CLI = `npx ${PLUGIN_CLI_PACKAGE}@latest`;

export interface WorkflowOptions {
  /** The plugin folder already exists (AGENTS.md lives in it). */
  readonly scaffolded: boolean;
  /** The `--site` values, comma separated. */
  readonly siteIds: string;
}

export function authoringWorkflowSection(options: WorkflowOptions): ContractSection {
  const scaffold = options.scaffolded
    ? [
        '1. This folder was made by `create-voyager-plugin init`: plugin.json and style.css are a working starting point.',
      ]
    : [
        '1. Find out which site the change is for and what should change. Then scaffold a folder:',
        `   \`${CLI} init my-plugin --site <site>\` (site: ${options.siteIds}) writes plugin.json, style.css and an AGENTS.md with this contract for that site. Without Node, write the two files by hand from the examples below.`,
      ];
  return {
    title: 'Workflow',
    lines: [
      ...scaffold,
      '2. Edit plugin.json and style.css for the request. Give the plugin its own "id", "name" and class names.',
      `3. Run \`${CLI} check ${options.scaffolded ? '.' : 'my-plugin'}\`. It runs the same checks as Voyager’s popup import, offline, and exits 0 only when the plugin would import. Fix every \`path: message\` line it prints and run it again. \`--json\` prints the issues as a JSON array of { path, message }, empty when it imports.`,
      '4. Hand over to the user: open the target site, open the Voyager popup, find the "My creations" card (on Gemini and AI Studio it sits right below Cloud Sync, and the "Jump to" links at the top lead to it), open "More ways to add", choose Import files and pick plugin.json together with style.css. The plugin lands switched off; the user turns it on in the plugin list. Re-importing the same "id" replaces the installed version (raise "version" when you change it).',
      '5. Ask the user to look at the page in both light and dark theme. If a selector matches nothing, see "Finding selectors".',
    ],
  };
}
