import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { GEMINI_ACTIVITY_PROFILE_KEYS } from '../../src/core/gemini/selectors/activityKeys';
import { GEMINI_CANVAS_CODE_PROFILE_KEYS } from '../../src/core/gemini/selectors/canvasKeys';
import { GEMINI_CODE_PROFILE_KEYS } from '../../src/core/gemini/selectors/codeKeys';
import { GEMINI_COMPOSER_PROFILE_KEYS } from '../../src/core/gemini/selectors/composerKeys';
import {
  GEMINI_CONTENT_PROFILE_KEYS,
  GEMINI_CONTEXT_IMAGE_PROFILE_KEYS,
} from '../../src/core/gemini/selectors/contentKeys';
import { GEMINI_GEMS_PROFILE_KEYS } from '../../src/core/gemini/selectors/gemsKeys';
import { GEMINI_GENERATED_IMAGE_PROFILE_KEYS } from '../../src/core/gemini/selectors/generatedImageKeys';
import { GEMINI_IMAGE_EXPORT_PROFILE_KEYS } from '../../src/core/gemini/selectors/imageExportKeys';
import { GEMINI_INPUT_COLLAPSE_PROFILE_KEYS } from '../../src/core/gemini/selectors/inputCollapseKeys';
import { GEMINI_USER_LATEX_PROFILE_KEYS } from '../../src/core/gemini/selectors/mathKeys';
import {
  GEMINI_MENU_PROFILE_KEYS,
  GEMINI_EXPORT_OVERLAY_PROFILE_KEYS,
} from '../../src/core/gemini/selectors/menuKeys';
import { GEMINI_MODEL_PICKER_PROFILE_KEYS } from '../../src/core/gemini/selectors/modelPickerKeys';
import { GEMINI_PROJECT_PROFILE_KEYS } from '../../src/core/gemini/selectors/projectKeys';
import {
  GEMINI_PROMPT_HISTORY_PROFILE_KEYS,
  GEMINI_SLASH_PROFILE_KEYS,
  GEMINI_SENT_CHIPS_PROFILE_KEYS,
} from '../../src/core/gemini/selectors/promptKeys';
import {
  GEMINI_RESPONSE_ACTION_PROFILE_KEYS,
  GEMINI_RESEARCH_PACK_PROFILE_KEYS,
} from '../../src/core/gemini/selectors/responseSurfaceKeys';
import {
  GEMINI_SIDEBAR_WIDTH_PROFILE_KEYS,
  GEMINI_SIDEBAR_HOVER_PROFILE_KEYS,
} from '../../src/core/gemini/selectors/sidebarInteractionKeys';
import { GEMINI_SIDEBAR_PROFILE_KEYS } from '../../src/core/gemini/selectors/sidebarKeys';
import {
  GEMINI_SELECTOR_HOSTS,
  GEMINI_TURN_PROFILE_KEYS,
  GEMINI_V1_SELECTOR_PROFILE_KEYS,
  GEMINI_V2_SELECTOR_PROFILE_KEYS,
  type GeminiSelectorFile,
  type GeminiSelectorProfileKey,
} from '../../src/core/gemini/selectors/types';
import { GEMINI_USAGE_PROFILE_KEYS } from '../../src/core/gemini/selectors/usageKeys';
import {
  MAX_GEMINI_SELECTOR_BYTES,
  readGeminiSelectorFile,
  readGeminiSelectorProfileGroup,
} from '../../src/core/gemini/selectors/validation';
import { GEMINI_VIM_PROFILE_KEYS } from '../../src/core/gemini/selectors/vimKeys';

export interface GeminiSelectorPublishOptions {
  readonly catalogDir: string;
  readonly outDir: string;
  readonly catalogRevision: number;
}

const PROFILE_GROUPS = [
  { file: 'turn.json', keys: GEMINI_TURN_PROFILE_KEYS },
  { file: 'sidebar.json', keys: GEMINI_SIDEBAR_PROFILE_KEYS },
  { file: 'model-picker.json', keys: GEMINI_MODEL_PICKER_PROFILE_KEYS },
  { file: 'composer.json', keys: GEMINI_COMPOSER_PROFILE_KEYS },
  { file: 'input-collapse.json', keys: GEMINI_INPUT_COLLAPSE_PROFILE_KEYS },
  { file: 'vim.json', keys: GEMINI_VIM_PROFILE_KEYS },
  { file: 'prompt-history.json', keys: GEMINI_PROMPT_HISTORY_PROFILE_KEYS },
  { file: 'slash.json', keys: GEMINI_SLASH_PROFILE_KEYS },
  { file: 'sent-chips.json', keys: GEMINI_SENT_CHIPS_PROFILE_KEYS },
  { file: 'project.json', keys: GEMINI_PROJECT_PROFILE_KEYS },
  { file: 'activity.json', keys: GEMINI_ACTIVITY_PROFILE_KEYS },
  { file: 'menu.json', keys: GEMINI_MENU_PROFILE_KEYS },
  { file: 'menu-overlay.json', keys: GEMINI_EXPORT_OVERLAY_PROFILE_KEYS },
  { file: 'sidebar-width.json', keys: GEMINI_SIDEBAR_WIDTH_PROFILE_KEYS },
  { file: 'sidebar-hover.json', keys: GEMINI_SIDEBAR_HOVER_PROFILE_KEYS },
  { file: 'gems.json', keys: GEMINI_GEMS_PROFILE_KEYS },
  { file: 'content.json', keys: GEMINI_CONTENT_PROFILE_KEYS },
  { file: 'context-images.json', keys: GEMINI_CONTEXT_IMAGE_PROFILE_KEYS },
  { file: 'response-actions.json', keys: GEMINI_RESPONSE_ACTION_PROFILE_KEYS },
  { file: 'research-pack.json', keys: GEMINI_RESEARCH_PACK_PROFILE_KEYS },
  { file: 'usage.json', keys: GEMINI_USAGE_PROFILE_KEYS },
  { file: 'code.json', keys: GEMINI_CODE_PROFILE_KEYS },
  { file: 'user-latex.json', keys: GEMINI_USER_LATEX_PROFILE_KEYS },
  { file: 'image-export.json', keys: GEMINI_IMAGE_EXPORT_PROFILE_KEYS },
  { file: 'generated-image.json', keys: GEMINI_GENERATED_IMAGE_PROFILE_KEYS },
  { file: 'canvas-code.json', keys: GEMINI_CANVAS_CODE_PROFILE_KEYS },
] as const;

/** Build from the same locator fragments the package imports; no adapter or plugin enters it. */
export function buildGeminiSelectorFiles(
  options: Pick<GeminiSelectorPublishOptions, 'catalogDir' | 'catalogRevision'>,
): ReadonlyMap<string, GeminiSelectorFile> {
  if (!Number.isSafeInteger(options.catalogRevision) || options.catalogRevision <= 0) {
    throw new Error('Gemini selector publication requires a positive source revision');
  }
  const selectors: Partial<Record<GeminiSelectorProfileKey, readonly string[]>> = {};
  for (const group of PROFILE_GROUPS) {
    const path = join(options.catalogDir, 'sites/gemini/selector-data', group.file);
    const raw = readFileSync(path, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_GEMINI_SELECTOR_BYTES) {
      throw new Error(`${path}: Gemini selector source exceeds the decoded byte limit`);
    }
    const value: unknown = JSON.parse(raw);
    const profiles = readGeminiSelectorProfileGroup<GeminiSelectorProfileKey>(value, group.keys);
    if (!profiles) {
      throw new Error(`${path}: bundled Gemini selector group is incomplete or invalid`);
    }
    Object.assign(selectors, profiles);
  }
  const files = new Map<string, GeminiSelectorFile>();
  for (const host of GEMINI_SELECTOR_HOSTS) {
    const file = readGeminiSelectorFile(
      {
        format: 3,
        site: 'gemini',
        host,
        catalogRevision: options.catalogRevision,
        selectors,
      },
      host,
    );
    if (!file) throw new Error(`${host}: combined Gemini selector data was rejected`);
    files.set(host, file);
  }
  return files;
}

function legacyProjection(file: GeminiSelectorFile, format: 1 | 2): GeminiSelectorFile {
  const keys = format === 1 ? GEMINI_V1_SELECTOR_PROFILE_KEYS : GEMINI_V2_SELECTOR_PROFILE_KEYS;
  const selectors = Object.fromEntries(keys.map((key) => [key, file.selectors[key]] as const));
  const legacy = readGeminiSelectorFile({ ...file, format, selectors }, file.host);
  if (!legacy) throw new Error(`${file.host}: invalid legacy Gemini v${format} projection`);
  return legacy;
}

/** Frozen v1/v2 projections keep released clients from rejecting unfamiliar composer keys. */
export function writeGeminiSelectorFiles(options: GeminiSelectorPublishOptions): readonly string[] {
  const files = buildGeminiSelectorFiles(options);
  const versions = [
    {
      directory: 'v1',
      files: [...files].map(([host, file]) => [host, legacyProjection(file, 1)] as const),
    },
    {
      directory: 'v2',
      files: [...files].map(([host, file]) => [host, legacyProjection(file, 2)] as const),
    },
    { directory: 'v3', files: [...files] },
  ];
  // Validate all versions before writing: a bad v3 must leave the previous publication intact.
  const outputs = versions.map(({ directory, files: versionFiles }) => ({
    hostsDir: join(options.outDir, 'gemini-selectors', directory, 'hosts'),
    serialized: versionFiles.map(([host, file]) => {
      const json = `${JSON.stringify(file, null, 2)}\n`;
      if (Buffer.byteLength(json, 'utf8') > MAX_GEMINI_SELECTOR_BYTES) {
        throw new Error(`${host}: published Gemini selector file exceeds the decoded byte limit`);
      }
      if (!readGeminiSelectorFile(JSON.parse(json) as unknown, host)) {
        throw new Error(`${host}: serialized Gemini selector file was rejected`);
      }
      return { name: `${host}.json`, json };
    }),
  }));
  const written: string[] = [];
  for (const { hostsDir, serialized } of outputs) {
    mkdirSync(hostsDir, { recursive: true });
    for (const { name, json } of serialized) {
      const path = join(hostsDir, name);
      writeFileSync(path, json, 'utf8');
      written.push(path);
    }
    const names = new Set(serialized.map(({ name }) => name));
    for (const name of readdirSync(hostsDir)) {
      if (name.endsWith('.json') && !names.has(name)) rmSync(join(hostsDir, name), { force: true });
    }
  }
  return written;
}
