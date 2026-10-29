/** Codec tests use an explicit transport without Drive history, like the iCloud provider. */
const unavailable = async (): Promise<never> => {
  throw new Error('This fixture has no history transport');
};

export const noDriveHistory = {
  metadata: unavailable,
  supportsHistory: () => false,
  downloadText: unavailable,
  uploadText: unavailable,
  createHistory: unavailable,
  listHistory: unavailable,
  trash: unavailable,
};
