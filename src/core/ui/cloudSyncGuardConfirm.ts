/**
 * The confirmation an upload asks for when it would shrink a cloud file or
 * replace one this build cannot read. Merging from the cloud is the safe
 * answer and the primary; uploading anyway is the destructive one, in red text;
 * Cancel holds the focus, so Enter right after it opens changes nothing.
 */
import { guardCanMerge, guardDetails, type Translate } from '@/core/services/cloudSyncNotices';
import type { UploadGuardRefusedFile } from '@/core/types/syncUploadGuard';

import { type ConfirmChoice, askConfirm } from './confirm';

export type UploadGuardAnswer = 'merge' | 'force';

export interface UploadGuardRequest {
  readonly t: Translate;
  /** The site the upload is for, named beside its folders, levels and forks. */
  readonly platform: string;
  readonly refusedFiles: readonly UploadGuardRefusedFile[];
  /** The Upload button that asked; without it the card is centred. */
  readonly anchor?: HTMLElement;
  readonly scheme?: 'light' | 'dark';
  readonly dir?: 'ltr' | 'rtl';
  /** Whether the caller can run a merge download instead. */
  readonly allowMerge: boolean;
}

/** Resolves the answer, or `null` on Cancel, Escape, an outside press or a newer confirm. */
export function askUploadGuard(request: UploadGuardRequest): Promise<UploadGuardAnswer | null> {
  const { t } = request;
  const force: ConfirmChoice<UploadGuardAnswer> = {
    id: 'force',
    label: t('syncGuardForce'),
    emphasis: 'danger',
  };
  const merge: ConfirmChoice<UploadGuardAnswer> = { id: 'merge', label: t('syncGuardMerge') };
  return askConfirm<UploadGuardAnswer>({
    message: t('syncGuardMessage'),
    details: guardDetails(t, request.platform, request.refusedFiles),
    anchor: request.anchor,
    scheme: request.scheme,
    dir: request.dir,
    tone: 'danger',
    choices: request.allowMerge && guardCanMerge(request.refusedFiles) ? [force, merge] : [force],
    cancelLabel: t('pm_cancel'),
  });
}
