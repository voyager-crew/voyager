import { createRoot } from 'react-dom/client';

import '@/assets/styles/tailwind.css';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { prepareExtensionPageLanguage } from '@/utils/extensionPageLanguage';

import { Library } from './Library';
import './index.css';

async function init() {
  const initialLanguage = await prepareExtensionPageLanguage();
  const container = document.querySelector('#__root');
  if (!container) throw new Error("Can't find Saved Library root element");
  createRoot(container).render(
    <LanguageProvider initialLanguage={initialLanguage}>
      <Library />
    </LanguageProvider>,
  );
}

void init();
