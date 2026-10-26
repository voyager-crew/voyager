import packaged from '../catalog/sites/chatgpt/selector-data/actions-packaged.json';
import remote from '../catalog/sites/chatgpt/selector-data/actions.json';

/** Baseline values; repaired action reads go through chatgptActionTargets. */
export const chatgptPageData = {
  ...packaged,
  homeLink: remote['actions.homeLink'].join(','),
  thinking: remote['actions.thinking'].join(','),
  temporaryToggle: remote['actions.temporaryToggle'],
  newChat: remote['actions.newChat'].join(','),
  shareButton: remote['actions.shareButton'].join(','),
};
