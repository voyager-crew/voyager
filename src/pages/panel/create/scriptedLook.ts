import type { ScriptedLook } from '@/pages/popup/components/scripted/scriptedLook';

/** The panel's look for scripted creations: `create.css`, which follows the panel's scheme. */
export const PANEL_SCRIPTED_LOOK: ScriptedLook = {
  badge: 'create-badge',
  warning: 'create-warn create-strong',
  label: 'create-sub',
  source: 'create-code create-script',
  disclosure: 'create-fold',
  card: 'create-setup',
  title: 'create-setup-title',
  text: 'create-note',
  steps: 'create-list create-steps',
  address: 'create-address',
  alert: 'create-note bad',
  actions: 'create-actions',
  primary: 'pri',
  secondary: 'sec',
};

/**
 * The same parts inside a Features card, where nothing may draw a second box:
 * the fold and the setup steps lose their frames and sit as plain text in the
 * card's flow (`rows.css`).
 */
export const PANEL_ROW_SCRIPTED_LOOK: ScriptedLook = {
  ...PANEL_SCRIPTED_LOOK,
  badge: 'create-badge cr-mark',
  disclosure: 'cr-fold',
  card: 'cr-note',
};
