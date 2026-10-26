import library from '@/features/plugins/catalog/sites/aistudio/selector-data/library.json';
import navigation from '@/features/plugins/catalog/sites/aistudio/selector-data/navigation.json';

export const AISTUDIO_SURFACE_PROFILES = { ...library, ...navigation };
export const AISTUDIO_SURFACE_KEYS = [
  'library.rows',
  'library.archivableRows',
  'library.table',
  'navigation.libraryLink',
] as const;
export const AISTUDIO_SURFACE_GROUPS = [
  ['library.rows', 'library.archivableRows', 'library.table'],
  ['navigation.libraryLink'],
] as const;
export const AISTUDIO_SURFACE_FILES = [
  { file: 'library.json', keys: ['library.rows', 'library.archivableRows', 'library.table'] },
  { file: 'navigation.json', keys: ['navigation.libraryLink'] },
] as const;
