/**
 * Primitive ("verb") contracts — DATA ONLY (D9).
 *
 * A primitive is first-party behaviour shipped inside the extension that a
 * declarative plugin can invoke through `{ "op": "native", "handler": "<name>",
 * "params": {…} }`. Each `verbs/<name>/contract.ts` states what it is called,
 * which version first shipped it and what parameters it accepts; this
 * module collects them, sorted by name, without importing any implementation,
 * so that:
 *   - `scripts/build-plugin-catalog.ts` (Bun, no DOM) can check a manifest's
 *     `requires.handlers` and `engine` against it (D9);
 *   - `verbs/contracts.test.ts` can enforce D9 (a published parameter never
 *     changes type or becomes required) against each folder's committed
 *     `paramsBaseline.json`.
 *
 * Adding a primitive is adding its folder; nothing here lists them.
 */
import { PLUGIN_ENGINE_VERSION } from '../constants';
import { resolveEngineVersion } from '../engineVersion';
import { PRIMITIVE_CONTRACT_MODULES } from './contractModules';
import type { PrimitiveContract } from './contractTypes';
import { loadPrimitiveContracts } from './loadContracts';

export type {
  PrimitiveContract,
  PrimitiveParamSpec,
  PrimitiveParamType,
  PrimitiveSiteSection,
} from './contractTypes';
export { PRIMITIVE_NAME_PATTERN } from './contractTypes';

/** Source declarations retain `next` so release tooling and D9 can distinguish drafts. */
export const SOURCE_PRIMITIVE_CONTRACTS: readonly PrimitiveContract[] = loadPrimitiveContracts(
  PRIMITIVE_CONTRACT_MODULES,
);

/** A development tree with `next` declarations runs the coming release; a stamped release runs its own version. */
export const EFFECTIVE_PLUGIN_ENGINE_VERSION = SOURCE_PRIMITIVE_CONTRACTS.some(
  (contract) =>
    contract.sinceEngine === 'next' ||
    Object.values(contract.params).some((param) => param.sinceEngine === 'next'),
)
  ? resolveEngineVersion('next')
  : PLUGIN_ENGINE_VERSION;

export const PRIMITIVE_CONTRACTS: readonly PrimitiveContract[] = SOURCE_PRIMITIVE_CONTRACTS.map(
  (contract) => ({
    ...contract,
    sinceEngine: resolveEngineVersion(contract.sinceEngine),
    params: Object.fromEntries(
      Object.entries(contract.params).map(([name, param]) => [
        name,
        param.sinceEngine
          ? { ...param, sinceEngine: resolveEngineVersion(param.sinceEngine) }
          : param,
      ]),
    ),
  }),
);

export function getPrimitiveContract(name: string): PrimitiveContract | undefined {
  return PRIMITIVE_CONTRACTS.find((contract) => contract.name === name);
}
