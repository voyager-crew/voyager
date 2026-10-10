import type { IconNode } from 'lucide-react';

import { createLucideIcon } from './lucideIcon';

/** Lucide diagram toolbar geometry from lucide-react v0.553.0. */
const WORKFLOW_ICON_NODE = [
  ['rect', { width: '8', height: '8', x: '3', y: '3', rx: '2', key: 'by2w9f' }],
  ['path', { d: 'M7 11v4a2 2 0 0 0 2 2h4', key: 'xkn7yn' }],
  ['rect', { width: '8', height: '8', x: '13', y: '13', rx: '2', key: '1cgmvn' }],
] satisfies IconNode;

const CHART_COLUMN_ICON_NODE = [
  ['path', { d: 'M3 3v16a2 2 0 0 0 2 2h16', key: 'c24i48' }],
  ['path', { d: 'M18 17V9', key: '2bz60n' }],
  ['path', { d: 'M13 17V5', key: '1frdt8' }],
  ['path', { d: 'M8 17v-3', key: '17ska0' }],
] satisfies IconNode;

const AUDIO_WAVEFORM_ICON_NODE = [
  [
    'path',
    {
      d: 'M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2',
      key: '57tc96',
    },
  ],
] satisfies IconNode;

const CODE_XML_ICON_NODE = [
  ['path', { d: 'm18 16 4-4-4-4', key: '1inbqp' }],
  ['path', { d: 'm6 8-4 4 4 4', key: '15zrgr' }],
  ['path', { d: 'm14.5 4-5 16', key: 'e7oirm' }],
] satisfies IconNode;

const MAXIMIZE_2_ICON_NODE = [
  ['path', { d: 'M15 3h6v6', key: '1q9fwt' }],
  ['path', { d: 'm21 3-7 7', key: '1l2asr' }],
  ['path', { d: 'm3 21 7-7', key: 'tjx5ai' }],
  ['path', { d: 'M9 21H3v-6', key: 'wtvkvv' }],
] satisfies IconNode;

export function createWorkflowIcon(size = 16): SVGSVGElement {
  return createLucideIcon('workflow', WORKFLOW_ICON_NODE, size);
}

export function createChartColumnIcon(size = 16): SVGSVGElement {
  return createLucideIcon('chart-column', CHART_COLUMN_ICON_NODE, size);
}

export function createAudioWaveformIcon(size = 16): SVGSVGElement {
  return createLucideIcon('audio-waveform', AUDIO_WAVEFORM_ICON_NODE, size);
}

export function createCodeXmlIcon(size = 16): SVGSVGElement {
  return createLucideIcon('code-xml', CODE_XML_ICON_NODE, size);
}

export function createMaximize2Icon(size = 16): SVGSVGElement {
  return createLucideIcon('maximize-2', MAXIMIZE_2_ICON_NODE, size);
}
