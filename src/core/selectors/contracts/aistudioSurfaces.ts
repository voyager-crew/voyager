import library from '../../../features/plugins/catalog/sites/aistudio/selector-data/library.json';
import placement from '../../../features/plugins/catalog/sites/aistudio/selector-data/navigation-placement.json';
import navigation from '../../../features/plugins/catalog/sites/aistudio/selector-data/navigation.json';
export const AISTUDIO_SURFACE_PROFILES = { ...library, ...navigation, ...placement };
export const AISTUDIO_SURFACE_KEYS = [
  'library.rows',
  'library.archivableRows',
  'library.table',
  'library.archivableLink',
  'navigation.libraryLink',
  'history.dragHosts',
  'history.click',
  'navigation.promptLink',
  'navigation.navChild',
  'navigation.historyRoot',
  'navigation.sidebar',
  'navigation.anchorSteps',
  'navigation.empty',
  'navigation.bottom',
] as const;
export const AISTUDIO_SURFACE_GROUPS = [
  ['library.rows', 'library.archivableRows', 'library.table', 'library.archivableLink'],
  ['navigation.libraryLink'],
  ['history.dragHosts'],
  ['history.click'],
  ['navigation.promptLink'],
  ['navigation.navChild'],
  ['navigation.historyRoot'],
  ['navigation.sidebar'],
  ['navigation.anchorSteps'],
  ['navigation.empty'],
  ['navigation.bottom'],
] as const;
export const AISTUDIO_SURFACE_FILES = [
  {
    file: 'navigation-placement.json',
    keys: ['navigation.anchorSteps', 'navigation.empty', 'navigation.bottom'],
  },
  {
    file: 'library.json',
    keys: ['library.rows', 'library.archivableRows', 'library.table', 'library.archivableLink'],
  },
  {
    file: 'navigation.json',
    keys: [
      'navigation.libraryLink',
      'history.dragHosts',
      'history.click',
      'navigation.promptLink',
      'navigation.navChild',
      'navigation.historyRoot',
      'navigation.sidebar',
    ],
  },
] as const;
