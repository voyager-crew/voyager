/**
 * Admit the Voyager palette on Gemini and AI Studio once initialization passes
 * its coverage checks, the point where Voyager's own UI starts to mount.
 */
import type { OfficialAdmissionController } from '@/features/plugins/runtime/officialAdmission';
import { packagedSiteForUrl } from '@/features/plugins/sites/hostPolicy';

export function admitPalette(admission: OfficialAdmissionController, url: string): void {
  const site = packagedSiteForUrl(url);
  if (site) admission.admit(site, 'palette');
}
