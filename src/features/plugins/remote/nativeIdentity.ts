import type { NativeOperation, PluginManifest } from '../types';

const TIMELINE_IDENTITY_PARAMS = [
  'dataBackend',
  'conversationIdPattern',
  'conversationIdAttribute',
  'accountIdAttributes',
] as const;

/** Remote locators cannot redirect stars/account ownership through a native op's parameters. */
export function protectRemoteNativeIdentity(
  remote: PluginManifest,
  bundled?: PluginManifest,
): PluginManifest {
  const bundledOps = (bundled?.contributes.domOps ?? []).filter(
    (op): op is NativeOperation => op.op === 'native' && op.handler === 'turnNavigator',
  );
  let index = 0;
  let changed = false;
  const domOps = remote.contributes.domOps?.map((op) => {
    if (op.op !== 'native' || op.handler !== 'turnNavigator') return op;
    const original = bundledOps[index++]?.params ?? {};
    const params = { ...op.params };
    let opChanged = false;
    for (const key of TIMELINE_IDENTITY_PARAMS) {
      if (Object.hasOwn(original, key)) {
        if (JSON.stringify(params[key]) === JSON.stringify(original[key])) continue;
        params[key] = original[key];
      } else {
        if (!Object.hasOwn(params, key)) continue;
        delete params[key];
      }
      opChanged = true;
    }
    changed ||= opChanged;
    return opChanged ? { ...op, params } : op;
  });
  return changed ? { ...remote, contributes: { ...remote.contributes, domOps } } : remote;
}
