import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';

import { PluginCatalogControls, usePluginCatalog } from './PluginCatalogControls';

interface NativeCatalogUpdatesCardProps {
  readonly catalogHost?: string;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly visible: boolean;
}

/** Native settings have no plugin list footer, but use the same online channel. */
export function NativeCatalogUpdatesCard({
  catalogHost,
  refreshing,
  onRefresh,
  visible,
}: NativeCatalogUpdatesCardProps) {
  const { t } = useLanguage();
  const catalog = usePluginCatalog(catalogHost, refreshing);
  if (!catalogHost || !visible) return null;
  return (
    <Card className="space-y-3 p-4">
      <PluginCatalogControls catalogHost={catalogHost} separator={false} {...catalog} />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={refreshing || !catalog.catalogSettings.onlineUpdatesEnabled}
        onClick={onRefresh}
      >
        {t('pluginsRefresh')}
      </Button>
    </Card>
  );
}
