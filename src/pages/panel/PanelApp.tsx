import type { PanelSession } from '@/features/panel/protocol';

/** The panel page workstream replaces this authenticated, unstyled placeholder. */
export function PanelApp({ session }: { session: PanelSession }) {
  return <div data-panel-session={session.sessionId} />;
}
