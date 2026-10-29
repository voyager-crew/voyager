import type { GoogleDriveFiles } from './GoogleDriveFiles';

type Files = Pick<GoogleDriveFiles, 'find' | 'ensure' | 'upload'>;

/** All target lookups finish before any target is created or its content is replaced. */
export class GoogleDriveUploadFiles {
  private readonly names = new Set<string>();
  private readonly ids = new Map<string, string>();
  constructor(private readonly files: Files) {}

  register(...names: string[]): void {
    for (const name of names) this.names.add(name);
  }

  async prepare(token: string): Promise<void> {
    const found: Array<{ name: string; id: string | null }> = [];
    for (const name of this.names) {
      if (!this.ids.has(name)) found.push({ name, id: await this.files.find(token, name) });
    }
    for (const { name, id } of found) {
      this.ids.set(name, await this.files.ensure(token, name, id));
    }
  }

  async write(token: string, name: string, payload: unknown): Promise<void> {
    this.register(name);
    await this.prepare(token);
    const id = this.ids.get(name);
    if (id === undefined) throw new Error('Upload failed');
    await this.files.upload(token, id, payload);
  }
}
