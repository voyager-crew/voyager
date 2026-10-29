import React from 'react';

import { PLATFORM_LOGOS, type PlatformLogo, type PlatformLogoId } from '@/core/icons/platformLogos';

/**
 * The popup's renderer for the shared platform marks. Geometry lives in
 * `core/icons/platformLogos` because the changelog draws the same marks in a
 * content script, without React.
 */
export function PlatformMark({ logo }: { logo: PlatformLogo }): React.JSX.Element {
  return (
    <svg viewBox={logo.viewBox} width="100%" height="100%" fill="currentColor">
      {logo.paths.map((d) => (
        <path key={d.slice(0, 24)} d={d} />
      ))}
    </svg>
  );
}

function logo(id: PlatformLogoId): () => React.JSX.Element {
  const Logo = (): React.JSX.Element => <PlatformMark logo={PLATFORM_LOGOS[id]} />;
  return Logo;
}

export const IconChatGPT = logo('chatgpt');
export const IconClaude = logo('claude');
export const IconDeepSeek = logo('deepseek');
export const IconKimi = logo('kimi');
export const IconAIStudio = logo('aistudio');
export const IconGemini = logo('gemini');
export const IconPerplexity = logo('perplexity');
