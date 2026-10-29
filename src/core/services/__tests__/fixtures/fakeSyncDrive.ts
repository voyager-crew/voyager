import { createHash } from 'node:crypto';

export interface FakeDriveMetadata {
  id: string;
  name: string;
  mimeType?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  createdTime?: string;
  trashed?: boolean;
  md5Checksum?: string;
  modifiedTime?: string;
}

/** A Drive media store shared by the real transport and sync-service regression tests. */
export class FakeSyncDrive {
  readonly files = new Map<string, string>();
  readonly metadata = new Map<string, FakeDriveMetadata>();
  readonly trashed = new Set<string>();
  readonly failReads = new Set<string>();
  readonly failWrites = new Set<string>();
  readonly failFinds = new Set<string>();
  readonly writes: string[] = [];
  readonly folders = new Map<string, FakeDriveMetadata>();
  beforeFind?: (name: string) => Promise<void>;
  beforeRead?: (name: string) => Promise<void>;
  beforeWrite?: (name: string, body: string) => Promise<void>;
  serverNow?: () => number;
  private sequence = 0;

  private readonly folder = {
    id: 'sync-test-folder',
    name: 'Voyager Data',
    mimeType: 'application/vnd.google-apps.folder',
    appProperties: { voyagerDataFolder: '1' },
  };

  constructor() {
    this.folders.set(this.folder.id, this.folder);
  }

  put(name: string, payload: unknown): void {
    this.files.set(name, JSON.stringify(payload));
    this.metadata.set(name, this.fileMetadata(name));
  }

  histories(source: string, includeTrashed = false): FakeDriveMetadata[] {
    return this.allFiles().filter(
      (file) =>
        file.appProperties?.voyagerHistorySource === source &&
        (includeTrashed || !this.trashed.has(file.id)),
    );
  }

  private fileMetadata(id: string): FakeDriveMetadata {
    const metadata = this.metadata.get(id) ?? {
      id,
      name: id,
      parents: [this.folder.id],
      createdTime: new Date((this.serverNow?.() ?? Date.now()) + this.sequence++).toISOString(),
    };
    // Metadata reads do not themselves create a new cloud version or modification time.
    this.metadata.set(id, metadata);
    return {
      ...metadata,
      md5Checksum: createHash('md5')
        .update(this.files.get(id) ?? '')
        .digest('hex'),
      modifiedTime: metadata.modifiedTime ?? metadata.createdTime,
    };
  }

  private allFiles(): FakeDriveMetadata[] {
    return [...this.files.keys()].map((id) => this.fileMetadata(id));
  }

  private matchesQuery(file: FakeDriveMetadata, query: string): boolean {
    if (query.includes('trashed=false') && this.trashed.has(file.id)) return false;
    const names = [...query.matchAll(/\bname='([^']+)'/g)].map((match) => match[1]);
    if (names.length > 0 && !names.includes(file.name)) return false;
    const parent = /'([^']+)' in parents/.exec(query)?.[1];
    if (parent && !file.parents?.includes(parent)) return false;
    const property = /appProperties has \{ key='([^']+)' and value='([^']+)' \}/.exec(query);
    if (property && file.appProperties?.[property[1]] !== property[2]) return false;
    return true;
  }

  payload<T>(name: string): T {
    const raw = this.files.get(name);
    if (raw === undefined) throw new Error(`No fake Drive file: ${name}`);
    return JSON.parse(raw) as T;
  }

  async createFile(raw: Omit<FakeDriveMetadata, 'id'>, text?: string): Promise<Response> {
    let id = raw.name;
    while (this.files.has(id) || this.folders.has(id)) id = `${raw.name}.id-${this.sequence++}`;
    if (text !== undefined) {
      await this.beforeWrite?.(id, text);
      if (this.failWrites.has(id)) return new Response('', { status: 503 });
    }
    const metadata: FakeDriveMetadata = {
      ...raw,
      id,
      createdTime: new Date((this.serverNow?.() ?? Date.now()) + this.sequence++).toISOString(),
    };
    if (raw.mimeType === 'application/vnd.google-apps.folder') this.folders.set(id, metadata);
    else {
      this.files.set(id, text ?? '');
      this.metadata.set(id, metadata);
      if (text !== undefined) this.writes.push(id);
    }
    return Response.json(metadata);
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const query = url.searchParams.get('q') ?? '';
    if (url.pathname === '/drive/v3/files' && init?.method === 'POST') {
      const raw = JSON.parse(String(init.body)) as Omit<FakeDriveMetadata, 'id'>;
      return this.createFile(raw);
    }
    if (url.pathname === '/upload/drive/v3/files' && init?.method === 'POST') {
      const contentType = new Headers(init.headers).get('Content-Type') ?? '';
      const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
      if (!boundary || url.searchParams.get('uploadType') !== 'multipart') {
        throw new Error('Expected an atomic multipart Drive create');
      }
      const [, metadataPart, mediaPart] = String(init.body).split(`--${boundary}`);
      const metadata = JSON.parse(metadataPart.slice(metadataPart.indexOf('\r\n\r\n') + 4)) as Omit<
        FakeDriveMetadata,
        'id'
      >;
      const text = mediaPart.slice(mediaPart.indexOf('\r\n\r\n') + 4, -2);
      return this.createFile(metadata, text);
    }
    if (url.pathname === '/drive/v3/files') {
      if (query.includes("mimeType='application/vnd.google-apps.folder'")) {
        return Response.json({
          files: [...this.folders.values()].filter((file) => this.matchesQuery(file, query)),
        });
      }
      const name = /name='([^']+)'/.exec(query)?.[1];
      if (name && !query.startsWith('(')) {
        await this.beforeFind?.(name);
        if (this.failFinds.has(name)) return new Response('', { status: 503 });
      }
      return Response.json({
        files: this.allFiles().filter((file) => this.matchesQuery(file, query)),
      });
    }
    const name = url.pathname.split('/').at(-1);
    if (!name) throw new Error(`Unexpected fake Drive URL: ${url}`);
    if (url.pathname.startsWith('/upload/drive/v3/files/')) {
      const body = String(init?.body);
      await this.beforeWrite?.(name, body);
      if (this.failWrites.has(name)) return new Response('', { status: 503 });
      this.files.set(name, body);
      this.metadata.set(name, this.fileMetadata(name));
      const metadata = this.metadata.get(name);
      if (metadata)
        metadata.modifiedTime = new Date(
          (this.serverNow?.() ?? Date.now()) + this.sequence++,
        ).toISOString();
      this.writes.push(name);
      return Response.json(this.fileMetadata(name));
    }
    if (url.searchParams.get('alt') === 'media') {
      await this.beforeRead?.(name);
      if (this.failReads.has(name)) return new Response('', { status: 503 });
      const body = this.files.get(name);
      return body === undefined || this.trashed.has(name)
        ? new Response('', { status: 404 })
        : new Response(body);
    }
    const metadata =
      this.folders.get(name) ?? (this.files.has(name) ? this.fileMetadata(name) : null);
    if (!metadata) return new Response('', { status: 404 });
    if (init?.method === 'PATCH') {
      const changes = JSON.parse(String(init.body)) as Partial<FakeDriveMetadata>;
      Object.assign(metadata, changes);
      if (changes.trashed === true) this.trashed.add(name);
      if (this.files.has(name)) this.metadata.set(name, metadata);
    }
    return Response.json({ ...metadata, trashed: this.trashed.has(name) });
  };
}

export function createSyncStorage(initial: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = structuredClone(initial);
  const area = {
    get: async (keys: string | string[] | null) => {
      const names = keys === null ? Object.keys(values) : [keys].flat();
      return structuredClone(
        Object.fromEntries(
          names.filter((name) => name in values).map((name) => [name, values[name]]),
        ),
      );
    },
    set: async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    },
    remove: async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete values[key];
    },
  };
  return { values, area };
}
