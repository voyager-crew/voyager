import { useMemo, useRef, useState } from 'react';

import { previewPlugin } from '@/features/plugins/local/pluginPreview';
import { type CheckedPluginReply, checkPluginReply } from '@/features/plugins/local/pluginReply';
import type { SiteAdapter } from '@/features/plugins/types';

import type { LocalPluginsController } from './useLocalPlugins';

/**
 * A pasted AI reply → the local plugin gate → a plain-language preview → an
 * import of exactly the object previewed. The popup closes while the user is
 * in their AI tab, so this works on its own in a fresh popup.
 */
export function usePluginReplyReview(
  local: LocalPluginsController,
  targetSite: SiteAdapter | null,
) {
  const [reply, setReply] = useState('');
  const [checked, setChecked] = useState<CheckedPluginReply | null>(null);
  const [checking, setChecking] = useState(false);
  const [details, setDetails] = useState(false);
  const [changedSinceReview, setChangedSinceReview] = useState(false);
  const checkRun = useRef(0);

  const preview = useMemo(
    () =>
      checked?.ok
        ? previewPlugin(checked.manifest, {
            previousVersion: checked.previousVersion,
            targetSite,
          })
        : null,
    [checked, targetSite],
  );

  const changeReply = (value: string): void => {
    checkRun.current += 1;
    setReply(value);
    setChecked(null);
    setChecking(false);
    setDetails(false);
    setChangedSinceReview(false);
  };

  /** Check the reply on screen; false when an edit or a newer check superseded it. */
  const checkReply = async (): Promise<boolean> => {
    const run = (checkRun.current += 1);
    local.clearResult();
    setChangedSinceReview(false);
    setChecking(true);
    let outcome: CheckedPluginReply;
    try {
      outcome = await checkPluginReply(reply);
    } catch (error) {
      outcome = {
        ok: false,
        issues: [{ path: '', message: error instanceof Error ? error.message : String(error) }],
      };
    }
    if (run !== checkRun.current) return false;
    setChecked(outcome);
    setChecking(false);
    return true;
  };

  /** Close the preview; like an edit, it starts a new run so no pending result reopens it. */
  const dismissPreview = (): void => {
    checkRun.current += 1;
    // A superseded check returns before clearing this, so the dismiss clears it.
    setChecking(false);
    setChecked(null);
    setDetails(false);
    setChangedSinceReview(false);
  };

  const importPreviewed = async (): Promise<void> => {
    if (!checked?.ok) return;
    // Every edit or check bumps the run. If the reply changed while the import
    // ran, this outcome belongs to a reply no longer on screen: leave the new
    // one alone. A refusal wrote nothing, so it is not shown under the new reply
    // either; a finished import is still reported.
    const run = checkRun.current;
    const outcome = await local.importManifest(checked.raw, checked.installed);
    if (run !== checkRun.current) {
      if (!outcome.ok) local.clearResult();
      return;
    }
    if (outcome.ok) {
      changeReply('');
    } else if (outcome.changedSinceReview) {
      // Nothing was written: refresh the preview against what is installed now.
      if (await checkReply()) setChangedSinceReview(true);
    }
  };

  return {
    reply,
    changeReply,
    checked,
    checking,
    preview,
    details,
    toggleDetails: () => setDetails((value) => !value),
    changedSinceReview,
    checkReply,
    dismissPreview,
    importPreviewed,
  };
}

export type PluginReplyReview = ReturnType<typeof usePluginReplyReview>;
