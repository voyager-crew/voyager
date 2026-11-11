import React from 'react';

import type { PanelRow } from '../features/featureRows';
import type { PanelShell } from '../hooks/panelShell';
import { ChipMenu } from './ChipMenu';
import { PanelSwitch } from './PanelSwitch';
import { RangeControl } from './RangeControl';

export const rowSwitchId = (row: PanelRow) => row.switchId ?? `panel-row-${row.id}`;

/**
 * One row of the 功能 tab: icon, name, its controls, then the switch.
 * A creation adds a line under the name, its own actions before the switch,
 * and may replace the switch with an action under that line.
 */
export function FeatureRow({
  row,
  previewing,
  shell,
  sub,
  actions,
  instead,
}: {
  row: PanelRow;
  previewing: boolean;
  shell: PanelShell;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  /** Shown under the name in place of the switch, which then is not drawn. */
  instead?: React.ReactNode;
}) {
  const Icon = row.icon;
  const off = !row.enabled;
  const switchId = rowSwitchId(row);
  // The name toggles too, as in the prototype: it labels the switch.
  const name = instead ? (
    <span className="rn" title={row.name}>
      {row.name}
    </span>
  ) : (
    <label className="rn" htmlFor={switchId} title={row.name}>
      {row.name}
    </label>
  );
  return (
    <div className={off ? 'row off' : 'row'} data-row={row.id}>
      <span className="ri" aria-hidden="true">
        <Icon size={18} strokeWidth={1.75} />
      </span>
      {sub || instead ? (
        <span className="rs">
          {name}
          {sub && <span className="sub cr-sub">{sub}</span>}
          {instead}
        </span>
      ) : (
        name
      )}
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
      {actions}
      {!instead && (
        <PanelSwitch
          id={switchId}
          checked={row.enabled}
          label={row.name}
          title={row.note ?? undefined}
          disabled={row.locked}
          onToggle={row.toggle}
        />
      )}
    </div>
  );
}
