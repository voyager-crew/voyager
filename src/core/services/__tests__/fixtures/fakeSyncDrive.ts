/** A Drive media store shared by the real transport and sync-service regression tests. */
export class FakeSyncDrive {
  readonly files = new Map<string, string>();
  readonly failReads = new Set<string>();
  readonly writes: string[] = [];
  beforeRead?: (name: string) => Promise<void>;
  beforeWrite?: (name: string, body: string) => Promise<void>;

  private readonly folder = {
    id: 'sync-test-folder',
    name: 'Voyager Data',
    mimeType: 'application/vnd.google-apps.folder',
    appProperties: { voyagerDataFolder: '1' },
  };

  put(name: string, payload: unknown): void {
    this.files.set(name, JSON.stringify(payload));
  }

  payload<T>(name: string): T {
    const raw = this.files.get(name);
    if (raw === undefined) throw new Error(`No fake Drive file: ${name}`);
    return JSON.parse(raw) as T;
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const query = url.searchParams.get('q') ?? '';
    if (url.pathname === '/drive/v3/files' && init?.method === 'POST') {
      const metadata = JSON.parse(String(init.body)) as { name: string };
      this.files.set(metadata.name, '');
      return Response.json({ id: metadata.name });
    }
    if (url.pathname === '/drive/v3/files') {
      if (query.includes("mimeType='application/vnd.google-apps.folder'")) {
        return Response.json({ files: [this.folder] });
      }
      if (query.startsWith('(')) return Response.json({ files: [] });
      const name = /name='([^']+)'/.exec(query)?.[1];
      if (!name) throw new Error(`Unexpected fake Drive query: ${query}`);
      return Response.json({ files: this.files.has(name) ? [{ id: name, name }] : [] });
    }
    if (url.pathname === `/drive/v3/files/${this.folder.id}`) {
      return Response.json(this.folder);
    }
    const name = url.pathname.split('/').at(-1);
    if (!name) throw new Error(`Unexpected fake Drive URL: ${url}`);
    if (url.pathname.startsWith('/upload/drive/v3/files/')) {
      const body = String(init?.body);
      await this.beforeWrite?.(name, body);
      this.files.set(name, body);
      this.writes.push(name);
      return Response.json({ id: name });
    }
    if (url.searchParams.get('alt') === 'media') {
      await this.beforeRead?.(name);
      if (this.failReads.has(name)) return new Response('', { status: 503 });
      const body = this.files.get(name);
      return body === undefined ? new Response('', { status: 404 }) : new Response(body);
    }
    return Response.json({ parents: [this.folder.id], trashed: false });
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
