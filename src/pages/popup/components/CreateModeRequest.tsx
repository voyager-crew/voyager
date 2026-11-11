import { Bot, Check, Copy } from 'lucide-react';

import { MAX_PLUGIN_REQUEST_CHARS } from '@/features/plugins/local/authoringSites';
import type { TranslationKey } from '@/utils/translations';

import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/input';
import {
  CREATE_REQUEST_INPUT_ID,
  type CreateCopyTarget,
  type useCreateRequest,
} from '../hooks/useCreateRequest';
import { LOCAL_PLUGIN_FIELD_CLASS } from './localPluginFieldClass';

const COPY_LABELS: Readonly<Record<CreateCopyTarget, TranslationKey>> = {
  chat: 'createModeCopyForChat',
  agent: 'createModeCopyForAgent',
};

const COPY_ICONS = { chat: Copy, agent: Bot } as const;

/**
 * One sentence and a site, copied either for the AI chat the user is on or
 * for a coding agent on their machine. Voyager sends nothing; a refused copy
 * leaves the text on screen to select.
 */
export function CreateModeRequest({
  create,
  t,
}: {
  create: ReturnType<typeof useCreateRequest>;
  t: (key: TranslationKey) => string;
}) {
  const { outcome } = create;
  const hint =
    outcome?.target === 'agent'
      ? t('createModeAgentHint')
          .replace('{more}', () => t('createModeMoreWays'))
          .replace('{importFiles}', () => t('localPluginsImportFiles'))
      : t('createModeChatHint');

  return (
    <div className="space-y-2" data-testid="create-mode-request">
      <label htmlFor={CREATE_REQUEST_INPUT_ID} className="block text-xs font-medium">
        {t('localPluginDescribeRequestLabel')}
      </label>
      <textarea
        id={CREATE_REQUEST_INPUT_ID}
        value={create.request}
        maxLength={MAX_PLUGIN_REQUEST_CHARS}
        rows={2}
        placeholder={t('localPluginDescribeRequestPlaceholder')}
        onChange={(event) => create.setRequest(event.target.value)}
        className={LOCAL_PLUGIN_FIELD_CLASS}
      />
      <label className="flex items-center gap-2">
        <span className="text-foreground/80 text-xs">{t('localPluginDescribeSiteLabel')}</span>
        <Select
          size="sm"
          value={create.siteId}
          onChange={(event) => create.pickSite(event.target.value)}
        >
          {create.sites.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </Select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(['chat', 'agent'] as const).map((target) => {
          const copied = outcome?.target === target && outcome.copied;
          const Icon = copied ? Check : COPY_ICONS[target];
          return (
            <Button
              key={target}
              variant={target === 'chat' ? 'default' : 'outline'}
              size="sm"
              className="h-auto min-h-8 w-full py-1.5 text-xs whitespace-normal"
              disabled={!create.canCopy}
              onClick={() => void create.copy(target)}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{copied ? t('localPluginDescribeCopied') : t(COPY_LABELS[target])}</span>
            </Button>
          );
        })}
      </div>
      {outcome && !outcome.copied && (
        <div className="space-y-1" role="alert">
          <p className="text-destructive text-[11px]">{t('localPluginDescribeCopyFailed')}</p>
          <textarea
            readOnly
            value={outcome.text}
            rows={5}
            dir="ltr"
            aria-label={t(COPY_LABELS[outcome.target])}
            spellCheck={false}
            onFocus={(event) => event.target.select()}
            className={`${LOCAL_PLUGIN_FIELD_CLASS} text-muted-foreground font-mono text-[10px]`}
          />
        </div>
      )}
      <p className="text-muted-foreground text-[11px]" aria-live="polite">
        {hint}
      </p>
    </div>
  );
}
