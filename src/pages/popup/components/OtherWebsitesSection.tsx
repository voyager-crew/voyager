import { useId, useRef } from 'react';

import { Plus, X } from 'lucide-react';

import { customWebsitesIncludeHost } from '@/core/utils/customWebsites';
import type { TranslationKey } from '@/utils/translations';

import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import type { PromptManagerSettings } from '../hooks/usePromptManagerSettings';
import { catalogSiteForEntry } from '../utils/siteAccessSites';
import { IconMidjourney, IconNotebookLM, IconQwen } from './WebsiteLogos';

/** One-click additions; a site that joins the catalog drops out on its own. */
const QUICK_SITES = [
  { domain: 'qwen.ai', label: 'Qwen', Icon: IconQwen },
  { domain: 'notebooklm.google.com', label: 'NotebookLM', Icon: IconNotebookLM },
  { domain: 'midjourney.com', label: 'Midjourney', Icon: IconMidjourney },
].filter(({ domain }) => !catalogSiteForEntry(domain));

export interface OtherWebsitesSectionProps {
  /** The coverage entries outside every supported site. */
  readonly websites: readonly string[];
  readonly onRemove: (website: string, returnFocus: () => HTMLElement | null) => Promise<void>;
  readonly coverage: Pick<
    PromptManagerSettings,
    | 'customWebsites'
    | 'newWebsiteInput'
    | 'websiteError'
    | 'onWebsiteInputChange'
    | 'handleAddWebsite'
    | 'toggleQuickWebsite'
  >;
  readonly t: (key: TranslationKey) => string;
}

/** Websites outside the catalog, where Voyager runs only Prompt Manager. */
export function OtherWebsitesSection({
  websites,
  onRemove,
  coverage,
  t,
}: OtherWebsitesSectionProps) {
  const headingId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = QUICK_SITES.filter(
    ({ domain }) => !customWebsitesIncludeHost(coverage.customWebsites, domain),
  );
  return (
    <section aria-labelledby={headingId} className="space-y-2.5">
      <div>
        <h4 id={headingId} className="text-sm leading-snug font-medium">
          {t('siteAccessOtherWebsites')}
        </h4>
        <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
          {t('siteAccessOtherWebsitesHint')}
        </p>
      </div>
      {suggestions.length > 0 && (
        <div role="group" aria-label={t('addWebsite')} className="flex flex-wrap gap-1.5">
          {suggestions.map(({ domain, label, Icon }) => (
            <button
              key={domain}
              type="button"
              onClick={() => {
                void coverage.toggleQuickWebsite(domain, false);
              }}
              className="text-muted-foreground hover:bg-secondary/60 hover:text-foreground border-border/70 focus-visible:ring-ring/60 inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
              title={domain}
            >
              <Plus className="size-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              <span
                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                aria-hidden="true"
              >
                <Icon />
              </span>
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>
      )}
      {websites.length > 0 && (
        <ul className="space-y-1">
          {websites.map((website) => (
            <li
              key={website}
              className="bg-secondary/40 flex items-center justify-between gap-2 rounded-lg py-1 ps-2.5 pe-1"
            >
              <bdi className="text-foreground/90 min-w-0 truncate text-[13px]">{website}</bdi>
              <button
                type="button"
                onClick={() => {
                  void onRemove(website, () => inputRef.current);
                }}
                className="text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-ring/60 flex size-6 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <X className="size-3.5" aria-hidden="true" />
                <span className="sr-only">
                  {t('removeWebsite')} <bdi>{website}</bdi>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Input
            ref={inputRef}
            type="text"
            value={coverage.newWebsiteInput}
            onChange={(event) => coverage.onWebsiteInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void coverage.handleAddWebsite();
            }}
            placeholder={t('customWebsitesPlaceholder')}
            aria-labelledby={headingId}
            className="flex-1"
          />
          <Button
            onClick={() => {
              void coverage.handleAddWebsite();
            }}
            size="sm"
            className="shrink-0 whitespace-nowrap"
          >
            {t('addWebsite')}
          </Button>
        </div>
        {coverage.websiteError && (
          <p className="text-destructive text-xs">{coverage.websiteError}</p>
        )}
      </div>
      <p className="text-muted-foreground text-xs leading-snug">{t('customWebsitesNote')}</p>
    </section>
  );
}
