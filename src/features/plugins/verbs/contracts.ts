/**
 * Primitive ("verb") contracts — DATA ONLY (plan §2 layer 2, §5).
 *
 * A primitive is first-party behaviour shipped inside the extension that a
 * declarative plugin can invoke through `{ "op": "native", "handler": "<name>",
 * "params": {…} }`. This module lists what each primitive is called, which
 * engine version first shipped it and what parameters it accepts, without
 * importing any implementation, so that:
 *   - `scripts/build-plugin-catalog.ts` (Bun, no DOM) can check a manifest's
 *     `requires.handlers` and `engine` against it (plan §5, §8);
 *   - `verbs/contracts.test.ts` can enforce D9 (a published parameter never
 *     changes type or becomes required) against a committed baseline.
 *
 * Rules (plan D9): parameters are only ever added, and only as optional; a
 * breaking change ships under a NEW primitive name.
 */
import type { SemanticSelectorKey } from '../sites/semanticKeys';

export type PrimitiveParamType = 'string' | 'string[]' | 'number' | 'boolean' | 'selector';

export interface PrimitiveParamSpec {
  readonly type: PrimitiveParamType;
  readonly required: boolean;
  readonly description: string;
  /**
   * Engine version that added the param, when later than its primitive's
   * `sinceEngine`. An older engine rejects an unknown param and skips the whole
   * op, so a manifest setting it needs an `engine` floor at least this high.
   */
  readonly sinceEngine?: string;
}

export interface PrimitiveContract {
  readonly name: string;
  /** Engine version that first shipped the primitive; `engine` of any manifest using it must be ≥ this. */
  readonly sinceEngine: string;
  /** Semantic keys the primitive reads from the site adapter (unless a param overrides them). */
  readonly semantic: readonly SemanticSelectorKey[];
  readonly params: Readonly<Record<string, PrimitiveParamSpec>>;
  readonly description: string;
}

export const PRIMITIVE_NAME_PATTERN = /^[a-z][a-zA-Z0-9]{1,39}$/;

export const PRIMITIVE_CONTRACTS: readonly PrimitiveContract[] = [
  {
    name: 'formulaCopy',
    sinceEngine: '1.3.0',
    semantic: [],
    params: {},
    description:
      'Click an inline or block formula to copy its LaTeX; hover shows it is clickable. Reads KaTeX / MathJax markup on the page.',
  },
  {
    name: 'vimInput',
    sinceEngine: '1.4.0',
    semantic: ['composer'],
    params: {
      composer: {
        type: 'selector',
        required: false,
        description:
          "Prompt input to attach Vim modal editing to; defaults to the site adapter's composer.",
      },
    },
    description: 'Vim-style modal editing and cursor navigation in the prompt composer.',
  },
  {
    name: 'turnNavigator',
    sinceEngine: '1.4.0',
    semantic: ['userTurn'],
    params: {
      turn: {
        type: 'selector',
        required: false,
        description: "User-turn elements to index; defaults to the site adapter's userTurn.",
      },
      conversationIdAttribute: {
        type: 'string',
        required: false,
        sinceEngine: '1.5.0',
        description:
          'Attribute holding the conversation id that conversationIdPattern captures from the URL, on an ancestor of each turn or inside its turnItem. When set, it is the only thing that lets a turn be starred: the id must name the current conversation; a turn without one stays unstarrable.',
      },
      accountIdAttributes: {
        type: 'string[]',
        required: false,
        sinceEngine: '1.5.0',
        description:
          'Ordered attributes on document.documentElement identifying the loaded account. Stars hash their values together; missing values leave the star untagged.',
      },
      turnItem: {
        type: 'selector',
        required: false,
        sinceEngine: '1.5.0',
        description:
          'Element wrapping one exchange (prompt and reply). conversationIdAttribute is looked up inside it when no ancestor of the turn carries it.',
      },
      conversationIdPattern: {
        type: 'string',
        required: false,
        description:
          "Path regular expression whose first group is the conversation id, used only where the site adapter defines no conversationIdPattern: the adapter's pattern keys stars everywhere they are read.",
      },
      scrollContainer: {
        type: 'selector',
        required: false,
        description:
          "Element that scrolls the conversation; defaults to the site adapter's scrollContainer, else auto-detected.",
      },
      yieldWhen: {
        type: 'selector',
        required: false,
        description:
          'While this matches (an open side panel, an artifact frame), the onboarding guide stays closed.',
      },
      position: {
        type: 'string',
        required: false,
        description: 'Rail side: "right" (default) or "left".',
      },
    },
    description:
      'A compact conversation timeline with starred messages and search, built on the same code as the Claude timeline.',
  },
];

export function getPrimitiveContract(name: string): PrimitiveContract | undefined {
  return PRIMITIVE_CONTRACTS.find((contract) => contract.name === name);
}
