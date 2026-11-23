import React, { useState } from 'react';

import { SlidersHorizontal } from 'lucide-react';

import type { PanelRow } from '../features/featureRows';
import type { PanelShell } from '../hooks/panelShell';
import { ChipMenu } from './ChipMenu';
import { PanelSwitch } from './PanelSwitch';
import { RangeControl } from './RangeControl';

export const rowSwitchId = (row: PanelRow) => row.switchId ?? `panel-row-${row.id}`;

/** The settings a row's slider and chip leave out, each on its own line under the row. */
function RowOptions({
  row,
  id,
  previewing,
  shell,
}: {
  row: PanelRow & { options: NonNullable<PanelRow['options']> };
  id: string;
  previewing: boolean;
  shell: PanelShell;
}) {
  return (
    <div id={id} className="opts" role="group" aria-label={row.options.label}>
      {row.options.items.map((option) => (
        <div key={option.key} className="opt" data-option={option.key}>
          {option.kind === 'switch' ? (
            <>
              <span className="opt-l" aria-hidden="true">
                {option.label}
              </span>
              <PanelSwitch
                checked={option.checked}
                label={option.label}
                disabled={option.disabled}
                onToggle={option.set}
              />
            </>
          ) : option.kind === 'chip' ? (
            <>
              <span className="opt-l" aria-hidden="true">
                {option.chip.label}
              </span>
              <ChipMenu chip={option.chip} disabled={false} />
            </>
          ) : (
            <>
              <span className="opt-l" aria-hidden="true">
                {option.slider.label}
              </span>
              <RangeControl
                slider={option.slider}
                disabled={false}
                previewPluginId={previewing ? row.id : null}
                shell={shell}
              />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * One row of the 功能 tab: icon, name, its controls, then the switch.
 * A creation adds a line under the name, its own actions before the switch,
 * and may replace the switch with an action under that line. A row with more
 * declared settings than its slider and chip opens them under itself.
 */
export function FeatureRow({
  row,
  previewing,
  shell,
  sub,
  actions,
  instead,
  below,
}: {
  row: PanelRow;
  previewing: boolean;
  shell: PanelShell;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  /** Shown under the name in place of the switch, which then is not drawn. */
  instead?: React.ReactNode;
  /** Shown under the name beside the switch, such as an action for a problem. */
  below?: React.ReactNode;
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const Icon = row.icon;
  const off = !row.enabled;
  const switchId = rowSwitchId(row);
  const optionsId = `panel-row-options-${row.id}`;
  // Like the chip, the options rest while the row is off; they keep their values.
  const showOptions = optionsOpen && !off && row.options !== undefined;
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
    <>
      <div className={off ? 'row off' : 'row'} data-row={row.id}>
        <span className="ri" aria-hidden="true">
          <Icon size={18} strokeWidth={1.75} />
        </span>
        {sub || instead || below ? (
          <span className="rs">
            {name}
            {sub && <span className="sub cr-sub">{sub}</span>}
            {instead}
            {below}
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
        {row.options && (
          <button
            type="button"
            className="ib more"
            aria-expanded={showOptions}
            aria-controls={showOptions ? optionsId : undefined}
            aria-label={row.options.label}
            title={row.options.label}
            disabled={off}
            onClick={(event) => {
              event.stopPropagation();
              setOptionsOpen((open) => !open);
            }}
          >
            <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
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
      {showOptions && row.options && (
        <RowOptions
          row={{ ...row, options: row.options }}
          id={optionsId}
          previewing={previewing}
          shell={shell}
        />
      )}
    </>
  );
}
