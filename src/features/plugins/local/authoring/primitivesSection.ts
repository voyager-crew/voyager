/**
 * The Primitives section of the plugin contract: every primitive a plugin on
 * one site may call, with its params, read through `primitiveReference.ts`.
 * Primitives whose params are identical (the diagram renderers) print them
 * once and point back, so the list grows by one line, not by a copy.
 */
import { NATIVE_PARAM_SETTINGS_SINCE_ENGINE } from '../../manifest/nativeParamSettings';
import type { SiteAdapter } from '../../types';
import type { ContractSection } from './contractRules';
import { type PrimitiveParamReference, listPrimitiveReferences } from './primitiveReference';
import { allowsPrimitive } from './siteFacts';

/** What a primitive needs said beyond its contract, wherever it is offered. */
const PRIMITIVE_NOTES: Readonly<Record<string, string>> = {
  // `runtime/resourceClaims.ts`: the send-key mode is one per page on every site.
  sendShortcut:
    'It claims one composer send mode for the entire page: while one plugin holds it, another reports a conflict and stays paused; turn the holder off to hand the mode over.',
};

export const PRIMITIVES_TITLE = 'Primitives';

/** The names of the primitives a plugin on `site` may call, sorted. */
export function offeredPrimitiveNames(site: SiteAdapter): string[] {
  return listPrimitiveReferences()
    .filter((primitive) => allowsPrimitive(site, primitive.name))
    .map((primitive) => primitive.name);
}

function paramLine(param: PrimitiveParamReference): string {
  const since = param.sinceEngine ? `, since ${param.sinceEngine}` : '';
  const required = param.required ? ', required' : '';
  const keys = param.allowedKeys ? `, one of ${param.allowedKeys.join(', ')}` : '';
  return `  - ${param.name} (${param.type}${required}${keys}${since}): ${param.description}`;
}

/** The primitives a plugin on `site` may call, with their params. */
export function primitivesSection(site: SiteAdapter): ContractSection {
  const all = listPrimitiveReferences();
  const offered = all.filter((primitive) => allowsPrimitive(site, primitive.name));
  const offeredNames = new Set(offered.map((primitive) => primitive.name));
  const lines: string[] = [
    `A primitive is behavior Voyager ships as code; a plugin can only call it by name and configure it: { "op": "native", "handler": "<name>", "params": { … } }. A param marked required must be set; every other param is optional. A semanticKey param names a semantic key (only the listed ones when it says "one of"); every matched site must declare it, as with the keys a primitive reads, so it need not be repeated in "requires.semantic". Set "engine" to ">=" the primitive’s sinceEngine (and any param’s).${offered.length < all.length ? ` Only the primitives below run on ${site.label}.` : ''}`,
    `- To pass a setting into params, write "{{key}}" in a string value, also inside objects and arrays; param names and object keys stay literal. A whole-value token keeps the setting's number, boolean or string type; embedded "a{{key}}b" produces a string. Set "engine" to ">=${NATIVE_PARAM_SETTINGS_SINCE_ENGINE}", or higher when a primitive or param needs it.`,
    '- Every referenced key must exist in contributes.settings with a type that fits the param; the import checks the params with each default substituted. Keep a setting’s range or options inside what the param accepts: a stored value the primitive refuses skips the op.',
    ...(offeredNames.has('turnNavigator')
      ? [
          '- Example: turnNavigator params { "position": "{{side}}" } with a select setting side whose options are left and right.',
        ]
      : []),
    '',
  ];
  const printed: { readonly name: string; readonly params: string }[] = [];
  for (const primitive of offered) {
    const reads = primitive.semantic.length > 0 ? ` Reads: ${primitive.semantic.join(', ')}.` : '';
    const note = PRIMITIVE_NOTES[primitive.name] ? ` ${PRIMITIVE_NOTES[primitive.name]}` : '';
    lines.push(
      `- ${primitive.name} (sinceEngine ${primitive.sinceEngine}): ${primitive.description}${reads}${note}`,
    );
    const params = JSON.stringify(primitive.params);
    // A single shared param reads better printed than pointed at.
    const same = primitive.params.length > 1 && printed.find((entry) => entry.params === params);
    if (same) {
      lines.push(`  Takes the same params as ${same.name}.`);
      continue;
    }
    printed.push({ name: primitive.name, params });
    lines.push(...primitive.params.map(paramLine));
  }
  return { title: PRIMITIVES_TITLE, lines };
}
