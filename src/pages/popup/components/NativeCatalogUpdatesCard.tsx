import { Card } from '@/components/ui/card';

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
  const catalog = usePluginCatalog(catalogHost, refreshing);
  if (!catalogHost || !visible) return null;
  return (
    <Card className="p-4">
      <PluginCatalogControls
        catalogHost={catalogHost}
        onRefresh={onRefresh}
        refreshing={refreshing}
        separator={false}
        {...catalog}
      />
    </Card>
  );
}
