/** Public locator names. Attribute meanings, identities and clicks remain packaged. */
export const GEMINI_MODEL_PICKER_PROFILE_KEYS = [
  'modelPicker.trigger',
  'modelPicker.legacyPanels',
  'modelPicker.panelFallback',
  'modelPicker.overlayPane',
  'modelPicker.container',
  'modelPicker.observerRoot',
  'modelPicker.items',
  'modelPicker.modelEvidence',
  'modelPicker.modelIdItem',
  'modelPicker.modelLabel',
  'modelPicker.thinkingLabel',
  'modelPicker.thinkingRow',
  'modelPicker.thinkingItems',
  'modelPicker.thinkingContent',
  'modelPicker.modelTitleContainer',
  'modelPicker.thinkingTitleContainer',
  'modelPicker.focusInput',
] as const;

export type GeminiModelPickerProfileKey = (typeof GEMINI_MODEL_PICKER_PROFILE_KEYS)[number];
