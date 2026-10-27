import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/image-export-packaged.json';
import profiles from '@/features/plugins/catalog/sites/gemini/selector-data/image-export.json';

import { createImageContent } from './imageContent';

const images = createImageContent({ ...packaged, ...profiles });
export const resolveGeminiImageSrc = images.resolveImageSrc;
export const extractGeminiAssistantImage = images.extractAssistantImage;
export const collectGeminiAssistantImages = images.collectAssistantImages;
