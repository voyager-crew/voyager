/** Gemini's catalog-backed Canvas locator supplies the shared native content reader. */
import codeProfiles from '@/features/plugins/catalog/sites/gemini/selector-data/canvas-code.json';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/canvas-packaged.json';

import { resolveFirstCanvasCodeRoot } from '../canvasExport/canvasTargets';
import {
  resolveCanvasDocumentRoots,
  resolveFirstCanvasDocumentRoot,
} from '../canvasExport/documentTargets';
import { createCanvasContent } from './canvasContent';

const reader = createCanvasContent({ ...packaged, ...codeProfiles }, resolveFirstCanvasCodeRoot, {
  first: resolveFirstCanvasDocumentRoot,
  all: resolveCanvasDocumentRoots,
});
export const isAnyCanvasOpen = reader.isAnyCanvasOpen;
export const extractAllCanvasDocs = reader.extractAllCanvasDocs;
export const assistantHasCanvasDoc = reader.assistantHasCanvasDoc;
