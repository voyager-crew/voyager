import { createRoot } from 'react-dom/client';

import { prepareExtensionPageLanguage } from '@/utils/extensionPageLanguage';

import '@pages/welcome/index.css';

import '@assets/styles/tailwind.css';

import { LanguageProvider } from '../../contexts/LanguageContext';
import { Welcome } from './Welcome';

async function init() {
  const initialLanguage = await prepareExtensionPageLanguage();
  const rootContainer = document.querySelector('#__root');
  if (!rootContainer) throw new Error("Can't find Welcome root element");
  createRoot(rootContainer).render(
    <LanguageProvider initialLanguage={initialLanguage}>
      <Welcome />
    </LanguageProvider>,
  );
}

void init();
