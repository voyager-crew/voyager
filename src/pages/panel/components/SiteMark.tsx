import React from 'react';

import type { PlatformLogo } from '@/core/icons/platformLogos';
import { PlatformMark } from '@/pages/popup/components/WebsiteLogos';

import { type PanelSite, letterTileHue } from '../sites/panelSites';

/** A bundled platform mark in its brand colour, or the text colour where it has none. */
export function SiteLogo({ logo, size }: { logo: PlatformLogo; size: number }) {
  return (
    <span
      className="logo"
      aria-hidden="true"
      style={{ width: size, height: size, color: logo.brand ?? 'currentColor' }}
    >
      <PlatformMark logo={logo} />
    </span>
  );
}

/** A site's mark at text size: its bundled logo, or the first letter of its host on its hue. */
export function SiteGlyph({ site, size }: { site: PanelSite; size: number }) {
  if (site.logo) return <SiteLogo logo={site.logo} size={size} />;
  return (
    <span
      className="mini"
      aria-hidden="true"
      style={{ '--h': letterTileHue(site.host) } as React.CSSProperties}
    >
      {site.host.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * A site's 32px tile: its bundled mark, or the first letter of its host on a
 * hue hashed from the host. Never an icon fetched from a third party.
 */
export function SiteTile({ logo, host }: { logo: PlatformLogo | null; host: string }) {
  if (logo) {
    return (
      <span className="tile">
        <SiteLogo logo={logo} size={18} />
      </span>
    );
  }
  return (
    <span
      className="tile letter"
      aria-hidden="true"
      style={{ '--h': letterTileHue(host) } as React.CSSProperties}
    >
      {host
        .replace(/^www\./, '')
        .charAt(0)
        .toUpperCase()}
    </span>
  );
}
