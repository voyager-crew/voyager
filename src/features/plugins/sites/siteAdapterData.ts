/**
 * `site.json` — the data form of a SiteAdapter.
 *
 * One reader covers bundled adapters, online host files and catalog publishing.
 *
 * Remote input is untrusted: fields are shape-checked and sizes capped.
 * No schema library by design (D17); sections own their value grammars.
 *
 * Two verdicts share one reader. `readSiteAdapterData` is the runtime read:
 * a selector key outside this build's vocabulary is dropped and reported in
 * `sectionIssues`, because the vocabulary only grows and one host file serves
 * every extension version. `validateSiteAdapterData` is the authoring verdict
 * (`plugin:check`, `catalog:build`): the same key is an error there, so a
 * typo in a repo `site.json` still fails.
 */
import type { Result } from '@/core/types/common';

import { BUNDLED_LOCATOR_SITES } from '../../../core/selectors/sites';
import type { ManifestIssue } from '../manifest/validate';
import type { SiteAdapter, SiteCapability, SiteThemeDescriptor } from '../types';
import { isSafeRegexSource } from './safeRegex';
import {
  type BridgePolicySection,
  bridgePolicySectionToData,
  readBridgePolicySection,
} from './sections/bridgePolicyData';
import {
  type ExportCrawlSection,
  type ExportThreadSection,
  readExportCrawlSection,
  readExportThreadSection,
} from './sections/exportCrawlData';
import { type SiteExportConfig, readExportConfig } from './sections/exportData';
import { type FolderSkin, readFolderSkin } from './sections/folderSkinData';
import { type FoldersSection, readFoldersSection } from './sections/foldersData';
import { type SiteLocatorProfiles, readSiteLocators } from './sections/locatorData';
import { type ModelPickerSection, readModelPickerSection } from './sections/modelPickerData';
import { type PageHooksSection, readPageHooksSection } from './sections/pageHooksData';
import { type ProjectsSection, readProjectsSection } from './sections/projectsData';
import { type PromptSection, readPromptSection } from './sections/promptData';
import {
  type TimelineSection,
  readTimelineSection,
  timelineSectionToData,
} from './sections/timelineData';
import { isValidSelectorSyntax, readSelectors, readTheme } from './siteSelectorsData';

export { isValidSelectorSyntax } from './siteSelectorsData';

/** JSON-serializable adapter: `capabilities` is an array instead of a Set. */
export interface SiteAdapterData {
  readonly catalogRevision?: number;
  readonly id: string;
  readonly label: string;
  readonly matches: readonly string[];
  readonly selectors: Readonly<Record<string, string>>;
  readonly theme: SiteThemeDescriptor;
  readonly brandColor?: string;
  readonly capabilities: readonly SiteCapability[];
  readonly conversationIdPattern?: string;
  readonly routeWords?: readonly string[];
  readonly accountSlots?: boolean;
  readonly conversationRoutes?: readonly string[];
  readonly prompt?: PromptSection;
  readonly turnKeyAttributes?: readonly string[];
  readonly export?: SiteExportConfig;
  readonly exportThread?: ExportThreadSection;
  readonly exportCrawl?: ExportCrawlSection;
  readonly timeline?: TimelineSection;
  readonly modelPicker?: ModelPickerSection;
  readonly projects?: ProjectsSection;
  readonly pageHooks?: PageHooksSection;
  readonly bridge?: BridgePolicySection;
  readonly folders?: FoldersSection;
  readonly folderSkin?: FolderSkin;
  readonly locators?: SiteLocatorProfiles;
}

const SITE_CAPABILITIES = ['chat', 'sidebar', 'composer', 'darkMode'] as const;
const SITE_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_LABEL_LENGTH = 60;
const MAX_MATCHES = 20;
const MAX_PATTERN_LENGTH = 500;
/** A plain lower-case attribute name: it is interpolated into `[name]`. */
const ATTRIBUTE_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_TURN_KEY_ATTRIBUTES = 8;
const ROUTE_WORD = /^[a-z0-9_-]{1,64}$/;
const MAX_ROUTE_WORDS = 64;
const MAX_CONVERSATION_ROUTES = 16;
const MAX_CONVERSATION_ROUTE_LENGTH = 520;
const CONVERSATION_ROUTE = /^\/(?:[a-z0-9_-]{1,64}|:id)(?:\/(?:[a-z0-9_-]{1,64}|:id)){0,7}$/;

function isConversationRoute(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_CONVERSATION_ROUTE_LENGTH &&
    CONVERSATION_ROUTE.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isHexColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
  );
}

/** `https://host/*`-style match pattern with a concrete or `*.` host. */
function isMatchPattern(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_PATTERN_LENGTH &&
    /^(?:https?|\*):\/\/(?:\*\.)?[a-z0-9.-]+\/.*$/i.test(value)
  );
}

function isSiteCapability(value: unknown): value is SiteCapability {
  return typeof value === 'string' && (SITE_CAPABILITIES as readonly string[]).includes(value);
}

export interface SiteAdapterDataRead {
  readonly result: Result<SiteAdapter, ManifestIssue[]>;
  /**
   * Non-fatal runtime problems: unknown selectors, malformed bundled-only
   * `accountSlots`, `conversationRoutes`, and broken optional
   * `modelPicker`, `projects`, `pageHooks`, `bridge`, `folders`, `folderSkin`, `prompt`,
   * `exportThread`, `exportCrawl`, `timeline`.
   * Unreadable fields/sections are omitted; other repairs remain usable.
   * Publishing fails on any issue (a missing `bridge` denies the bridge).
   */
  readonly sectionIssues: readonly ManifestIssue[];
}

interface SiteAdapterDataParse extends SiteAdapterDataRead {
  /** The `selectors.<key>` subset of `sectionIssues`. */
  readonly unknownKeys: readonly ManifestIssue[];
}

/**
 * Authoring verdict for a `site.json` document. Selector keys outside the
 * vocabulary and malformed fields are reported as issues; the result is usable
 * only when the issue list is empty (a partially valid adapter must never mask
 * a typo). Runtime reads use `readSiteAdapterData`, which drops unknown keys.
 */
export function validateSiteAdapterData(input: unknown): Result<SiteAdapter, ManifestIssue[]> {
  const { result, unknownKeys } = parseSiteAdapterData(input);
  if (unknownKeys.length === 0) return result;
  return { success: false, error: [...(result.success ? [] : result.error), ...unknownKeys] };
}

/**
 * The adapter a client applies, plus the problems it tolerated: unknown
 * selector keys and optional sections (`sectionIssues`).
 */
export function readSiteAdapterData(input: unknown): SiteAdapterDataRead {
  const { result, sectionIssues } = parseSiteAdapterData(input, true);
  return { result, sectionIssues };
}

function parseSiteAdapterData(input: unknown, tolerateSemantic = false): SiteAdapterDataParse {
  if (!isRecord(input)) {
    return {
      result: { success: false, error: [{ path: '', message: 'site must be an object' }] },
      sectionIssues: [],
      unknownKeys: [],
    };
  }
  const issues: ManifestIssue[] = [];
  const unknownKeys: ManifestIssue[] = [];
  // Future prompt fields must not discard selector repairs; prompt facts stay bundled.
  const promptRead = readPromptSection(input.prompt);
  const exportConfig = readExportConfig(input.export, issues, isValidSelectorSyntax, (name) =>
    ATTRIBUTE_NAME.test(name),
  );
  const modelPickerRead = readModelPickerSection(input.modelPicker);
  const projectsRead = readProjectsSection(input.projects, isValidSelectorSyntax);
  const pageHooksRead = readPageHooksSection(input.pageHooks, isValidSelectorSyntax);
  const bridgeRead = readBridgePolicySection(input.bridge);
  const foldersRead = readFoldersSection(input.folders, isValidSelectorSyntax);
  const skinRead = readFolderSkin(input.folderSkin);
  const locatorsRead = readSiteLocators(input.locators, input.id, isValidSelectorSyntax);
  const exportThreadRead = readExportThreadSection(input.exportThread);
  const exportCrawlRead = readExportCrawlSection(input.exportCrawl);
  const timelineRead = readTimelineSection(input.timeline);

  if (!nonEmptyString(input.id) || !SITE_ID_PATTERN.test(input.id)) {
    issues.push({ path: 'id', message: 'must match ^[a-z][a-z0-9-]*$' });
  }
  if (!nonEmptyString(input.label) || input.label.length > MAX_LABEL_LENGTH) {
    issues.push({ path: 'label', message: `required, up to ${MAX_LABEL_LENGTH} chars` });
  }
  if (
    !Array.isArray(input.matches) ||
    input.matches.length === 0 ||
    input.matches.length > MAX_MATCHES ||
    !input.matches.every(isMatchPattern)
  ) {
    issues.push({ path: 'matches', message: 'must be a non-empty array of match patterns' });
  }

  if (
    input.catalogRevision !== undefined &&
    (typeof input.catalogRevision !== 'number' ||
      !Number.isSafeInteger(input.catalogRevision) ||
      input.catalogRevision < 0)
  ) {
    issues.push({ path: 'catalogRevision', message: 'must be a non-negative safe integer' });
  }

  const semanticIssues: ManifestIssue[] = [];
  const bundledSelectors = tolerateSemantic
    ? BUNDLED_LOCATOR_SITES.find((site) => site.id === input.id)?.selectors
    : undefined;
  const selectors = readSelectors(
    input.selectors,
    bundledSelectors ? semanticIssues : issues,
    unknownKeys,
    bundledSelectors,
  );
  const theme = readTheme(input.theme, issues);
  const sectionIssues = [
    ...unknownKeys,
    ...semanticIssues,
    ...modelPickerRead.issues,
    ...projectsRead.issues,
    ...pageHooksRead.issues,
    ...bridgeRead.issues,
    ...foldersRead.issues,
    ...skinRead.issues,
    ...promptRead.issues,
    ...locatorsRead.issues,
    ...exportThreadRead.issues,
    ...exportCrawlRead.issues,
    ...timelineRead.issues,
  ];

  if (input.brandColor !== undefined && !isHexColor(input.brandColor)) {
    issues.push({ path: 'brandColor', message: 'must be a hex colour' });
  }

  const capabilities = new Set<SiteCapability>();
  if (input.capabilities !== undefined) {
    if (!Array.isArray(input.capabilities)) {
      issues.push({ path: 'capabilities', message: 'must be an array' });
    } else {
      input.capabilities.forEach((value, index) => {
        if (isSiteCapability(value)) capabilities.add(value);
        else issues.push({ path: `capabilities[${index}]`, message: 'unknown capability' });
      });
    }
  }

  if (input.conversationIdPattern !== undefined) {
    if (
      !nonEmptyString(input.conversationIdPattern) ||
      input.conversationIdPattern.length > MAX_PATTERN_LENGTH
    ) {
      issues.push({ path: 'conversationIdPattern', message: 'must be a non-empty string' });
    } else if (!isSafeRegexSource(input.conversationIdPattern)) {
      issues.push({
        path: 'conversationIdPattern',
        message:
          'must be a valid regular expression without lookarounds, backreferences or nested quantifiers',
      });
    }
  }

  if (
    input.routeWords !== undefined &&
    (!Array.isArray(input.routeWords) ||
      input.routeWords.length > MAX_ROUTE_WORDS ||
      !input.routeWords.every((word) => typeof word === 'string' && ROUTE_WORD.test(word)))
  ) {
    issues.push({
      path: 'routeWords',
      message: `must be up to ${MAX_ROUTE_WORDS} static route segments of 1-64 lower-case letters, digits, underscores or hyphens`,
    });
  }

  // Newly added route fields stay bundled and must not discard locator repairs.
  const routeIssues = tolerateSemantic ? sectionIssues : issues;
  if (input.accountSlots !== undefined && typeof input.accountSlots !== 'boolean') {
    routeIssues.push({ path: 'accountSlots', message: 'must be a boolean' });
  }

  let conversationRoutes: string[] | undefined;
  if (input.conversationRoutes !== undefined) {
    if (
      Array.isArray(input.conversationRoutes) &&
      input.conversationRoutes.length <= MAX_CONVERSATION_ROUTES &&
      input.conversationRoutes.every(isConversationRoute)
    ) {
      conversationRoutes = input.conversationRoutes.slice();
    } else {
      routeIssues.push({
        path: 'conversationRoutes',
        message: `must be up to ${MAX_CONVERSATION_ROUTES} redacted paths of 1-8 static or :id segments, up to ${MAX_CONVERSATION_ROUTE_LENGTH} chars each`,
      });
    }
  }

  if (
    input.turnKeyAttributes !== undefined &&
    (!Array.isArray(input.turnKeyAttributes) ||
      input.turnKeyAttributes.length === 0 ||
      input.turnKeyAttributes.length > MAX_TURN_KEY_ATTRIBUTES ||
      !input.turnKeyAttributes.every(
        (name) => typeof name === 'string' && ATTRIBUTE_NAME.test(name),
      ))
  ) {
    issues.push({
      path: 'turnKeyAttributes',
      message: `must be 1-${MAX_TURN_KEY_ATTRIBUTES} lower-case attribute names`,
    });
  }

  if (issues.length > 0 || !theme)
    return { result: { success: false, error: issues }, sectionIssues, unknownKeys };

  return {
    sectionIssues,
    unknownKeys,
    result: {
      success: true,
      data: {
        ...(typeof input.catalogRevision === 'number'
          ? { catalogRevision: input.catalogRevision }
          : {}),
        id: input.id as string,
        label: input.label as string,
        matches: (input.matches as string[]).slice(),
        selectors,
        theme,
        ...(typeof input.brandColor === 'string' ? { brandColor: input.brandColor } : {}),
        capabilities,
        ...(typeof input.conversationIdPattern === 'string'
          ? { conversationIdPattern: input.conversationIdPattern }
          : {}),
        ...(Array.isArray(input.routeWords)
          ? { routeWords: (input.routeWords as string[]).slice() }
          : {}),
        ...(typeof input.accountSlots === 'boolean' ? { accountSlots: input.accountSlots } : {}),
        ...(conversationRoutes ? { conversationRoutes } : {}),
        ...(promptRead.prompt ? { prompt: promptRead.prompt } : {}),
        ...(Array.isArray(input.turnKeyAttributes)
          ? { turnKeyAttributes: (input.turnKeyAttributes as string[]).slice() }
          : {}),
        ...(modelPickerRead.modelPicker ? { modelPicker: modelPickerRead.modelPicker } : {}),
        ...(projectsRead.projects ? { projects: projectsRead.projects } : {}),
        ...(pageHooksRead.pageHooks ? { pageHooks: pageHooksRead.pageHooks } : {}),
        ...(bridgeRead.policy ? { bridge: bridgeRead.policy } : {}),
        ...(foldersRead.folders ? { folders: foldersRead.folders } : {}),
        ...(skinRead.folderSkin ? { folderSkin: skinRead.folderSkin } : {}),
        ...(exportConfig ? { export: exportConfig } : {}),
        ...(exportThreadRead.exportThread ? { exportThread: exportThreadRead.exportThread } : {}),
        ...(exportCrawlRead.exportCrawl ? { exportCrawl: exportCrawlRead.exportCrawl } : {}),
        ...(timelineRead.timeline ? { timeline: timelineRead.timeline } : {}),
        ...(locatorsRead.locators ? { locators: locatorsRead.locators } : {}),
      },
    },
  };
}

/** Inverse of `validateSiteAdapterData` for publishing and caching. */
export function siteAdapterToData(adapter: SiteAdapter): SiteAdapterData {
  return {
    ...(adapter.catalogRevision !== undefined ? { catalogRevision: adapter.catalogRevision } : {}),
    id: adapter.id,
    label: adapter.label,
    matches: [...adapter.matches],
    selectors: { ...adapter.selectors },
    theme: { ...adapter.theme },
    ...(adapter.brandColor ? { brandColor: adapter.brandColor } : {}),
    capabilities: [...adapter.capabilities].sort(),
    ...(adapter.conversationIdPattern
      ? { conversationIdPattern: adapter.conversationIdPattern }
      : {}),
    ...(adapter.routeWords ? { routeWords: [...adapter.routeWords] } : {}),
    ...(adapter.accountSlots !== undefined ? { accountSlots: adapter.accountSlots } : {}),
    ...(adapter.conversationRoutes ? { conversationRoutes: [...adapter.conversationRoutes] } : {}),
    ...(adapter.prompt ? { prompt: { ...adapter.prompt } } : {}),
    ...(adapter.turnKeyAttributes ? { turnKeyAttributes: [...adapter.turnKeyAttributes] } : {}),
    ...(adapter.export ? { export: { ...adapter.export } } : {}),
    ...(adapter.exportThread
      ? { exportThread: { ...adapter.exportThread, order: [...adapter.exportThread.order] } }
      : {}),
    ...(adapter.exportCrawl ? { exportCrawl: { ...adapter.exportCrawl } } : {}),
    ...(adapter.timeline ? { timeline: timelineSectionToData(adapter.timeline) } : {}),
    // Without these the refresher's cache write would silently drop the sections.
    ...(adapter.modelPicker ? { modelPicker: { ...adapter.modelPicker } } : {}),
    ...(adapter.projects ? { projects: { ...adapter.projects } } : {}),
    ...(adapter.pageHooks ? { pageHooks: { ...adapter.pageHooks } } : {}),
    ...(adapter.bridge ? { bridge: bridgePolicySectionToData(adapter.bridge) } : {}),
    ...(adapter.folders ? { folders: { ...adapter.folders } } : {}),
    ...(adapter.folderSkin ? { folderSkin: adapter.folderSkin } : {}),
    ...(adapter.locators ? { locators: { ...adapter.locators } } : {}),
  };
}
