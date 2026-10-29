import { createRoot } from 'react-dom/client';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { prepareExtensionPageLanguage } from '@/utils/extensionPageLanguage';

import { PanelApp } from './PanelApp';
import { startPanelBootstrap } from './bootstrap';
import './styles/panel.css';
import './styles/rows.css';
import './styles/sync.css';

startPanelBootstrap(async (session, signal) => {
  // The first frame already speaks Voyager's language.
  const initialLanguage = await prepareExtensionPageLanguage();
  if (signal.aborted) return;
  const container = document.getElementById('__root');
  if (container) {
    createRoot(container).render(
      <LanguageProvider initialLanguage={initialLanguage}>
        <PanelApp session={session} />
      </LanguageProvider>,
    );
  }
});
