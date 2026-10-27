import { describe, expect, it } from 'vitest';

import vim from '@/features/plugins/catalog/sites/gemini/selector-data/vim.json';
import gemini from '@/features/plugins/catalog/sites/gemini/site.json';

// Adapter recognition uses exact equality; drift would silently disable its online profile.
describe('Gemini Vim adapter contract', () => {
  it('keeps the adapter composer identical to the bundled Vim configured profile', () => {
    expect(gemini.selectors.composer).toBe(vim['vim.configuredComposer'].join(','));
  });
});
