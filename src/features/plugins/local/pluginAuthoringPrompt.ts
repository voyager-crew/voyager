/**
 * The self-contained prompt for "describe a change in one sentence": the user
 * copies it into any AI they choose, and pastes the reply back into the popup
 * (`pluginReply.ts`). Voyager itself never sends, opens or reads anything.
 *
 * The contract is `buildPluginContract(site, { audience: 'chat' })`, the same
 * one the scaffold's AGENTS.md and the public SKILL.md are rendered from: CSS
 * inlined (the reply is pasted), primitives wherever the site allows them, no
 * theme (the preview flags it), settings allowed. Its examples are asserted to
 * pass `validateLocalManifest` in tests, so the prompt cannot drift from what
 * imports. An AI that can browse is pointed at the public skill too, but the
 * prompt stays complete on its own and wins where the two differ.
 *
 * The text is machine-facing and stays in English; it asks for `name` and
 * `description` in the language of the user's request.
 */
import type { SiteAdapter } from '../types';
import { buildPluginContract, renderExample, renderSections } from './authoring/pluginContract';
import { WRITE_PLUGIN_SKILL_URL } from './authoring/skillLink';

export {
  AUTHORING_OP_KINDS,
  AUTHORING_OP_TEMPLATES,
  type AuthoringOpKind,
  buildPluginExample,
} from './authoring/pluginExamples';
export { siteAnchors } from './authoring/siteFacts';
export { MAX_PLUGIN_REQUEST_CHARS, authoringSiteForUrl, authoringSites } from './authoringSites';

/** The full prompt for one request and target site. */
export function buildPluginAuthoringPrompt(request: string, site: SiteAdapter): string {
  const contract = buildPluginContract(site, { audience: 'chat' });
  return [
    'Write a Voyager local plugin for the request below. Voyager is a browser extension that',
    'applies a declarative JSON manifest (CSS plus reversible page changes) to a web page. It runs',
    'the manifest through a strict validator, so follow this contract exactly.',
    '',
    // The online skill is the latest release's; the pasted contract is the user's installed build.
    `If you can open web pages, the full reference behind this contract is ${WRITE_PLUGIN_SKILL_URL}.`,
    'It is optional: this prompt is complete. That page is written for coding agents, so skip its',
    'scaffold and check steps and its style.css files, and still reply as this prompt asks. It follows',
    `the latest Voyager release, while this prompt matches the user's (plugin engine ${contract.engineVersion}): where the two differ, follow this prompt.`,
    '',
    'The request, verbatim between the markers:',
    '----- BEGIN REQUEST -----',
    request.trim(),
    '----- END REQUEST -----',
    '',
    ...renderSections(contract.sections),
    '## Valid examples (adapt one; do not copy its purpose)',
    '',
    ...contract.examples.flatMap((example) => renderExample(example)),
    '## Reply format',
    'Reply with exactly one ```json fenced code block that holds the complete manifest. Put no',
    'other code block in the reply.',
    '',
  ].join('\n');
}
