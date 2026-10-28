/**
 * Bulk ops in the owner (DESIGN-v2 §8.2, P3 dormant): one op per one-shot
 * client, applied to the fresh data inside the turn, with `preBulk` written
 * first. Only single-key ops are here. `cloudMerge` writes companion keys and
 * is a bundle; its admission and terminal-outcome contract are still under
 * review (REVIEW-addendum-P3P4 findings 1 and 4), so it is refused unapplied.
 */
import type { FolderData } from '@/core/types/folder';
import type { FolderExportPlatform } from '@/core/types/sync';
import {
  mergeAIStudioImport,
  readAIStudioImportFile,
} from '@/features/folder/model/aistudioImport';
import { FolderImportExportService } from '@/features/folder/services/FolderImportExportService';
import { importChatGptFolders } from '@/features/folder/sites/chatgptTransfer';
import { CLAUDE_TRANSFER } from '@/features/folder/sites/claudeIdentity';
import { DEEPSEEK_TRANSFER } from '@/features/folder/sites/deepseekIdentity';
import type { SiteTransfer } from '@/features/folder/sites/siteTransfer';
import type { ImportResult } from '@/features/folder/types/import-export';

import { type FolderOpBody, type OpOutcome, parseFolderOpBody, rejected } from './folderOps';
import type { FolderSite } from './folderOwnerPolicy';
import type { FolderOwnerMeta, ReadyState } from './folderOwnerState';
import { type WriteCopy, readSlot, writePreBulk } from './ownerBackups';
import { type OwnerTurnContext, type Processed, acknowledge, withClient } from './ownerProcess';

export type BulkBody = Extract<
  FolderOpBody,
  { kind: 'importFile' | 'restoreBackup' | 'cloudMerge' }
>;

const BULK_KINDS = new Set(['importFile', 'restoreBackup', 'cloudMerge']);

export const isBulkBody = (body: unknown): boolean =>
  typeof body === 'object' &&
  body !== null &&
  BULK_KINDS.has((body as { kind?: unknown }).kind as string);

type ImportFile = Extract<BulkBody, { kind: 'importFile' }>;
type Imported =
  | { ok: true; data: FolderData; stats: ImportResult }
  | { ok: false; outcome: OpOutcome };

const refuse = (messageKey: 'folder_import_invalid_format' | 'folder_import_wrong_site') => ({
  ok: false as const,
  outcome: { kind: 'rejected' as const, reason: 'invalid_payload' as const, messageKey },
});

/** Today's Gemini import (`FolderTransferController.import`), without its sessionStorage copy. */
async function importGemini(body: ImportFile, current: FolderData): Promise<Imported> {
  if (FolderImportExportService.exportedPlatform(body.payload) !== null) {
    return refuse('folder_import_wrong_site');
  }
  const validated = FolderImportExportService.validatePayload(body.payload);
  if (!validated.success) return refuse('folder_import_invalid_format');
  const strategy = body.strategy === 'replace' ? 'overwrite' : 'merge';
  const result = await FolderImportExportService.importFromPayload(validated.data, current, {
    strategy,
    createBackup: false,
  });
  return result.success
    ? { ok: true, data: result.data.data, stats: result.data.stats }
    : refuse('folder_import_invalid_format');
}

const MERGE_ONLY: Imported = { ok: false, outcome: rejected('unsupported') };

/** A plugin site's import (merge only, as its panel offers; `replace` is refused unapplied). */
function pluginSiteImporter(importInto: SiteTransfer<FolderExportPlatform>['importInto']) {
  return async (body: ImportFile, current: FolderData): Promise<Imported> => {
    if (body.strategy !== 'merge') return MERGE_ONLY;
    const result = await importInto(body.payload, current);
    if (result.ok) return { ok: true, data: result.data, stats: result.stats };
    return refuse(
      result.reason === 'wrong-site' ? 'folder_import_wrong_site' : 'folder_import_invalid_format',
    );
  };
}

/** Today's AI Studio import (merge only; `replace` is refused unapplied). */
function importAIStudio(body: ImportFile, current: FolderData): Imported {
  if (body.strategy !== 'merge') return MERGE_ONLY;
  const file = readAIStudioImportFile(body.payload);
  if (!file.ok) return refuse(file.messageKey);
  return { ok: true, ...mergeAIStudioImport(current, file.data) };
}

const IMPORTERS: Record<
  FolderSite,
  (body: ImportFile, current: FolderData) => Promise<Imported> | Imported
> = {
  gemini: importGemini,
  chatgpt: pluginSiteImporter(importChatGptFolders),
  aistudio: importAIStudio,
  claude: pluginSiteImporter(CLAUDE_TRANSFER.importInto),
  deepseek: pluginSiteImporter(DEEPSEEK_TRANSFER.importInto),
};

type Target =
  | { ok: true; data: FolderData; outcome: OpOutcome }
  | { ok: false; outcome: OpOutcome };

/** The data a bulk op produces from `state`, read before any backup is written (restore pinning). */
async function targetOf(
  ctx: OwnerTurnContext,
  key: string,
  site: FolderSite,
  state: ReadyState,
  body: BulkBody,
): Promise<Target | 'read_failed'> {
  const current = state.data ?? { folders: [], folderContents: {} };
  if (body.kind === 'importFile') {
    const imported = await IMPORTERS[site](body, current);
    if (!imported.ok) return imported;
    return { ok: true, data: imported.data, outcome: { kind: 'saved', stats: imported.stats } };
  }
  if (body.kind === 'restoreBackup') {
    const data = await readSlot(ctx.area, key, body.slot, state.meta);
    if (data === undefined) return 'read_failed';
    if (data === null) return { ok: false, outcome: rejected('invalid_payload') };
    return { ok: true, data, outcome: { kind: 'saved', restoredFrom: body.slot } };
  }
  // Hook: the cloudMerge bundle (§9) waits for the reviewed admission and receipt rules.
  return { ok: false, outcome: rejected('unsupported') };
}

export interface BulkResult {
  data: FolderData | null;
  outcome: OpOutcome;
  preBulkWritten: boolean;
}

/**
 * Runs one bulk op on `state`. A refused op leaves data untouched; its outcome
 * is still final, so the watermark advances and a resend gets the same answer.
 */
export async function runBulkOp(
  ctx: OwnerTurnContext,
  writeCopy: WriteCopy,
  key: string,
  site: FolderSite,
  state: ReadyState,
  body: BulkBody,
): Promise<BulkResult | 'read_failed'> {
  const target = await targetOf(ctx, key, site, state, body);
  if (target === 'read_failed') return target;
  if (!target.ok) return { data: state.data, outcome: target.outcome, preBulkWritten: false };
  if (state.data && !(await writePreBulk(writeCopy, key, state, ctx.now()))) {
    return { data: state.data, outcome: rejected('backup_failed'), preBulkWritten: false };
  }
  const preBulkWritten = state.data !== null;
  const { outcome } = target;
  const stats = outcome.kind === 'saved' && outcome.stats;
  return {
    data: target.data,
    outcome: stats ? { ...outcome, stats: { ...stats, backupCreated: preBulkWritten } } : outcome,
    preBulkWritten,
  };
}

/** The single bulk op of a batch when it is new to the client, else `null` (duplicates replay). */
export function newBulkOp(
  ops: ReadonlyArray<{ seq: number; body: unknown }>,
  applied: number,
): { seq: number; body: BulkBody } | null {
  if (ops.length !== 1 || ops[0].seq <= applied) return null;
  const body = parseFolderOpBody(ops[0].body);
  return body && isBulkBody(body) ? { seq: ops[0].seq, body: body as BulkBody } : null;
}

/** The turn's result for one bulk op, in the shape of `processOps`. */
export function bulkProcessed(
  meta: FolderOwnerMeta,
  clientId: string,
  seq: number,
  result: BulkResult,
  contact: { ackedThrough: number },
  now: number,
): Processed {
  const client = meta.clients[clientId];
  const outcomes = { ...client.outcomes, [seq]: result.outcome };
  const next = acknowledge({ ...client, applied: seq, outcomes }, contact.ackedThrough, now);
  return {
    data: result.data,
    meta: withClient(meta, clientId, next),
    outcomes: { [seq]: result.outcome },
    preBulkWritten: result.preBulkWritten,
  };
}
