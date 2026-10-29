import type { UploadGuardOptions } from '@/core/types/syncUploadGuard';
import { canonicalJson } from '@/core/utils/canonicalHash';

/** A background lifetime owns confirmations; a restart safely requires a new confirmation. */
export class CloudSyncUploadGuardTokens {
  private readonly grants = new Map<string, string>();

  forRequest(
    context: unknown,
    options: { force?: boolean; guardToken?: string },
  ): UploadGuardOptions {
    const captured = canonicalJson(context);
    return {
      authorizeRefusal: (refusal) => {
        const claim = canonicalJson({ context: captured, files: refusal.refusedFiles });
        if (options.force && options.guardToken && this.grants.get(options.guardToken) === claim) {
          this.grants.delete(options.guardToken);
          return { kind: 'allowed' };
        }
        const guardToken = crypto.randomUUID();
        this.grants.set(guardToken, claim);
        // Old confirmations can be safely forgotten; they can never authorize a different upload.
        if (this.grants.size > 64) {
          const oldest = this.grants.keys().next().value;
          if (oldest) this.grants.delete(oldest);
        }
        return { ...refusal, guardToken };
      },
    };
  }
}
