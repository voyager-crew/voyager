// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chat.deepseek.com/a/chat/s/abc123" }
import { definePluginPairMatrix } from './pluginPairMatrix';

// The page URL is the site's, so host checks (send keys, drafts, timeline) take their real path.
definePluginPairMatrix('deepseek');
