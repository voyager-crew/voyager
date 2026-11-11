import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Trash2 } from 'lucide-react';

import { inspectPlugin } from '@/features/plugins/local/inspectPlugin';
import { siteNames } from '@/pages/popup/components/LocalPluginInspection';
import { ScriptedBadge, ScriptedSource } from '@/pages/popup/components/scripted/ScriptedSource';
import { ScriptedTurnOn } from '@/pages/popup/components/scripted/ScriptedTurnOn';
import type { ScriptedCreations } from '@/pages/popup/hooks/useScriptedCreations';
import type { TranslationKey } from '@/utils/translations';

import { PANEL_ROW_SCRIPTED_LOOK as LOOK } from '../create/scriptedLook';
import {
  CREATIONS_GROUP,
  type PanelCodeCreation,
  type PanelCreation,
  type PanelRow,
} from '../features/featureRows';
import type { PanelShell } from '../hooks/panelShell';
import { fillPlaceholders } from '../panelText';
import { FeatureRow, rowSwitchId } from './FeatureRow';
import { panelTabId } from './TopBar';

type Translate = (key: TranslationKey) => string;

/** What the creations rows share: the popup's scripted state and the site they turn on for. */
export interface CreationContext {
  readonly scripted: ScriptedCreations;
  /** The site being viewed, whose access a turn-on asks for. */
  readonly activeUrl: string;
  readonly t: Translate;
}

/** The review a creation that runs code needs before it turns on: its warning, code and Turn on. */
function CodeReview({
  code,
  context,
  onEnabled,
}: {
  code: PanelCodeCreation;
  context: CreationContext;
  onEnabled: () => void;
}) {
  const { manifest } = code;
  const sites = useMemo(() => siteNames(inspectPlugin(manifest).sites), [manifest]);
  return (
    <>
      <ScriptedSource
        source={manifest.contributes.script.source}
        sites={sites}
        look={LOOK}
        t={context.t}
      />
      <ScriptedTurnOn
        manifest={manifest}
        scripted={context.scripted}
        activeUrl={context.activeUrl}
        look={LOOK}
        t={context.t}
        onEnabled={onEnabled}
      />
    </>
  );
}

/**
 * A creation in My creations: a feature row with a remove action. One that
 * runs code shows the popup's mark and run state; while it is not on, its
 * switch gives way to "Review and turn on", which opens its code in the flow
 * below the row. Removing asks first, in the same place.
 */
export function CreationRow({
  row,
  creation,
  previewing,
  shell,
  context,
}: {
  row: PanelRow;
  creation: PanelCreation;
  previewing: boolean;
  shell: PanelShell;
  context: CreationContext;
}) {
  const { t } = context;
  const { code } = creation;
  const [open, setOpen] = useState<'review' | 'remove' | null>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const reviewable = code !== null && !row.enabled;
  const reviewing = open === 'review' && reviewable;
  const moreId = `panel-creation-${row.id}`;

  useEffect(() => {
    if (open === 'remove') cancelButton.current?.focus();
  }, [open]);

  const toggle = (next: 'review' | 'remove') => setOpen((now) => (now === next ? null : next));
  const cancelRemove = () => {
    setOpen(null);
    removeButton.current?.focus();
  };
  const remove = async () => {
    if (!(await creation.remove())) return;
    // The row is gone; the next control in the group, or the tab, takes focus.
    requestAnimationFrame(() => {
      const next =
        document.querySelector<HTMLElement>(`[data-group="${CREATIONS_GROUP}"] button`) ??
        document.getElementById(panelTabId('features'));
      next?.focus({ preventScroll: true });
    });
  };
  const enabled = () => {
    setOpen(null);
    requestAnimationFrame(() => document.getElementById(rowSwitchId(row))?.focus());
  };

  return (
    <>
      <FeatureRow
        row={row}
        previewing={previewing}
        shell={shell}
        sub={
          code && (
            <>
              <ScriptedBadge look={LOOK} t={t} />
              <span data-testid="scripted-state">{code.state}</span>
            </>
          )
        }
        actions={
          <button
            ref={removeButton}
            type="button"
            className="ib x"
            aria-label={fillPlaceholders(t('panelCreationRemove'), { name: row.name })}
            aria-expanded={open === 'remove'}
            aria-controls={open === 'remove' ? moreId : undefined}
            onClick={() => toggle('remove')}
          >
            <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        }
        instead={
          reviewable ? (
            <button
              type="button"
              className="cr-review"
              aria-expanded={reviewing}
              aria-controls={reviewing ? moreId : undefined}
              onClick={() => toggle('review')}
            >
              {t(reviewing ? 'localPluginsHideDetails' : 'scriptedReviewAndTurnOn')}
            </button>
          ) : undefined
        }
      />
      {open === 'remove' && (
        <div id={moreId} className="cr-more" role="group" aria-label={row.name}>
          <p className="create-note">
            {fillPlaceholders(t('panelCreationRemoveAsk'), { name: row.name })}
          </p>
          <div className="create-actions">
            <button ref={cancelButton} type="button" className="sec" onClick={cancelRemove}>
              {t('localPluginsCancel')}
            </button>
            <button type="button" className="sec risk" onClick={() => void remove()}>
              {t('localPluginsRemove')}
            </button>
          </div>
        </div>
      )}
      {reviewing && code && (
        <div id={moreId} className="cr-more" data-testid="creation-review">
          <CodeReview code={code} context={context} onEnabled={enabled} />
        </div>
      )}
    </>
  );
}
