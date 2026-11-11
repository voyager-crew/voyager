/**
 * The scripted tier in the authoring material: the short section every output
 * carries. The shared chat page it points at is `scriptedPage.ts`.
 * Only Create mode installs a scripted plugin: a chat AI writes it, the user
 * reads its source in the review, and `create-voyager-plugin check` (the
 * coding agent's gate) refuses the tier, so the agent outputs say so instead
 * of teaching it.
 */
import {
  ALLOW_USER_SCRIPTS_TOGGLE_CHROME,
  USER_SCRIPTS_MIN_CHROME,
} from '../../scripted/availability';
import type { ContractAudience, ContractSection } from './contractRules';
import { CREATE_PAGE_BASE_URL } from './skillLink';

export const SCRIPTED_PAGE_FILE = 'scripted.md';
export const SCRIPTED_PAGE_URL = `${CREATE_PAGE_BASE_URL}${SCRIPTED_PAGE_FILE}`;
export const SCRIPTED_TITLE = 'Plugins that run code';

export const SCRIPTED_REQUIREMENT = `desktop Chrome or Edge ${USER_SCRIPTS_MIN_CHROME} or later, with "Allow User Scripts" turned on for Voyager on its details page in chrome://extensions (Developer mode before Chrome ${ALLOW_USER_SCRIPTS_TOGGLE_CHROME})`;

/** What every output says about the scripted tier; the chat pages point at the shared page. */
export function scriptedSection(
  audience: ContractAudience,
  { primitives }: { primitives: boolean },
): ContractSection {
  const declarative = primitives
    ? 'CSS, the page changes and the primitives'
    : 'CSS and the page changes';
  if (audience === 'chat') {
    return {
      title: SCRIPTED_TITLE,
      lines: [
        `A scripted plugin carries JavaScript for behavior ${declarative} cannot give, such as reacting to clicks, counting or remembering something across visits. Read ${SCRIPTED_PAGE_URL} when the request needs such behavior, before answering NOT POSSIBLE. Use the declarative tier whenever it suffices: a scripted plugin needs ${SCRIPTED_REQUIREMENT}, and the user reads all of its code before turning it on.`,
      ],
    };
  }
  return {
    title: SCRIPTED_TITLE,
    lines: [
      `Voyager also has a scripted tier (JavaScript run through Chrome's userScripts API), but only Create mode makes one for now: the user asks in Voyager's panel (Create tab) on the chat site, the chat AI writes it from ${SCRIPTED_PAGE_URL}, and Voyager shows its full source before it can be turned on. \`create-voyager-plugin check\` refuses "tier": "scripted", so write declarative plugins here. When only code would do, say so in your NOT POSSIBLE line and point the user to Create mode.`,
    ],
  };
}
