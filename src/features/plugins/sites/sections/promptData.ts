/** Packaged Prompt Manager overrides; omitted fields keep the catalog adapter defaults. */
import type { ManifestIssue } from '../../manifest/validate';

export interface PromptSection {
  readonly slash?: boolean;
  readonly expandCollapsedComposer?: boolean;
  readonly triggerSpot?: 'fab';
  readonly scheme?: 'page';
  readonly highlightScope?: 'aistudio';
}

const PROMPT_FIELDS: readonly string[] = [
  'slash',
  'expandCollapsedComposer',
  'triggerSpot',
  'scheme',
  'highlightScope',
];

export interface PromptSectionRead {
  readonly prompt?: PromptSection;
  readonly issues: readonly ManifestIssue[];
}

/** An unreadable optional section is dropped; other online site repairs remain usable. */
export function readPromptSection(raw: unknown): PromptSectionRead {
  if (raw === undefined) return { issues: [] };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { issues: [{ path: 'prompt', message: 'must be an object' }] };
  }
  const issues: ManifestIssue[] = [];
  for (const key of Object.keys(raw)) {
    if (!PROMPT_FIELDS.includes(key)) {
      issues.push({ path: `prompt.${key}`, message: 'unknown prompt field' });
    }
  }
  const slash = 'slash' in raw ? raw.slash : undefined;
  const expandCollapsedComposer =
    'expandCollapsedComposer' in raw ? raw.expandCollapsedComposer : undefined;
  const triggerSpot = 'triggerSpot' in raw ? raw.triggerSpot : undefined;
  const scheme = 'scheme' in raw ? raw.scheme : undefined;
  const highlightScope = 'highlightScope' in raw ? raw.highlightScope : undefined;
  for (const [key, value] of [
    ['slash', slash],
    ['expandCollapsedComposer', expandCollapsedComposer],
  ]) {
    if (value !== undefined && typeof value !== 'boolean') {
      issues.push({ path: `prompt.${key}`, message: 'must be a boolean' });
    }
  }
  for (const [key, value, allowed] of [
    ['triggerSpot', triggerSpot, 'fab'],
    ['scheme', scheme, 'page'],
    ['highlightScope', highlightScope, 'aistudio'],
  ]) {
    if (value !== undefined && value !== allowed) {
      issues.push({ path: `prompt.${key}`, message: `must be ${allowed}` });
    }
  }
  if (issues.length > 0) return { issues };
  return {
    prompt: {
      ...(typeof slash === 'boolean' ? { slash } : {}),
      ...(typeof expandCollapsedComposer === 'boolean' ? { expandCollapsedComposer } : {}),
      ...(triggerSpot === 'fab' ? { triggerSpot } : {}),
      ...(scheme === 'page' ? { scheme } : {}),
      ...(highlightScope === 'aistudio' ? { highlightScope } : {}),
    },
    issues,
  };
}
