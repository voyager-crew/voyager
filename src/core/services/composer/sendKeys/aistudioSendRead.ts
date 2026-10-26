import { packagedSiteInputSelectors } from '../siteInputData';
import { findSendButton } from './sendKeyDom';

/** The native input owner already fixes this root; remote data could only confirm it. */
export function findAIStudioSendButton(input: HTMLElement): HTMLElement | null {
  return findSendButton(input, packagedSiteInputSelectors('aistudio', 'composer.sendContainers'));
}
