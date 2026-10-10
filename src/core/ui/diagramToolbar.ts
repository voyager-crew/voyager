/**
 * Diagram / Code / fullscreen toolbar buttons shared by Gemini's diagram
 * renderers (Mermaid, ECharts, WaveDrom) and the plugin diagram primitives,
 * so every site shows the same icons and translated labels.
 */
import {
  createAudioWaveformIcon,
  createChartColumnIcon,
  createCodeXmlIcon,
  createMaximize2Icon,
  createWorkflowIcon,
} from '@/core/icons/diagramToolbarIcons';
import { getTranslationSyncUnsafe } from '@/utils/i18n';

/** Which diagram a Diagram button shows; each kind has its own icon. */
export type DiagramKind = 'mermaid' | 'echarts' | 'wavedrom';

export type DiagramToolbarIcon = DiagramKind | 'code' | 'fullscreen';

export interface DiagramToolbarLabels {
  readonly diagram: string;
  readonly code: string;
  readonly fullscreen: string;
}

const ICON_SIZE = 14;

/** Lays an icon and its label side by side; append to the toolbar's `button` rule. */
export const DIAGRAM_TOOLBAR_BUTTON_CSS =
  'display: inline-flex; align-items: center; justify-content: center; gap: 5px;';

const ICONS: Record<DiagramToolbarIcon, (size: number) => SVGSVGElement> = {
  mermaid: createWorkflowIcon,
  echarts: createChartColumnIcon,
  wavedrom: createAudioWaveformIcon,
  code: createCodeXmlIcon,
  fullscreen: createMaximize2Icon,
};

// Follows Voyager's own language setting like the rest of its injected UI;
// chrome.i18n would use the browser locale and show English on a Chinese setup.
function message(key: string, fallback: string): string {
  const text = getTranslationSyncUnsafe(key);
  return text && text !== key ? text : fallback;
}

export function getDiagramToolbarLabels(): DiagramToolbarLabels {
  return {
    diagram: message('diagramButton', 'Diagram'),
    code: message('diagramCodeButton', 'Code'),
    fullscreen: message('echartsFullscreenButton', 'Fullscreen'),
  };
}

/**
 * Gives a toolbar button its icon and visible label. An icon-only button
 * carries the label as its accessible name and tooltip instead.
 */
export function setDiagramToolbarButton(
  button: HTMLButtonElement,
  icon: DiagramToolbarIcon,
  label: string,
  { iconOnly = false }: { iconOnly?: boolean } = {},
): void {
  button.replaceChildren(ICONS[icon](ICON_SIZE));
  if (iconOnly) {
    button.title = label;
    button.setAttribute('aria-label', label);
  } else {
    button.append(label);
  }
}
