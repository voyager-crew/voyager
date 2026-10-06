/**
 * Prompt import/export types
 */

/**
 * Prompt item structure (matches prompt manager schema)
 */
export interface PromptItem {
  id: string;
  text: string;
  tags: string[];
  createdAt: number;
  updatedAt?: number;
  /**
   * Optional user-authored label used as the compact-mode headline. Kept in
   * sync with the content-script PromptItem so import/export preserves the
   * field on round-trip.
   */
  name?: string;
  /** Pin timestamp, or `null` once unpinned; kept in sync with the content-script PromptItem. */
  pinnedAt?: number | null;
}

/**
 * Prompt export payload format
 */
export interface PromptExportPayload {
  format: 'gemini-voyager.prompts.v1';
  exportedAt: string;
  version?: string;
  items: PromptItem[];
}
