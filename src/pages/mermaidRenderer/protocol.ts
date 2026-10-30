export const MERMAID_RENDERER_PATH = 'src/pages/mermaidRenderer/index.html';
export const MERMAID_RENDERER_CONNECT = 'gv-mermaid-renderer-connect';

export type MermaidTheme = 'dark' | 'light';

export interface MermaidRenderRequest {
  readonly id: string;
  readonly code: string;
  readonly theme: MermaidTheme;
  readonly lightExport: boolean;
}

export interface MermaidRenderResult {
  readonly id: string;
  readonly svg: string;
  readonly lightExportSvg: string | null;
  readonly errorMessage: string | null;
  readonly theme: MermaidTheme;
}

export type MermaidRendererResponse =
  | { readonly type: 'rendered'; readonly result: MermaidRenderResult }
  | { readonly type: 'unavailable' };

export function parseMermaidRequest(value: unknown): MermaidRenderRequest | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !/^mermaid-[a-z0-9-]+$/i.test(value.id) ||
    !('code' in value) ||
    typeof value.code !== 'string' ||
    !('theme' in value) ||
    (value.theme !== 'light' && value.theme !== 'dark') ||
    !('lightExport' in value) ||
    typeof value.lightExport !== 'boolean'
  ) {
    return null;
  }
  return { id: value.id, code: value.code, theme: value.theme, lightExport: value.lightExport };
}

export function parseMermaidResponse(value: unknown): MermaidRendererResponse | null {
  if (typeof value !== 'object' || value === null || !('type' in value)) return null;
  if (value.type === 'unavailable') return { type: 'unavailable' };
  if (value.type !== 'rendered' || !('result' in value)) return null;
  const result = value.result;
  if (
    typeof result !== 'object' ||
    result === null ||
    !('id' in result) ||
    typeof result.id !== 'string' ||
    !('svg' in result) ||
    typeof result.svg !== 'string' ||
    !('lightExportSvg' in result) ||
    (result.lightExportSvg !== null && typeof result.lightExportSvg !== 'string') ||
    !('errorMessage' in result) ||
    (result.errorMessage !== null && typeof result.errorMessage !== 'string') ||
    !('theme' in result) ||
    (result.theme !== 'light' && result.theme !== 'dark')
  ) {
    return null;
  }
  return {
    type: 'rendered',
    result: {
      id: result.id,
      svg: result.svg,
      lightExportSvg: result.lightExportSvg,
      errorMessage: result.errorMessage,
      theme: result.theme,
    },
  };
}
