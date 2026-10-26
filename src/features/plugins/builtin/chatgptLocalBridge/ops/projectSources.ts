/**
 * `project.files`, `project.upload` and `project.remove` (leased): a project's
 * sources view, on the project the tab already shows (`project.open` first).
 *
 * Two measured behaviours shape them:
 * - ChatGPT ignores an upload under a name the project already lists, without
 *   a word. `project.upload` refuses such a name before any page event, so an
 *   upload is never reported for a file that did not change; the caller
 *   removes the old file first. Success needs the new row, listed once, out of
 *   its uploading state, held for {@link SETTLE_MS}.
 * - 「删除」 in a row's menu removes the file at once: no confirmation, no
 *   toast, no undo. `project.remove` presses it once, for a name listed
 *   exactly once, and succeeds only when the row stays gone.
 *
 * The list loads after the view, from a request that can take seconds; a
 * project with no files shows no row at all. So the rows count only once they
 * name the files ChatGPT sent for the project (`PageData.files`), and an upload
 * or removal only once ChatGPT's answer to it lists the change.
 */
import type {
  ProjectFilesParams,
  ProjectFilesResult,
  ProjectRemoveParams,
  ProjectRemoveResult,
  ProjectUploadParams,
  ProjectUploadResult,
} from '@/features/bridge/protocol';
import { chatgptPageData } from '@/features/plugins/builtin/chatgptPageData';
import type { ProjectsSection } from '@/features/plugins/sites/sections/projectsData';
import type { SiteAdapter } from '@/features/plugins/types';
import { isRendered } from '@/pages/content/export/adapter/chatgptThread';

import type { OpContext } from '../opContext';
import type { PageData } from '../pageData/store';
import { type BlobChunkReader, fetchBlobFile } from './blobBytes';
import { requirePageObserver } from './pageObserver';
import {
  type FileRow,
  ensureSourcesView,
  fileRows,
  filesOf,
  findUploadInput,
  requireProjectPage,
  requireProjectsData,
  timeLeft,
} from './projectPage';

export const SETTLE_MS = 1_500;
const LIST_TIMEOUT_MS = 20_000;
const MENU_TIMEOUT_MS = 3_000;
const REMOVE_TIMEOUT_MS = 10_000;
const UPLOAD_PROGRESS_EVERY_MS = 5_000;
/** Kept back from the grant so the op reports its own failure before the lease runs out. */
const DEADLINE_MARGIN_MS = 1_000;
const BUSY_SELECTOR = chatgptPageData.sourceBusy;
/** The settle windows and the progress beat run on the clock, which no wake reports. */
const CLOCK_RECHECK_MS = 250;

/** Each name as often in `rows` as in `names`. */
function namesMatch(rows: readonly FileRow[], names: readonly string[]): boolean {
  if (rows.length !== names.length) return false;
  const left = rows.map((row) => row.name).sort();
  return [...names].sort().every((name, index) => name === left[index]);
}

/** The sources view's rows once they show the file list ChatGPT sent for the project. */
async function loadedRows(
  ctx: OpContext,
  data: ProjectsSection,
  pageData: PageData,
  projectId: string,
): Promise<FileRow[]> {
  // Two seconds without a change once passed for a whole list; a slow answer showed none.
  const rows = await ctx.waitFor(
    () => {
      const listed = pageData.files(projectId);
      const shown = fileRows(data);
      return listed && namesMatch(shown, listed.names) ? shown : null;
    },
    { timeoutMs: timeLeft(ctx, LIST_TIMEOUT_MS) },
  );
  if (!rows) {
    ctx.fail('unverified', "The project's file list could not be confirmed as loaded.", {
      reason: 'list-unconfirmed',
      listedByChatGpt: pageData.files(projectId)?.names.length ?? null,
      shown: fileRows(data).length,
    });
  }
  return rows;
}

/** ChatGPT's own file list for the project, when it arrived at or after `since`. */
function answerSince(pageData: PageData, projectId: string, since: number) {
  const listed = pageData.files(projectId);
  return listed && listed.source === 'project' && listed.receivedAt >= since ? listed : null;
}

async function openSources(
  ctx: OpContext,
  params: { readonly projectId: string },
  adapter: SiteAdapter | null,
  pageData: PageData,
): Promise<{ data: ProjectsSection; rows: FileRow[] }> {
  const data = requireProjectsData(ctx, adapter);
  requireProjectPage(ctx, data, params.projectId);
  await requirePageObserver(ctx, pageData);
  await ensureSourcesView(ctx, data);
  return { data, rows: await loadedRows(ctx, data, pageData, params.projectId) };
}

export async function runProjectFiles(
  ctx: OpContext,
  params: ProjectFilesParams,
  adapter: SiteAdapter | null,
  pageData: PageData,
): Promise<ProjectFilesResult> {
  const { rows } = await openSources(ctx, params, adapter, pageData);
  return { projectId: params.projectId, files: filesOf(rows) };
}

export async function runProjectUpload(
  ctx: OpContext,
  params: ProjectUploadParams,
  adapter: SiteAdapter | null,
  readChunk: BlobChunkReader,
  pageData: PageData,
): Promise<ProjectUploadResult> {
  const { name } = params.blob;
  const { data, rows } = await openSources(ctx, params, adapter, pageData);
  const refuseListed = (listed: readonly FileRow[]): void => {
    if (!listed.some((row) => row.name === name)) return;
    ctx.fail(
      'bad-request',
      `${name} is already in the project; ChatGPT ignores an upload under a name it holds, so remove it first.`,
      { reason: 'name-exists', name },
    );
  };
  refuseListed(rows);
  if (!findUploadInput(data)) ctx.fail('selector-missing', 'The sources view has no file input.');

  // Every byte is checked before the page sees any of it.
  const file = await fetchBlobFile(ctx, params.blob, readChunk, (bytes) =>
    ctx.progress({ phase: 'transfer', bytes, total: params.blob.size }),
  );
  // The transfer can take a while: look again right before touching the page.
  const input = findUploadInput(data);
  if (!input) ctx.fail('selector-missing', 'The sources view file input went away.');
  refuseListed(fileRows(data));
  const transfer = new DataTransfer();
  transfer.items.add(file);
  ctx.guard();
  input.files = transfer.files;
  if (input.files?.length !== 1) {
    ctx.fail('unverified', 'The file input did not take the file.', { stage: 'input' });
  }
  // Measured: the sources input reacts to `change` alone.
  ctx.dispatch(input, new Event('change', { bubbles: true }));
  ctx.endPageEvents();
  const dispatchedAt = ctx.now();
  const budget = (): number => ctx.grant.deadline - DEADLINE_MARGIN_MS - ctx.now();

  let stableSince: number | null = null;
  let lastProgressAt = dispatchedAt;
  let shownAt: number | null = null;
  let busySeen = false;
  let copies = 0;
  let busy = false;
  let accepted = false;
  const settled = await ctx.waitFor(
    () => {
      const at = ctx.now();
      // The row shows at once; ChatGPT's answer to the upload names the file seconds later.
      const answer = answerSince(pageData, params.projectId, dispatchedAt);
      accepted = !!answer && answer.names.filter((listed) => listed === name).length === 1;
      const mine = fileRows(data).filter((row) => row.name === name);
      copies = mine.length;
      busy = mine.some(
        (row) => !!row.row.querySelector(BUSY_SELECTOR) || row.row.matches(BUSY_SELECTOR),
      );
      busySeen ||= busy;
      if (copies > 0) shownAt ??= at;
      if (at - lastProgressAt >= UPLOAD_PROGRESS_EVERY_MS) {
        lastProgressAt = at;
        ctx.progress({ phase: 'uploading', elapsedMs: at - dispatchedAt, shown: copies > 0, busy });
      }
      if (copies !== 1 || busy || !accepted) {
        stableSince = null;
        return null;
      }
      stableSince ??= at;
      return at - stableSince >= SETTLE_MS ? mine[0] : null;
    },
    { timeoutMs: Math.max(0, budget()), recheckMs: CLOCK_RECHECK_MS },
  );
  const evidence = {
    bytes: params.blob.size,
    shownMs: shownAt === null ? null : shownAt - dispatchedAt,
    busySeen,
    copies,
    accepted,
  };
  if (!settled) {
    if (shownAt === null) {
      ctx.fail('attachment-rejected', 'ChatGPT did not list the uploaded file.', evidence);
    }
    ctx.fail(
      busy ? 'timeout' : 'unverified',
      copies > 1
        ? 'The project lists the uploaded name more than once.'
        : copies === 1 && !accepted
          ? "ChatGPT's answer to the upload did not list the file."
          : 'The upload could not be confirmed as finished.',
      evidence,
    );
  }
  return {
    projectId: params.projectId,
    uploaded: { name: settled.name, uploadedAt: settled.uploadedAt },
    files: filesOf(fileRows(data)),
    evidence: { ...evidence, settledMs: ctx.now() - dispatchedAt },
  };
}

/** Radix menus open on a primary-button pointerdown; jsdom has no `PointerEvent`. */
function pointer(type: 'pointerdown' | 'pointerup'): Event {
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: type === 'pointerdown' ? 1 : 0,
  };
  return typeof PointerEvent === 'function'
    ? new PointerEvent(type, { ...init, pointerType: 'mouse', isPrimary: true, pointerId: 1 })
    : new MouseEvent(type, init);
}

function menuItem(data: ProjectsSection, trigger: HTMLButtonElement): HTMLElement | null {
  const id = trigger.getAttribute('aria-controls');
  const menu = id ? document.getElementById(id) : null;
  if (!menu || !isRendered(menu)) return null;
  const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
    (item) => !!item.querySelector(data.sources.removeIcon) && isRendered(item),
  );
  return items.length === 1 ? items[0] : null;
}

export async function runProjectRemove(
  ctx: OpContext,
  params: ProjectRemoveParams,
  adapter: SiteAdapter | null,
  pageData: PageData,
): Promise<ProjectRemoveResult> {
  const { data, rows } = await openSources(ctx, params, adapter, pageData);
  const matching = rows.filter((row) => row.name === params.name);
  if (matching.length === 0) {
    ctx.fail('not-found', `${params.name} is not in the project.`, {
      name: params.name,
      files: rows.map((row) => row.name),
    });
  }
  if (matching.length > 1) {
    ctx.fail('unverified', `The project lists ${params.name} more than once.`, {
      reason: 'ambiguous',
      copies: matching.length,
    });
  }
  const trigger = matching[0].actions;
  ctx.dispatch(trigger, pointer('pointerdown'));
  ctx.dispatch(trigger, pointer('pointerup'));
  const item = await ctx.waitFor(() => menuItem(data, trigger), {
    timeoutMs: timeLeft(ctx, MENU_TIMEOUT_MS),
  });
  if (!item) ctx.fail('menu-not-found', "The file's menu did not offer to remove it.");
  ctx.click(item);
  // Removal is immediate and final: nothing more is pressed, whatever follows.
  ctx.endPageEvents();
  const clickedAt = ctx.now();
  let goneSince: number | null = null;
  let accepted = false;
  const gone = await ctx.waitFor(
    () => {
      const at = ctx.now();
      // The row goes at once; ChatGPT's answer to the removal comes after it.
      const answer = answerSince(pageData, params.projectId, clickedAt);
      accepted = !!answer && !answer.names.includes(params.name);
      if (!accepted || fileRows(data).some((row) => row.name === params.name)) {
        goneSince = null;
        return null;
      }
      goneSince ??= at;
      return at - goneSince >= SETTLE_MS;
    },
    { timeoutMs: timeLeft(ctx, REMOVE_TIMEOUT_MS), recheckMs: CLOCK_RECHECK_MS },
  );
  if (!gone) {
    ctx.fail(
      'unverified',
      accepted
        ? `${params.name} is still listed after the removal.`
        : `ChatGPT's answer to the removal did not arrive or still lists ${params.name}.`,
      {
        removed: 'unknown',
        accepted,
        dialog: !!document.querySelector('[role="alertdialog"], [role="dialog"]'),
      },
    );
  }
  return {
    projectId: params.projectId,
    removed: params.name,
    files: filesOf(fileRows(data)),
    evidence: { menuItem: (item.textContent ?? '').trim() },
  };
}
