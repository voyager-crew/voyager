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
import { getTranslationSyncUnsafe, onCachedLanguageChange } from '@/utils/i18n';

/** Which diagram a Diagram button shows; each kind has its own icon. */
export type DiagramKind = 'mermaid' | 'echarts' | 'wavedrom';

export type DiagramToolbarIcon = DiagramKind | 'code' | 'fullscreen';

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

const LABELS: Record<'diagram' | 'code' | 'fullscreen', readonly [key: string, fallback: string]> =
  {
    diagram: ['diagramButton', 'Diagram'],
    code: ['diagramCodeButton', 'Code'],
    fullscreen: ['echartsFullscreenButton', 'Fullscreen'],
  };

const labelOf = (icon: DiagramToolbarIcon): string => {
  const [key, fallback] = LABELS[icon === 'code' || icon === 'fullscreen' ? icon : 'diagram'];
  const text = getTranslationSyncUnsafe(key);
  return text && text !== key ? text : fallback;
};

const labelled = new Map<WeakRef<HTMLButtonElement>, DiagramToolbarIcon>();
let stopFollowingLanguage: (() => void) | null = null;

function applyButton(button: HTMLButtonElement, icon: DiagramToolbarIcon): void {
  const label = labelOf(icon);
  button.replaceChildren(ICONS[icon](ICON_SIZE));
  if (icon === 'fullscreen') {
    button.title = label;
    button.setAttribute('aria-label', label);
  } else {
    button.append(label);
  }
}

// Rendered buttons relabel when the Voyager language changes, not only on the
// next render; refs are weak so removed toolbars are never kept alive.
function relabelAll(): void {
  for (const [ref, icon] of labelled) {
    const button = ref.deref();
    if (button) applyButton(button, icon);
    else labelled.delete(ref);
  }
  if (labelled.size === 0) {
    stopFollowingLanguage?.();
    stopFollowingLanguage = null;
  }
}

/**
 * Gives a toolbar button its icon and label in the Voyager language setting
 * (not the browser locale), and keeps the label in that language as it changes.
 * The fullscreen button is icon-only: its label is the accessible name and tooltip.
 */
export function setDiagramToolbarButton(button: HTMLButtonElement, icon: DiagramToolbarIcon): void {
  applyButton(button, icon);
  labelled.set(new WeakRef(button), icon);
  stopFollowingLanguage ??= onCachedLanguageChange(relabelAll);
}
