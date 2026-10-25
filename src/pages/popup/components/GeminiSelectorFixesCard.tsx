import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { TranslationKey } from '@/utils/translations';

import type { GeminiSelectorFixesControl } from '../hooks/useGeminiSelectorFixes';

interface GeminiSelectorFixesCardProps {
  control: GeminiSelectorFixesControl;
  isVisible: (settingId: string) => boolean;
  t: (key: TranslationKey) => string;
}

export function GeminiSelectorFixesCard({ control, isVisible, t }: GeminiSelectorFixesCardProps) {
  if (!control.visible || !isVisible('geminiSelectorFixes')) return null;
  const { channel, operation, error, canTurnOn } = control;
  const enabled = channel?.enabled === true;
  const status = ((): TranslationKey | null => {
    if (error)
      return error === 'save' ? 'geminiSelectorFixesSaveFailed' : 'geminiSelectorFixesFailed';
    if (operation === 'checking') return 'geminiSelectorFixesChecking';
    if (operation === 'loading' || operation === 'saving') return 'loading';
    if (!channel) return null;
    if (!channel.buildEnabled) return 'geminiSelectorFixesUnavailable';
    if (!enabled) return 'geminiSelectorFixesOff';
    if (channel.result === 'failed') return 'geminiSelectorFixesFailed';
    // An unchanged response never tells the user to refresh an already current page.
    if (channel.result === 'upToDate') return 'geminiSelectorFixesUpToDate';
    if (channel.result === 'updated') return 'geminiSelectorFixesUpdated';
    return channel.lastAttemptAt === null ? 'pluginsNeverChecked' : null;
  })();

  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="gemini-selector-fixes" className="min-w-0 text-sm leading-5 font-medium">
          {t('geminiSelectorFixesTitle')}
        </Label>
        <Switch
          id="gemini-selector-fixes"
          checked={enabled}
          disabled={
            !channel?.buildEnabled ||
            (!enabled && !canTurnOn) ||
            operation === 'loading' ||
            operation === 'saving'
          }
          aria-describedby="gemini-selector-fixes-hint"
          onChange={(event) => void control.setEnabled(event.target.checked)}
        />
      </div>
      <p id="gemini-selector-fixes-hint" className="text-muted-foreground text-xs leading-snug">
        {t('geminiSelectorFixesHint')}
      </p>
      {enabled && canTurnOn && channel?.buildEnabled && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 px-2.5 text-xs"
          disabled={operation !== null}
          onClick={() => void control.checkNow()}
        >
          {t('geminiSelectorFixesCheckNow')}
        </Button>
      )}
      {status && (
        <p role="status" aria-live="polite" className="text-muted-foreground text-xs leading-snug">
          {t(status)}
        </p>
      )}
      {!enabled && !canTurnOn && (
        <p className="text-muted-foreground text-xs leading-snug">
          {t('geminiSelectorFixesTurnOnInGemini')}
        </p>
      )}
      {enabled && channel?.lastAttemptAt !== null && channel?.lastAttemptAt !== undefined && (
        <p className="text-muted-foreground text-[11px]">
          {t('pluginsLastChecked').replace(
            '{time}',
            new Date(channel.lastAttemptAt).toLocaleString(),
          )}
        </p>
      )}
    </Card>
  );
}
