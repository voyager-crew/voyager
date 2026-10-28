import React from 'react';
import { createRoot } from 'react-dom/client';

import Popup from '@pages/popup/Popup';
import '@pages/options/index.css';

import { prepareExtensionPageLanguage } from '@/utils/extensionPageLanguage';
import '@pages/popup/index.css';

import '@assets/styles/tailwind.css';

import { LanguageProvider } from '../../contexts/LanguageContext';

function getSourceTabId(): number | undefined {
  const raw = new URLSearchParams(window.location.search).get('sourceTabId');
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

async function init() {
  const initialLanguage = await prepareExtensionPageLanguage();
  const rootContainer = document.querySelector('#__root');
  if (!rootContainer) throw new Error("Can't find Options root element");
  const root = createRoot(rootContainer);
  root.render(
    <LanguageProvider initialLanguage={initialLanguage}>
      <Popup sourceTabId={getSourceTabId()} />
    </LanguageProvider>,
  );
}

void init();
