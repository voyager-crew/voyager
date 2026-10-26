import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type HostCatalogCacheEntry,
  loadHostCatalogCache,
  subscribeHostCatalog,
} from '@/features/plugins/remote/hostCatalogCache';
import {
  PLUGIN_CATALOG_CHECK_INTERVALS,
  type PluginCatalogCheckInterval,
  normalizeCheckInterval,
} from '@/features/plugins/remote/hostCatalogPolicy';
import {
  DEFAULT_PLUGIN_CATALOG_SETTINGS,
  type PluginCatalogSettings,
  loadPluginCatalogSettings,
  savePluginCatalogSettings,
  subscribePluginCatalogSettings,
} from '@/features/plugins/remote/hostCatalogSettings';
import type { TranslationKey } from '@/utils/translations';

import { Select } from '../../../components/ui/input';
import { Switch } from '../../../components/ui/switch';
import { useLanguage } from '../../../contexts/LanguageContext';

const CHECK_INTERVAL_LABEL_KEYS: Readonly<Record<PluginCatalogCheckInterval, TranslationKey>> = {
  '1h': 'pluginsIntervalHourly',
  '6h': 'pluginsIntervalSixHours',
  '24h': 'pluginsIntervalDaily',
  manual: 'pluginsIntervalManual',
};

export function usePluginCatalog(catalogHost: string | undefined, refreshing: boolean) {
  const { t } = useLanguage();
  const [catalogSettings, setCatalogSettings] = useState<PluginCatalogSettings>(
    DEFAULT_PLUGIN_CATALOG_SETTINGS,
  );
  const [catalogEntry, setCatalogEntry] = useState<HostCatalogCacheEntry | null>(null);
  // Previous `refreshing` value, so a manual check that only moved the attempt
  // timestamp still refreshes the status line: subscribeHostCatalog
  // deliberately stays quiet for bookkeeping-only writes.
  const wasRefreshing = useRef(false);
  // The two catalog controls live in sync storage, so another window (or the
  // settings backup restoring them) must be reflected here while the popup is
  // open. Only hosts that can have a catalog show the block, so skip the read
  // entirely elsewhere.
  useEffect(() => {
    if (!catalogHost) return;
    let active = true;
    void loadPluginCatalogSettings().then((settings) => {
      if (active) setCatalogSettings(settings);
    });
    const unsubscribe = subscribePluginCatalogSettings((settings) => {
      if (active) setCatalogSettings(settings);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [catalogHost]);

  useEffect(() => {
    if (!catalogHost) {
      setCatalogEntry(null);
      return;
    }
    let active = true;
    const read = (): void => {
      void loadHostCatalogCache(catalogHost).then((entry) => {
        if (active) setCatalogEntry(entry);
      });
    };
    read();
    // Bookkeeping-only writes (an automatic attempt that found nothing new)
    // still move "last checked", so this view listens to every write.
    const unsubscribe = subscribeHostCatalog(catalogHost, read, { includeBookkeeping: true });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [catalogHost]);

  useEffect(() => {
    const justFinished = wasRefreshing.current && !refreshing;
    wasRefreshing.current = refreshing;
    if (!catalogHost || !justFinished) return;
    let active = true;
    void loadHostCatalogCache(catalogHost).then((entry) => {
      if (active) setCatalogEntry(entry);
    });
    return () => {
      active = false;
    };
  }, [catalogHost, refreshing]);

  const handleOnlineUpdatesToggle = useCallback((next: boolean) => {
    setCatalogSettings((previous) => ({ ...previous, onlineUpdatesEnabled: next }));
    void savePluginCatalogSettings({ onlineUpdatesEnabled: next });
  }, []);

  const handleCheckIntervalChange = useCallback((value: string) => {
    const interval = normalizeCheckInterval(value);
    setCatalogSettings((previous) => ({ ...previous, checkInterval: interval }));
    void savePluginCatalogSettings({ checkInterval: interval });
  }, []);

  /**
   * One line describing the online catalog for this host: a 404 is a settled
   * answer ("this site has no catalog"), so it replaces the timestamp rather
   * than reading as a stale successful check.
   */
  const catalogStatusText = ((): string => {
    if (catalogEntry?.status === 'missing') return t('pluginsNoOnlineCatalog');
    if (!catalogEntry?.lastAttemptAt) return t('pluginsNeverChecked');
    return t('pluginsLastChecked').replace(
      '{time}',
      new Date(catalogEntry.lastAttemptAt).toLocaleString(),
    );
  })();

  return {
    catalogSettings,
    catalogStatusText,
    handleOnlineUpdatesToggle,
    handleCheckIntervalChange,
  };
}

export function PluginCatalogControls({
  catalogHost,
  catalogSettings,
  catalogStatusText,
  handleOnlineUpdatesToggle,
  handleCheckIntervalChange,
  separator = true,
}: ReturnType<typeof usePluginCatalog> & {
  readonly catalogHost?: string;
  readonly separator?: boolean;
}) {
  const { t } = useLanguage();
  if (!catalogHost) return null;
  return (
    <div className={separator ? 'border-border/60 space-y-2 border-t pt-3' : 'space-y-2'}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium">{t('pluginsOnlineUpdates')}</span>
        <Switch
          checked={catalogSettings.onlineUpdatesEnabled}
          aria-label={t('pluginsOnlineUpdates')}
          onChange={(event) => handleOnlineUpdatesToggle(event.target.checked)}
        />
      </div>
      <p className="text-muted-foreground text-[11px] leading-snug">
        {t('pluginsOnlineUpdatesHint')}
      </p>
      {catalogSettings.onlineUpdatesEnabled && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-foreground/80 text-xs">{t('pluginsCheckInterval')}</span>
          <Select
            size="sm"
            value={catalogSettings.checkInterval}
            aria-label={t('pluginsCheckInterval')}
            onChange={(event) => handleCheckIntervalChange(event.target.value)}
          >
            {PLUGIN_CATALOG_CHECK_INTERVALS.map((interval) => (
              <option key={interval} value={interval}>
                {t(CHECK_INTERVAL_LABEL_KEYS[interval])}
              </option>
            ))}
          </Select>
        </div>
      )}
      <p className="text-muted-foreground text-[11px]">{catalogStatusText}</p>
    </div>
  );
}
