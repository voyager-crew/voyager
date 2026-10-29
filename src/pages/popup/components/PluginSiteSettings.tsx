import type { ComponentProps } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { CHATGPT_EXPORT_PLUGIN_ID } from '@/features/plugins/builtin/chatgptExport/openMessage';
import type { TranslationKey } from '@/utils/translations';

import { CHATGPT_LOCAL_BRIDGE_PLUGIN_ID } from '../hooks/useBridgeStatus';
import type { PromptDataTransferController } from '../hooks/usePromptDataTransfer';
import type { ActiveSitePrompt } from '../hooks/useSiteAccess';
import { ChatGptBridgeCard } from './ChatGptBridgeCard';
import { ChatGptExportCard } from './ChatGptExportCard';
import { LocalPluginsPanel } from './LocalPluginsPanel';
import { PluginManager } from './PluginManager';
import { PromptDataTransfer } from './PromptDataTransfer';
import { PromptManagerSiteRow } from './PromptManagerSiteRow';

export function PluginSiteSettings({
  prompt,
  promptDataTransfer,
  plugins,
  exportEntry,
  t,
}: {
  /** Prompt Manager on the open page; null where the page has no host to cover. */
  prompt: ActiveSitePrompt | null;
  promptDataTransfer: PromptDataTransferController;
  plugins: ComponentProps<typeof PluginManager>;
  /** Enabled state and target tab for the ChatGPT export card. */
  exportEntry?: {
    enabled: boolean;
    activeTabId: number | null;
    onOpened?: () => void;
  };
  t: (key: TranslationKey) => string;
}) {
  // Listed only where the exporter's `matches` cover the active tab (ChatGPT).
  const exportPlugin = plugins.manifests.find((plugin) => plugin.id === CHATGPT_EXPORT_PLUGIN_ID);
  // Likewise ChatGPT-only; the card itself stays hidden until the builtin is on.
  const hasBridgePlugin = plugins.manifests.some(
    (plugin) => plugin.id === CHATGPT_LOCAL_BRIDGE_PLUGIN_ID,
  );
  return (
    <>
      {hasBridgePlugin && <ChatGptBridgeCard t={t} />}
      {exportPlugin && exportEntry && (
        <ChatGptExportCard
          plugin={exportPlugin}
          enabled={exportEntry.enabled}
          activeTabId={exportEntry.activeTabId}
          activeUrl={plugins.activeUrl}
          onOpened={exportEntry.onOpened}
          t={t}
        />
      )}
      {/* The shared prompt library remains available on third-party sites. */}
      <Card style={{ order: -2 }} className="p-4">
        <CardContent className="p-0">
          <PromptDataTransfer t={t} transfer={promptDataTransfer} />
        </CardContent>
      </Card>
      <div style={{ order: -1 }} className="flex flex-col gap-4">
        <PluginManager
          {...plugins}
          promptRow={prompt && <PromptManagerSiteRow prompt={prompt} t={t} />}
        />
        <LocalPluginsPanel t={t} activeUrl={plugins.activeUrl} />
      </div>
    </>
  );
}
