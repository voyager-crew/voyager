import React from 'react';

import { type PanelGroup, type PanelRow, splitColumns } from '../features/featureRows';
import type { PanelShell } from '../hooks/panelShell';
import { ChipMenu } from './ChipMenu';
import { PanelSwitch } from './PanelSwitch';
import { RangeControl } from './RangeControl';

function FeatureRow({
  row,
  previewing,
  shell,
}: {
  row: PanelRow;
  previewing: boolean;
  shell: PanelShell;
}) {
  const Icon = row.icon;
  const off = !row.enabled;
  const switchId = row.switchId ?? `panel-row-${row.id}`;
  return (
    <div className={off ? 'row off' : 'row'} data-row={row.id}>
      <span className="ri" aria-hidden="true">
        <Icon size={18} strokeWidth={1.75} />
      </span>
      {/* The name toggles too, as in the prototype: it labels the switch. */}
      <label className="rn" htmlFor={switchId} title={row.name}>
        {row.name}
      </label>
      {row.slider && (
        <RangeControl
          slider={row.slider}
          disabled={off}
          previewPluginId={previewing ? row.id : null}
          shell={shell}
        />
      )}
      {row.chip && <ChipMenu chip={row.chip} disabled={off} />}
      {row.keyCap && (
        // A key cap reads modifier first in every direction; "⌥" alone would follow an RTL page.
        <span className="kbd" dir="ltr" title={row.keyCap.hint}>
          {row.keyCap.label}
        </span>
      )}
      <PanelSwitch
        id={switchId}
        checked={row.enabled}
        label={row.name}
        title={row.note ?? undefined}
        disabled={row.locked}
        onToggle={row.toggle}
      />
    </div>
  );
}

/**
 * The 功能 tab: two columns of groups in reading order, each a label above a
 * card of rows, rising in with a 14ms stagger.
 */
export function FeaturesView({
  groups,
  previewing,
  shell,
  emptyText,
}: {
  groups: readonly PanelGroup[];
  /** The page's own site is shown, so sliders preview live. */
  previewing: boolean;
  shell: PanelShell;
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
        {group.rows.map((row) => (
          <FeatureRow key={row.id} row={row} previewing={previewing} shell={shell} />
        ))}
      </div>
    </div>
  );
  const [start, end] = splitColumns(groups);
  return (
    <div className="cols">
      <div className="col">{start.map(renderGroup)}</div>
      <div className="col">{end.map(renderGroup)}</div>
    </div>
  );
}
