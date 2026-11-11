import React from 'react';

import { ScriptedStopAll } from '@/pages/popup/components/scripted/ScriptedStopAll';

import { PANEL_ROW_SCRIPTED_LOOK } from '../create/scriptedLook';
import { CREATIONS_GROUP, type PanelGroup, featureColumns } from '../features/featureRows';
import type { PanelShell } from '../hooks/panelShell';
import { type CreationContext, CreationRow } from './CreationRow';
import { FeatureRow } from './FeatureRow';

/**
 * The 功能 tab: two columns of groups in reading order, each a label above a
 * card of rows, rising in with a 14ms stagger. My creations heads the first
 * column; when one of its rows runs code, the kill switch for all of them
 * closes its card.
 */
export function FeaturesView({
  groups,
  previewing,
  shell,
  creations,
  emptyText,
}: {
  groups: readonly PanelGroup[];
  /** The page's own site is shown, so sliders preview live. */
  previewing: boolean;
  shell: PanelShell;
  creations: CreationContext;
  emptyText: string;
}) {
  if (groups.length === 0) return <div className="empty">{emptyText}</div>;
  let delay = 0;
  const renderGroup = (group: PanelGroup) => (
    <div key={group.id} className="grp" data-group={group.id}>
      <div className="gl rv" style={{ '--d': delay++ } as React.CSSProperties}>
        {group.label}
      </div>
      <div className="card rv" style={{ '--d': delay++ } as React.CSSProperties}>
        {group.rows.map((row) =>
          row.creation ? (
            <CreationRow
              key={row.id}
              row={row}
              creation={row.creation}
              previewing={previewing}
              shell={shell}
              context={creations}
            />
          ) : (
            <FeatureRow key={row.id} row={row} previewing={previewing} shell={shell} />
          ),
        )}
        {group.id === CREATIONS_GROUP && group.rows.some((row) => row.creation?.code) && (
          <div className="cr-foot">
            <ScriptedStopAll
              scripted={creations.scripted}
              look={PANEL_ROW_SCRIPTED_LOOK}
              t={creations.t}
            />
          </div>
        )}
      </div>
    </div>
  );
  const [start, end] = featureColumns(groups);
  return (
    <div className="cols">
      <div className="col">{start.map(renderGroup)}</div>
      <div className="col">{end.map(renderGroup)}</div>
    </div>
  );
}
