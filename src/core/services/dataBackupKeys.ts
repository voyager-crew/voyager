const BACKUP_PREFIX = 'gvBackup_';
const BACKUP_SLOTS = ['primary', 'emergency', 'beforeUnload', 'metadata'] as const;
type DataBackupSlot = (typeof BACKUP_SLOTS)[number];
const BACKUP_KEY = new RegExp(`^${BACKUP_PREFIX}(.+)_(${BACKUP_SLOTS.join('|')})$`);

export function dataBackupKey(namespace: string, slot: DataBackupSlot): string {
  return `${BACKUP_PREFIX}${namespace}_${slot}`;
}

/** The prefix every slot of `namespace` shares. */
export function dataBackupKeyPrefix(namespace: string): string {
  return `${BACKUP_PREFIX}${namespace}_`;
}

/** The final slot delimiter leaves underscored namespaces intact. */
export function parseDataBackupKey(
  key: string,
): { namespace: string; slot: DataBackupSlot } | null {
  const match = BACKUP_KEY.exec(key);
  return match ? { namespace: match[1], slot: match[2] as DataBackupSlot } : null;
}
