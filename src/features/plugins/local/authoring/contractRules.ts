/**
 * The site-independent rules of a local plugin, as text sections. Required
 * fields, op kinds, the attribute allowlist and setting kinds are read from
 * the gate's own exports (primitives likewise, in `primitivesSection.ts`), so
 * this text cannot offer something the import refuses. `audience` picks how the reader works: `chat` is an AI in a
 * chat tab whose reply the user pastes (CSS inlined, no "theme"), `agent` is a
 * coding agent with a file system that runs `create-voyager-plugin check`.
 * Primitives depend on the site, not the audience: both get them wherever the
 * gate accepts a `native` op.
 */

import { ALLOWED_ATTRIBUTE_NAMES, ALLOWED_ATTRIBUTE_PREFIXES } from '../../manifest/sinkGuards';
import { REQUIRED_STRINGS } from '../../manifest/validate';
import type { SemanticSelectorKey } from '../../sites/semanticKeys';
import { PLUGIN_CATEGORIES } from '../../types';
import { EFFECTIVE_PLUGIN_ENGINE_VERSION } from '../../verbs/contracts';
import { LOCAL_PLUGIN_ID_PREFIX } from '../localPluginId';
import { LOCAL_SETTING_TYPES } from '../localPluginRules';
import { inlineJson } from './jsonText';
import { AUTHORING_OP_KINDS, AUTHORING_OP_TEMPLATES } from './pluginExamples';

export type ContractAudience = 'chat' | 'agent';

export interface ContractSection {
  readonly title: string;
  readonly lines: readonly string[];
}

/**
 * Where the rules point the reader for per-site facts and the primitive list.
 * One document (chat prompt, scaffold AGENTS.md) has both as sections; the
 * public skill keeps them in files beside SKILL.md.
 */
export interface ContractRefs {
  readonly sites: string;
  readonly primitives: string;
}

export const IN_DOCUMENT_REFS: ContractRefs = {
  sites: 'the target site section',
  primitives: 'the Primitives list above',
};

/** The setAttribute names the gate allows, as the text lists them. */
export function allowedAttributeText(): string {
  return [
    ...ALLOWED_ATTRIBUTE_NAMES,
    ...ALLOWED_ATTRIBUTE_PREFIXES.map((prefix) => `${prefix}*`),
  ].join(', ');
}

export function manifestSection(
  audience: ContractAudience,
  refs: ContractRefs = IN_DOCUMENT_REFS,
): ContractSection {
  return {
    title: 'Manifest contract',
    lines: [
      `- Required non-empty string fields: ${REQUIRED_STRINGS.join(', ')}. Also "tier": "declarative", "matches" (see ${refs.sites}) and "contributes".`,
      `- "id": a short lowercase reverse-dotted slug such as "me.short-name" (a-z, 0-9, ".", "_", "-"). Voyager stores it as "${LOCAL_PLUGIN_ID_PREFIX}<id>"; you do not add that prefix.`,
      '- "version": "1.0.0"; raise it when you change the plugin. "author": "me". "license": "MIT".',
      `- "engine": ">=1.0.0", or ">=" the sinceEngine of every primitive the plugin uses. This build's plugin engine is ${EFFECTIVE_PLUGIN_ENGINE_VERSION}.`,
      `- "category": one of ${PLUGIN_CATEGORIES.join(', ')}.`,
      `- Write "name" and "description" in the language of the ${audience === 'chat' ? 'request' : 'user'}. "i18n" translations are optional for a local plugin.`,
      ...(audience === 'agent'
        ? [
            '- Optional: "$schema": "https://voyager.nagi.fun/plugin.schema.json" lets an editor check the file as you type. The import gate is stricter than the schema; `check` is the authority.',
          ]
        : []),
    ],
  };
}

export function stylesSection(audience: ContractAudience): ContractSection {
  return {
    title: 'Styles',
    lines: [
      ...(audience === 'agent'
        ? [
            '- "contributes.styles": [{ "file": "style.css" }] with the CSS in style.css beside plugin.json. The popup’s Import files takes exactly one .json file: the user picks plugin.json and its .css files, nothing else. Paste JSON only takes inlined CSS ([{ "css": "..." }]).',
          ]
        : ['- "contributes.styles": a list of { "css": "..." } with the CSS inlined as a string.']),
      '- CSS may not load anything, not even from the same site: no @import, image-set(), image(), cross-fade() or src(), and url() only with a #fragment or a png, jpeg, gif, webp or avif data: URI (never SVG). No web fonts, no remote images.',
      '- Scope every rule under a class your plugin adds (see addClass), so nothing else changes. Site styles often win on specificity: add !important where a rule does not apply.',
      "- Light or dark only rules: scope them with html[data-gv-scheme='dark'] or html[data-gv-scheme='light'], never with the site's own theme classes.",
    ],
  };
}

export function pageChangesSection(
  templateKey: SemanticSelectorKey,
  { primitives }: { primitives: boolean },
): ContractSection {
  const target = { kind: 'semantic', key: templateKey } as const;
  const native = primitives ? ', and "native" where the site allows primitives' : '';
  return {
    title: 'Page changes',
    lines: [
      `- "contributes.domOps": reversible page changes. Allowed "op" values: ${AUTHORING_OP_KINDS.join(', ')}${native}. Voyager applies them to every match, again as the page changes, and removes them when the plugin is turned off. One example of each:`,
      ...AUTHORING_OP_KINDS.map(
        (kind) => `  - ${kind}: ${inlineJson(AUTHORING_OP_TEMPLATES[kind](target))}`,
      ),
      '- "target": prefer { "kind": "semantic", "key": <anchor> } with an anchor the target site declares. Use a plain CSS selector string only for something no anchor names; it breaks on a redesign.',
      '- addClass "className": exactly one class that starts with "gv-"; use "gv-plugin-<plugin-name>". Then style that class in "contributes.styles".',
      `- setAttribute "name" must be one of: ${allowedAttributeText()}. Never href, src, on*, class or id. Values may not contain an external URL.`,
      '- setStyle "styles": CSS property -> value, custom properties (--gv-…) included; values may not load anything either. A value may end in !important; engines before 1.9.0 drop such a value, so require engine ">=1.9.0" when the plugin relies on it.',
    ],
  };
}

export function settingsSection(): ContractSection {
  return {
    title: 'Settings (optional)',
    lines: [
      `- "contributes.settings": { "<key>": { "type", "label", "default", … } }. Types: ${LOCAL_SETTING_TYPES.join(', ')}. string and color settings are refused: the popup has no control for them yet.`,
      '- number: the popup shows a slider from "min" to "max" (0 and 100 when omitted), with optional "minLabel" and "maxLabel" at its ends.',
      '- select: "options": [{ "value": "…", "label": "…" }] with at least one option and unique values, and a "default" that is one of the values.',
      '- Optional "enabledBy": "<booleanKey>" keeps a number, select or boolean control visible but disabled unless that other boolean setting of the same plugin resolves to true. That boolean has no enabledBy of its own (one level only). It changes only the popup control, so gate page behavior with the boolean too. It needs no higher engine floor: engine 1.7.0 just leaves the control enabled.',
      '- Use a setting through a {{key}} token in CSS text, a setStyle value or a setAttribute value; Voyager substitutes the current value (the default until the user changes it). A common pattern: setStyle sets a custom property from the setting, and the CSS reads var(...).',
      '- A boolean renders as "true" or "false": set data-gv-… to "{{key}}" with setAttribute and style [data-gv-…=\'true\'].',
    ],
  };
}

export function localRulesSection(
  audience: ContractAudience,
  { primitives, refs = IN_DOCUMENT_REFS }: { primitives: boolean; refs?: ContractRefs },
): ContractSection {
  return {
    title: 'Local plugin rules',
    lines: [
      `- "matches" may only use the URL patterns of a site Voyager supports (see ${refs.sites}).`,
      '- Every semantic key the plugin relies on must be declared by every site its "matches" cover.',
      '- On Gemini and AI Studio: no "theme", and a "native" op only for the primitives listed for that site (Voyager runs its other features there itself).',
      ...(audience === 'agent'
        ? [
            '- "theme": { "brand": "#rrggbb" } optionally recolors Voyager’s own UI on Claude, ChatGPT, DeepSeek or Kimi. "requires" is optional: native ops already imply "requires.handlers". "requires.formFactors" defaults to ["desktop", "mobile"]; write ["desktop"] only for a plugin that cannot work on a phone.',
            '- The site-check route fields ("routeWords", "accountSlots", "conversationRoutes") and the Prompt Manager "prompt" section come only from Voyager’s packaged site.json, so a local plugin cannot set them.',
          ]
        : primitives
          ? [
              '- Do not add "theme", "requires", links or JavaScript. A "native" op may only call a primitive listed under Primitives.',
            ]
          : ['- Do not add "theme", "requires", any "native" op, links or JavaScript.']),
      '- An import lands switched off; the user reviews it and turns it on in the popup.',
    ],
  };
}

export function selectorsSection(): ContractSection {
  return {
    title: 'Finding selectors',
    lines: [
      '- Use a semantic anchor whenever one names the element. Otherwise ask the user to open the site, press F12 and inspect the element in the Elements panel.',
      "- Have them test a selector in the Console: document.querySelectorAll('<selector>').length should count what you expect (for example one per message); 0 means it is wrong.",
      '- Prefer data-testid, aria-*, role and stable element names. Avoid generated class names (hashes such as css-1x2y3z): they change with every site deploy.',
      '- Do not guess selectors you cannot verify: tell the user which ones to check.',
    ],
  };
}

const IMPOSSIBLE = [
  'run JavaScript or any code of its own: no event handlers, clicks, timers or keyboard shortcuts',
  'make network requests or load anything: remote images, fonts, stylesheets or scripts',
  'read, rewrite or translate what a message says, or store and sync data beyond its own settings',
  'add buttons or links that do something, open pages, download or copy (CSS ::before and ::after can add fixed text)',
  'decide by message content: logic, conditions or counting beyond what CSS selectors such as :has() and :nth-child() express',
  'run on sites other than those listed, or change Voyager’s own settings',
];

export function impossibleSection(
  audience: ContractAudience,
  { primitives, refs = IN_DOCUMENT_REFS }: { primitives: boolean; refs?: ContractRefs },
): ContractSection {
  return {
    title: 'What a plugin cannot do',
    lines: [
      ...IMPOSSIBLE.map((item) => `- It cannot ${item}.`),
      '',
      // Without this, an agent reading the list answers NOT POSSIBLE for a copy button or count badge a primitive ships.
      ...(primitives
        ? [
            `These limits are on the plugin’s own fields and CSS. A primitive in ${refs.primitives} runs Voyager’s code and may provide one of them (a copy button, a count, a saved draft, a quote into the composer…): read that list before answering NOT POSSIBLE, and use the primitive when the target site declares the keys it reads.`,
          ]
        : []),
      'If the request needs any of this, do not invent fields or ops: the import refuses them. Start your reply with one line "NOT POSSIBLE: <what and why>", then build the closest version this contract allows and say what it leaves out.',
      audience === 'chat'
        ? 'Give that version in the one ```json block; reply with no block only when nothing declarative helps.'
        : 'When nothing declarative helps, stop there and write no files.',
    ],
  };
}
