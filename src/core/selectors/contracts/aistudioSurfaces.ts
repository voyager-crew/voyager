import library from '../../../features/plugins/catalog/sites/aistudio/selector-data/library.json';
import navigation from '../../../features/plugins/catalog/sites/aistudio/selector-data/navigation.json';

export const AISTUDIO_SURFACE_PROFILES = { ...library, ...navigation };
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
] as const;
export const AISTUDIO_SURFACE_GROUPS = [
  ['library.rows', 'library.archivableRows', 'library.table', 'library.archivableLink'],
  ['navigation.libraryLink'],
  ['history.dragHosts'],
  ['history.click'],
  ['navigation.promptLink'],
  ['navigation.navChild', 'navigation.historyRoot', 'navigation.sidebar'],
] as const;
export const AISTUDIO_SURFACE_FILES = [
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
