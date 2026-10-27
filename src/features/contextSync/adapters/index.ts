import { getBundledGeminiSelectorView } from '@/core/gemini/selectors';

import { AdapterConfig } from '../types';

export const ADAPTERS: Record<string, AdapterConfig> = {
  // gemini
  'gemini.google.com': {
    user_selector: [...getBundledGeminiSelectorView().profiles['context.users']],
    ai_selector: [...getBundledGeminiSelectorView().profiles['context.responses']],
  },
  // default
  default: {
    selectors: ['div', 'p'],
    aiMarkers: ['ai', 'assistant'],
    userMarkers: ['user', 'human'],
  },
};

export function getMatchedAdapter(host: string): AdapterConfig {
  for (const key of Object.keys(ADAPTERS)) {
    if (host.includes(key)) {
      return ADAPTERS[key];
    }
  }
  return ADAPTERS.default;
}
