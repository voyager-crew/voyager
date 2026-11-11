import { isUserEvent } from '@/core/utils/userEvent';
import { isScriptedManifest } from '@/features/plugins/scripted/types';
import type { TranslationKey } from '@/utils/translations';

import { Button } from '../../../components/ui/button';
import type { LocalPluginsController } from '../hooks/useLocalPlugins';
import type { PluginReplyReview } from '../hooks/usePluginReplyReview';
import type { ScriptedCreations } from '../hooks/useScriptedCreations';
import { LocalPluginInspection } from './LocalPluginInspection';
import { LocalPluginIssueList } from './LocalPluginIssueList';
import { LocalPluginPreviewSummary, POPUP_PREVIEW_LOOK } from './LocalPluginPreviewSummary';
import { LOCAL_PLUGIN_FIELD_CLASS } from './localPluginFieldClass';
import { REPLY_PROBLEM_KEYS } from './localPluginPreviewText';
import { ScriptedSetupCard } from './scripted/ScriptedSetupCard';
import { POPUP_SCRIPTED_LOOK } from './scripted/scriptedLook';

/** Paste the AI's reply, check it, read what it does, and import exactly that. */
export function LocalPluginReplyCheck({
  review,
  local,
  scripted,
  t,
}: {
  review: PluginReplyReview;
  local: LocalPluginsController;
  scripted: ScriptedCreations;
  t: (key: TranslationKey) => string;
}) {
  const { checked, preview } = review;
  const runsCode = checked?.ok === true && isScriptedManifest(checked.manifest);
  const cannotRun = runsCode && scripted.status?.availability.kind === 'unsupported';
  return (
    <div className="space-y-2" data-testid="local-plugin-reply">
      <label className="block space-y-1">
        <span className="text-xs font-medium">{t('localPluginDescribeReplyLabel')}</span>
        <textarea
          value={review.reply}
          rows={3}
          dir="ltr"
          spellCheck={false}
          placeholder={t('localPluginDescribeReplyPlaceholder')}
          onChange={(event) => review.changeReply(event.target.value)}
          className={`${LOCAL_PLUGIN_FIELD_CLASS} font-mono`}
        />
      </label>
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          disabled={review.checking || local.busy || review.reply.trim() === ''}
          onClick={() => void review.checkReply()}
        >
          {t('localPluginDescribeCheck')}
        </Button>
      </div>

      {checked && !checked.ok && (
        <div
          className="text-destructive text-[11px]"
          role="alert"
          data-testid="local-plugin-reply-error"
        >
          {'problem' in checked ? (
            <p>{t(REPLY_PROBLEM_KEYS[checked.problem])}</p>
          ) : (
            <>
              <p>{t('localPluginsRejected')}</p>
              <LocalPluginIssueList issues={checked.issues} />
            </>
          )}
        </div>
      )}

      {review.changedSinceReview && (
        <p className="text-warning text-[11px]" role="alert">
          {t('localPluginChangedSinceReview')}
        </p>
      )}

      {checked?.ok && preview && (
        <div
          className="border-border/60 bg-muted/30 space-y-2 rounded-md border p-3"
          data-testid="local-plugin-preview"
        >
          <p className="text-xs font-medium">{t('localPluginPreviewTitle')}</p>
          <LocalPluginPreviewSummary
            manifest={checked.manifest}
            preview={preview}
            look={POPUP_PREVIEW_LOOK}
            t={t}
          />
          <button
            type="button"
            onClick={review.toggleDetails}
            aria-expanded={review.details}
            className="text-muted-foreground hover:text-foreground text-[11px] font-medium transition-colors"
          >
            {review.details ? t('localPluginsHideDetails') : t('localPluginsInspect')}
          </button>
          {review.details && <LocalPluginInspection manifest={checked.manifest} t={t} />}
          {runsCode && <ScriptedSetupCard scripted={scripted} look={POPUP_SCRIPTED_LOOK} t={t} />}
          {!cannotRun && (
            <p className="text-muted-foreground text-[11px]">
              {t(runsCode ? 'scriptedInstallNote' : 'localPluginPreviewLandsOff')}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={local.busy}
              onClick={review.dismissPreview}
            >
              {t('localPluginsCancel')}
            </Button>
            {!cannotRun && (
              <Button
                size="sm"
                disabled={local.busy}
                onClick={(event) => {
                  // Turning on code takes the person's own click.
                  if (!runsCode || isUserEvent(event.nativeEvent)) void review.importPreviewed();
                }}
              >
                {t(runsCode ? 'scriptedInstallAndTurnOn' : 'localPluginDescribeImport')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
