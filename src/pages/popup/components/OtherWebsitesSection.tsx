import { useId, useRef } from 'react';

import { Plus, X } from 'lucide-react';

import { PLATFORM_LOGOS, type PlatformLogo } from '@/core/icons/platformLogos';
import { customWebsitesIncludeHost } from '@/core/utils/customWebsites';
import type { TranslationKey } from '@/utils/translations';

import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import type { PromptManagerSettings } from '../hooks/usePromptManagerSettings';
import { catalogSiteForEntry } from '../utils/siteAccessSites';
import { PlatformMark } from './WebsiteLogos';

/** Websites with a bundled mark of their own; no favicon is fetched for any other. */
const KNOWN_WEBSITES: readonly { domain: string; label: string; logo: PlatformLogo }[] = [
  { domain: 'qwen.ai', label: 'Qwen', logo: PLATFORM_LOGOS.qwen },
  { domain: 'notebooklm.google.com', label: 'NotebookLM', logo: PLATFORM_LOGOS.notebooklm },
  { domain: 'midjourney.com', label: 'Midjourney', logo: PLATFORM_LOGOS.midjourney },
];

/** One-click additions; a site that joins the catalog drops out on its own. */
const QUICK_SITES = KNOWN_WEBSITES.filter(({ domain }) => !catalogSiteForEntry(domain));

const CHIP_CLASS =
  'text-muted-foreground hover:bg-secondary/60 hover:text-foreground border-border/70 focus-visible:ring-ring/60 inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none';

/**
 * The website's bundled mark, or else the first letter of its address on a
 * plain tile. In a chip it takes the chip's color and the quick chips' size.
 */
function WebsiteMark({ website, chip = false }: { website: string; chip?: boolean }) {
  const known = KNOWN_WEBSITES.find(({ domain }) => customWebsitesIncludeHost([domain], website));
  const size = chip ? 'size-3.5' : 'size-4';
  if (known) {
    return (
      <span
        className={`flex ${size} shrink-0 items-center justify-center`}
        style={chip ? undefined : { color: known.logo.brand }}
        aria-hidden="true"
      >
        <PlatformMark logo={known.logo} />
      </span>
    );
  }
  return (
    <span
      className={`${chip ? 'size-3.5 text-[8px]' : 'bg-background text-muted-foreground size-4 text-[9px]'} border-border/70 flex shrink-0 items-center justify-center rounded-[4px] border leading-none font-semibold`}
      aria-hidden="true"
    >
      {/[a-z0-9]/i.exec(website)?.[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

export interface OtherWebsitesSectionProps {
  /** The coverage entries outside every supported site. */
  readonly websites: readonly string[];
  /** The open page, when it is an other website; offered first until it is added. */
  readonly pageWebsite: string | null;
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
  pageWebsite,
  onRemove,
  coverage,
  t,
}: OtherWebsitesSectionProps) {
  const headingId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = QUICK_SITES.filter(
    ({ domain }) => !customWebsitesIncludeHost(coverage.customWebsites, domain),
  );
  // A page a quick chip already covers (chat.qwen.ai under Qwen) keeps that chip instead.
  const page =
    pageWebsite &&
    !customWebsitesIncludeHost(coverage.customWebsites, pageWebsite) &&
    !QUICK_SITES.some(({ domain }) => customWebsitesIncludeHost([domain], pageWebsite))
      ? pageWebsite
      : null;
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
      {(page || suggestions.length > 0) && (
        <div role="group" aria-label={t('addWebsite')} className="flex flex-wrap gap-1.5">
          {page && (
            <button
              type="button"
              onClick={() => {
                void coverage.toggleQuickWebsite(page, false);
              }}
              className={CHIP_CLASS}
              title={page}
            >
              <Plus className="size-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              <WebsiteMark website={page} chip />
              <bdi className="truncate">{page}</bdi>
            </button>
          )}
          {suggestions.map(({ domain, label, logo }) => (
            <button
              key={domain}
              type="button"
              onClick={() => {
                void coverage.toggleQuickWebsite(domain, false);
              }}
              className={CHIP_CLASS}
              title={domain}
            >
              <Plus className="size-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              <span
                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                aria-hidden="true"
              >
                <PlatformMark logo={logo} />
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
              className="bg-secondary/40 flex items-center gap-2 rounded-lg py-1 ps-2 pe-1"
            >
              <WebsiteMark website={website} />
              <bdi className="text-foreground/90 min-w-0 flex-1 truncate text-[13px]">
                {website}
              </bdi>
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
