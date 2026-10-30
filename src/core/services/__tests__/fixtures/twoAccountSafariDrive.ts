import { createHash } from 'node:crypto';

type Account = 'a' | 'b';
type NativeMessage = Record<string, unknown>;

/**
 * The Safari native side with two Google accounts, A signed in first. It keeps the contract of
 * the real handler: a request naming another account than the signed-in one is refused, and an
 * answer names the account that served it. `switchAfter` signs in B right after the first answer
 * to that action leaves, the way the Voyager app can at any moment.
 */
export function createTwoAccountSafariDrive(files: Record<Account, Record<string, unknown>>) {
  const drives: Record<Account, Map<string, string>> = {
    a: new Map(Object.entries(files.a).map(([name, value]) => [name, JSON.stringify(value)])),
    b: new Map(Object.entries(files.b).map(([name, value]) => [name, JSON.stringify(value)])),
  };
  let current: Account = 'a';
  let switchAfter: string | null = null;
  const actions: string[] = [];
  const served: Array<{ account: Account; action: string }> = [];
  const writes: Array<{ account: Account; action: string; name: string }> = [];

  const nameOf = (account: Account) => `account-${account}`;
  /** File IDs belong to one Drive; the other Drive answers as if they did not exist. */
  const fileOf = (id: unknown): string | null => {
    const [account, name] = String(id).split(':');
    return account === current && drives[current].has(name) ? name : null;
  };
  const md5 = (text: string) => createHash('md5').update(text).digest('hex');

  function answer(message: NativeMessage): Record<string, unknown> {
    const drive = drives[current];
    switch (message.action) {
      case 'googleDriveGetSession':
        return { signedIn: true };
      case 'googleDriveFindFile': {
        const name = String(message.fileName);
        return { fileID: drive.has(name) ? `${current}:${name}` : null };
      }
      case 'googleDriveEnsureFile': {
        const name = String(message.fileName);
        if (!drive.has(name)) drive.set(name, '');
        return { fileID: `${current}:${name}` };
      }
      case 'googleDriveGetFileMetadata': {
        const name = fileOf(message.fileID);
        if (name === null) return { found: false };
        const text = drive.get(name) ?? '';
        return {
          found: true,
          id: message.fileID,
          md5Checksum: md5(text),
          modifiedTime: '2026-10-29T00:00:00Z',
        };
      }
      case 'googleDriveDownloadFile': {
        const name = fileOf(message.fileID);
        return name === null ? { found: false } : { found: true, json: drive.get(name) };
      }
      case 'googleDriveUploadFile': {
        const name = fileOf(message.fileID) ?? String(message.fileID).split(':')[1];
        drive.set(name, String(message.json));
        writes.push({ account: current, action: 'upload', name });
        return {
          saved: true,
          id: message.fileID,
          md5Checksum: md5(String(message.json)),
          modifiedTime: '2026-10-29T00:00:00Z',
        };
      }
      case 'googleDriveCreateFile': {
        const name = String(message.fileName);
        drive.set(name, String(message.json));
        writes.push({ account: current, action: 'create', name });
        return { fileID: `${current}:${name}`, name, createdTime: '2026-10-29T00:00:00Z' };
      }
      case 'googleDriveListHistory':
        return { files: [] };
      case 'googleDriveTrashFile':
        writes.push({ account: current, action: 'trash', name: String(message.fileID) });
        return { trashed: true };
      default:
        throw new Error(`Unexpected native action: ${String(message.action)}`);
    }
  }

  async function sendNativeMessage(_app: string, message: NativeMessage) {
    const action = String(message.action);
    actions.push(action);
    if (
      typeof message.expectedDriveAccount === 'string' &&
      message.expectedDriveAccount !== nameOf(current)
    ) {
      return {
        success: false,
        code: 'drive_account_changed',
        error: 'The Google account changed during this sync.',
      };
    }
    const data = answer(message);
    served.push({ account: current, action });
    const response = { success: true, data, driveAccount: nameOf(current) };
    if (switchAfter === action) {
      switchAfter = null;
      current = 'b';
    }
    return response;
  }

  return {
    sendNativeMessage,
    drives,
    actions,
    served,
    writes,
    switchToBAfter(action: string) {
      switchAfter = action;
    },
    switchToB() {
      current = 'b';
    },
    read(account: Account, name: string): unknown {
      const text = drives[account].get(name);
      return text ? JSON.parse(text) : undefined;
    },
  };
}
