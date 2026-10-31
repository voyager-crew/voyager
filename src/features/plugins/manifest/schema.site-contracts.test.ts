/** Regression coverage for editor schemas that copy the runtime's site contracts. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import locatorContractsDocument from '../../../../docs/public/site-sections/locator-contracts.schema.json';
import locatorsSchemaDocument from '../../../../docs/public/site-sections/locators.schema.json';
import siteSchemaDocument from '../../../../docs/public/site.schema.json';
import { SITE_SELECTOR_CONTRACTS } from '../../../core/selectors/contracts';
import { OP_NAMES, POLICY_EXEMPT_OPS } from '../../bridge/protocol';
import { readBridgePolicySection } from '../sites/sections/bridgePolicyData';
import { readFoldersSection } from '../sites/sections/foldersData';
import { readSiteLocators } from '../sites/sections/locatorData';
import { isValidSelectorSyntax } from '../sites/siteAdapterData';
import { check, loadSchema, repoRoot } from './__tests__/jsonSchemaCheck';

describe('site schema runtime contracts', () => {
  const contracts = Object.entries(SITE_SELECTOR_CONTRACTS);
  const foldersSchema = loadSchema(join(repoRoot, 'docs/public/site-sections/folders.schema.json'));
  const locatorsSchema = loadSchema(
    join(repoRoot, 'docs/public', siteSchemaDocument.properties.locators.$ref),
  );
  const locatorContracts = new Map(
    Object.entries(locatorContractsDocument.$defs).map(([id, schema]) => [
      `site-sections/locator-contracts.schema.json#/$defs/${id}`,
      schema,
    ]),
  );

  // The local checker does not implement allOf or maxProperties, so assert these
  // editor-facing contracts directly rather than silently skipping their bounds.
  it('lists the union of contracted locator names without stale names or duplicates', () => {
    const names = [...new Set(contracts.flatMap(([, contract]) => contract.keys))].sort();
    const locators = locatorsSchemaDocument;
    expect([...locators.propertyNames.enum].sort()).toEqual(names);
    expect(locators.maxProperties).toBe(names.length);

    const supportedSites = siteSchemaDocument.allOf.find((branch) =>
      branch.if.required.includes('locators'),
    );
    expect(supportedSites?.then.properties.id?.enum.toSorted()).toEqual(
      contracts.map(([id]) => id).sort(),
    );

    const siteIds = siteSchemaDocument.allOf.flatMap((branch) =>
      branch.if.properties ? [branch.if.properties.id.const] : [],
    );
    expect(siteIds.sort()).toEqual(contracts.map(([id]) => id).sort());
  });

  it.each(contracts)(
    'allows every %s locator and caps the object at its vocabulary',
    (id, contract) => {
      const branch = siteSchemaDocument.allOf.find((entry) => entry.if.properties?.id.const === id);
      const locators = locatorContracts.get(branch?.then.properties.locators?.$ref ?? '');
      if (!locators) throw new Error(`site.schema.json has no locator contract for ${id}`);
      expect([...locators.propertyNames.enum].sort()).toEqual([...contract.keys].sort());
      expect(locators.maxProperties).toBe(contract.keys.length);

      const profiles = Object.fromEntries(contract.keys.map((key) => [key, ['.fixture']]));
      expect(check(profiles, locatorsSchema)).toEqual([]);
      expect(check(profiles, locators)).toEqual([]);
      expect(readSiteLocators(profiles, id, isValidSelectorSyntax)).toEqual({
        locators: profiles,
        issues: [],
      });
      expect(check({ 'input.sendContainers': ['.fixture'] }, locators)).not.toEqual([]);
    },
  );

  it('accepts every bridge op the policy reader accepts, with policy exemptions optional', () => {
    const bridge = siteSchemaDocument.properties.bridge;
    const names = bridge.properties.allow.items.enum;
    const gatedOps = OP_NAMES.filter((op) => !POLICY_EXEMPT_OPS.includes(op));
    expect(names.filter((op) => !POLICY_EXEMPT_OPS.some((exempt) => exempt === op)).sort()).toEqual(
      [...gatedOps].sort(),
    );
    expect([...names].sort()).toEqual([...OP_NAMES].sort());
    expect(bridge.properties.allow.maxItems).toBe(OP_NAMES.length * 4);

    for (const allow of [[], gatedOps, [...OP_NAMES]]) {
      const raw = { format: 1, allow };
      expect(check(raw, bridge)).toEqual([]);
      expect(readBridgePolicySection(raw)).toEqual({ policy: raw, issues: [] });
    }
  });

  it('keeps the bridge list length bound aligned with the reader', () => {
    const bridge = siteSchemaDocument.properties.bridge;
    const maxItems = bridge.properties.allow.maxItems;
    // Unknown future names are skipped by the reader but still count toward its cap.
    const allow = Array.from({ length: maxItems }, (_, index) => `future.op${index}`);
    expect(readBridgePolicySection({ format: 1, allow }).policy).toBeDefined();

    const oversized = [...allow, 'future.overflow'];
    expect(check({ format: 1, allow: oversized }, bridge)).toContain(
      `$.allow: more than ${maxItems} items`,
    );
    expect(readBridgePolicySection({ format: 1, allow: oversized }).policy).toBeUndefined();
  });

  it.each([{}, { fallbackLanguage: 'en' }])(
    'rejects placeholder titles with no any or byLanguage: %j',
    (placeholderTitles) => {
      const folders = {
        format: 1,
        sidebar: 'aside',
        rows: { row: 'a', drag: 'link' },
        page: { placeholderTitles },
      };
      expect(check(folders, foldersSchema).join('\n')).toContain('placeholderTitles');
      const read = readFoldersSection(folders, isValidSelectorSyntax);
      expect(read.folders).toBeUndefined();
      expect(read.issues).toContainEqual({
        path: 'folders.page.placeholderTitles',
        message: 'must have any or byLanguage',
      });
    },
  );

  it.each([
    { any: ['New chat'] },
    { byLanguage: { en: ['New chat'] }, fallbackLanguage: 'en' },
    { any: ['Untitled'], byLanguage: { en: ['New chat'] } },
  ])('accepts placeholder title lists in either or both forms: %j', (placeholderTitles) => {
    const folders = {
      format: 1,
      sidebar: 'aside',
      rows: { row: 'a', drag: 'link' },
      page: { placeholderTitles },
    };
    expect(check(folders, foldersSchema)).toEqual([]);
    expect(readFoldersSection(folders, isValidSelectorSyntax).issues).toEqual([]);
  });
});
