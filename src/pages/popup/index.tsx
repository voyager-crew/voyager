import { createRoot } from 'react-dom/client';

import Popup from '@pages/popup/Popup';

import { prepareExtensionPageLanguage } from '@/utils/extensionPageLanguage';
import '@pages/popup/index.css';
import '@pages/popup/popupFrame.css';

import '@assets/styles/tailwind.css';

import { LanguageProvider } from '../../contexts/LanguageContext';

async function init() {
  const initialLanguage = await prepareExtensionPageLanguage();
  const rootContainer = document.querySelector('#__root');
  if (!rootContainer) throw new Error("Can't find Popup root element");
  const root = createRoot(rootContainer);
  root.render(
    <LanguageProvider initialLanguage={initialLanguage}>
      <Popup />
    </LanguageProvider>,
  );
}

void init();
