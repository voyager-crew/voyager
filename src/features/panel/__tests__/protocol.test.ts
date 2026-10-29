import { describe, expect, it } from 'vitest';

import {
  PANEL_SHELL_MESSAGE,
  parsePanelShellMessage,
  parsePanelTokenRedeemReply,
} from '../protocol';

describe('panel messages at the window boundary', () => {
  it('accepts finite screen-coordinate deltas and rejects malformed drag/preview values', () => {
    expect(
      parsePanelShellMessage({ kind: PANEL_SHELL_MESSAGE.dragMove, deltaX: -24, deltaY: 12 }),
    ).toEqual({ kind: PANEL_SHELL_MESSAGE.dragMove, deltaX: -24, deltaY: 12 });
    for (const value of [
      { kind: PANEL_SHELL_MESSAGE.dragMove, deltaX: Infinity, deltaY: 1 },
      { kind: PANEL_SHELL_MESSAGE.dragMove, deltaX: 1 },
      { kind: PANEL_SHELL_MESSAGE.preview, pluginId: 'width', settingKey: 'width', value: {} },
      { kind: PANEL_SHELL_MESSAGE.preview, pluginId: 'width', settingKey: 'width', value: NaN },
      { kind: PANEL_SHELL_MESSAGE.fade, faded: 'yes' },
      { kind: 'gv.panel.context', context: {} },
    ])
      expect(parsePanelShellMessage(value)).toBeNull();
    expect(
      parsePanelShellMessage({
        kind: PANEL_SHELL_MESSAGE.preview,
        pluginId: 'width',
        settingKey: 'width',
        value: 72,
      }),
    ).toEqual({
      kind: PANEL_SHELL_MESSAGE.preview,
      pluginId: 'width',
      settingKey: 'width',
      value: 72,
    });
  });

  it('rejects a redeemed session whose host origin does not match its context', () => {
    expect(
      parsePanelTokenRedeemReply({
        ok: true,
        session: {
          sessionId: 'a'.repeat(64),
          hostOrigin: 'https://other.example',
          context: {
            pageUrl: 'https://example.com/',
            siteId: null,
            accountSlot: null,
            scheme: 'dark',
            direction: 'ltr',
          },
        },
      }),
    ).toBeNull();
  });
});
