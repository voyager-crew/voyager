export function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn('[Timeline] Failed to read from localStorage:', error);
    return null;
  }
}

export function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn('[Timeline] Failed to write to localStorage:', error);
  }
}
