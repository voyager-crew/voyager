/** Reviewed independent native proofs and fixed design §6 protocols only.
 * Counts lock every file/published-fragment pair; another use must be reviewed.
 * Native HTML, CSS, identity/action and Voyager-owned output retain packaged grammar.
 */
import { CONTENT_PROOFS_LITERAL_EXCEPTIONS } from './locatorExceptions/contentProofs';
import { CONTENT_STYLES_LITERAL_EXCEPTIONS } from './locatorExceptions/contentStyles';
import { CONTENT_UI_LITERAL_EXCEPTIONS } from './locatorExceptions/contentUi';
import { EXPORT_FORMATS_LITERAL_EXCEPTIONS } from './locatorExceptions/exportFormats';
import { EXPORT_TARGETS_LITERAL_EXCEPTIONS } from './locatorExceptions/exportTargets';
import { FEATURE_UI_LITERAL_EXCEPTIONS } from './locatorExceptions/featureUi';
import { FOLDER_PROTOCOLS_LITERAL_EXCEPTIONS } from './locatorExceptions/folderProtocols';
import { GEMINI_LITERAL_EXCEPTIONS } from './locatorExceptions/gemini';
import { INPUT_PROTOCOLS_LITERAL_EXCEPTIONS } from './locatorExceptions/inputProtocols';
import { NATIVE_SERVICES_LITERAL_EXCEPTIONS } from './locatorExceptions/nativeServices';
import { PLUGIN_RUNTIME_LITERAL_EXCEPTIONS } from './locatorExceptions/pluginRuntime';
import { PLUGIN_VERBS_LITERAL_EXCEPTIONS } from './locatorExceptions/pluginVerbs';
import { SELECTOR_PROOFS_LITERAL_EXCEPTIONS } from './locatorExceptions/selectorProofs';
import type { LocatorLiteralException } from './locatorExceptions/types';

export const LOCATOR_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  ...CONTENT_PROOFS_LITERAL_EXCEPTIONS,
  ...CONTENT_STYLES_LITERAL_EXCEPTIONS,
  ...CONTENT_UI_LITERAL_EXCEPTIONS,
  ...EXPORT_FORMATS_LITERAL_EXCEPTIONS,
  ...EXPORT_TARGETS_LITERAL_EXCEPTIONS,
  ...FEATURE_UI_LITERAL_EXCEPTIONS,
  ...FOLDER_PROTOCOLS_LITERAL_EXCEPTIONS,
  ...GEMINI_LITERAL_EXCEPTIONS,
  ...INPUT_PROTOCOLS_LITERAL_EXCEPTIONS,
  ...NATIVE_SERVICES_LITERAL_EXCEPTIONS,
  ...PLUGIN_RUNTIME_LITERAL_EXCEPTIONS,
  ...PLUGIN_VERBS_LITERAL_EXCEPTIONS,
  ...SELECTOR_PROOFS_LITERAL_EXCEPTIONS,
];
