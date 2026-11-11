/**
 * The panel's two questions about installed creations, answered from this
 * page as it is now: does each restyling creation find anything here
 * (`gv.create.check`), and the message that asks the AI to fix one
 * (`gv.create.fix`). Stored records are re-validated, as every reader does.
 */
import { createPageUrl } from '@/features/plugins/local/authoring/skillLink';
import type {
  CreationCheck,
  CreationFixRequest,
} from '@/features/plugins/local/creation/creationChecks';
import { buildInstalledFixMessage } from '@/features/plugins/local/creation/installedFix';
import type { LocalPluginRecordMap } from '@/features/plugins/local/localPluginStore';
import { validateLocalManifest } from '@/features/plugins/local/validateLocalManifest';
import { matchesAnyPattern } from '@/features/plugins/sites/matchPattern';
import type { PluginManifest, SiteAdapter } from '@/features/plugins/types';
import { fillPlaceholders } from '@/utils/translations';
import type { TranslationKey } from '@/utils/translations';

import { checkCreationOnPage } from './creationCheck';
import { buildPageOutline } from './pageOutline';

export interface CreationPage {
  readonly doc: Document;
  readonly site: SiteAdapter;
  readonly url: string;
}

function readManifest(raw: unknown): PluginManifest | null {
  const result = validateLocalManifest(raw, undefined, {
    hostPolicy: 'defer',
    allowScripted: true,
  });
  return result.success ? result.data.manifest : null;
}

/** Each installed restyling creation whose `matches` cover this page, checked against it. */
export function checkInstalledCreations(
  page: CreationPage,
  records: LocalPluginRecordMap,
): CreationCheck[] {
  const checks: CreationCheck[] = [];
  for (const [id, record] of Object.entries(records)) {
    const manifest = readManifest(record.manifest);
    if (!manifest || manifest.id !== id || manifest.tier === 'scripted') continue;
    if (!matchesAnyPattern(page.url, manifest.matches)) continue;
    const { verdict } = checkCreationOnPage(page.doc, page.site, manifest);
    checks.push({ id, version: manifest.version, verdict });
  }
  return checks;
}

/** The fix message for the creation the panel named; null when it is not installed for this page. */
export function installedFixMessage(
  page: CreationPage,
  records: LocalPluginRecordMap,
  request: CreationFixRequest,
  t: (key: TranslationKey) => string,
): string | null {
  const record = Object.hasOwn(records, request.id) ? records[request.id] : undefined;
  const manifest = record ? readManifest(record.manifest) : null;
  if (!record || !manifest || !matchesAnyPattern(page.url, manifest.matches)) return null;
  const seen =
    request.problem === 'nothing-matches' && manifest.tier !== 'scripted'
      ? checkCreationOnPage(page.doc, page.site, manifest).facts
      : { quietRules: [], quietTargets: [] };
  const outline = request.structure
    ? `${t('createModePageOutlineIntro')}\n\n${buildPageOutline(page.doc, page.site, page.url)}`
    : null;
  return buildInstalledFixMessage({
    intro: fillPlaceholders(t('createModeFixInstalledIntro'), {
      pageUrl: createPageUrl(page.site.id),
    }),
    facts: { ...seen, froze: request.problem === 'froze' },
    outline,
    manifest: record.manifest,
  });
}
