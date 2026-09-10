import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../app/chatgpt-auth';

let schemaReady: Promise<void> | null = null;

export function db() {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.');
  return binding;
}

export async function ensureSchema() {
  if (!schemaReady) {
    const database = db();
    schemaReady = database
      .batch([
        database.prepare(
          'CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created TEXT NOT NULL)',
        ),
        database.prepare(
          'CREATE INDEX IF NOT EXISTS records_owner_kind ON records (owner, kind)',
        ),
      ])
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  await schemaReady;
}

export async function owner() {
  await ensureSchema();
  const user = await getChatGPTUser();
  if (user) return user.userId;
  if (process.env.NODE_ENV === 'development') return 'local-preview';
  throw new Error('Vui lòng đăng nhập để tiếp tục.');
}

export async function list(user: string, kind: string) {
  await ensureSchema();
  const result = await db()
    .prepare('SELECT payload FROM records WHERE owner = ? AND kind = ? ORDER BY created DESC')
    .bind(user, kind)
    .all<{ payload: string }>();
  return result.results.map((row) => JSON.parse(row.payload));
}

export function put(user: string, kind: string, value: Record<string, unknown>) {
  return db()
    .prepare(
      'INSERT INTO records (id,owner,kind,payload,created) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE records.owner=excluded.owner',
    )
    .bind(
      String(value.id),
      user,
      kind,
      JSON.stringify(value),
      String(value.created || new Date().toISOString()),
    );
}

export function audit(user: string, name: string, status = 'Hoàn tất') {
  return put(user, 'log', {
    id: crypto.randomUUID(),
    name,
    status,
    created: new Date().toISOString(),
  });
}

export function config() {
  const workerEnv = env as unknown as Record<string, string | undefined>;
  return {
    token: workerEnv.META_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || '',
    version: workerEnv.META_API_VERSION || process.env.META_API_VERSION || 'v26.0',
  };
}

type GraphBody = {
  error?: { message?: string; code?: number; error_subcode?: number };
  data?: Record<string, unknown>[];
  paging?: { cursors?: { after?: string }; next?: string };
  [key: string]: unknown;
};

function metaFailure(response: Response, body: GraphBody) {
  const code = body.error?.code || response.status;
  const subcode = body.error?.error_subcode ? `/${body.error.error_subcode}` : '';
  const message = body.error?.message || 'Meta không trả về dữ liệu hợp lệ.';
  return new Error(`Meta ${code}${subcode}: ${message}`);
}

export async function graph(path: string, params: Record<string, string> = {}) {
  const connection = config();
  if (!connection.token) {
    throw new Error('Chưa kết nối Meta. Cần cấu hình META_ACCESS_TOKEN trên máy chủ.');
  }

  const url = new URL(`https://graph.facebook.com/${connection.version}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${connection.token}` },
    signal: AbortSignal.timeout(25000),
  });
  const body = (await response.json()) as GraphBody;
  if (!response.ok || body.error) throw metaFailure(response, body);
  return body;
}

export async function graphPost(path: string, params: Record<string, string>) {
  const connection = config();
  if (!connection.token) {
    throw new Error('Chưa kết nối Meta. Cần cấu hình META_ACCESS_TOKEN trên máy chủ.');
  }

  const response = await fetch(`https://graph.facebook.com/${connection.version}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(25000),
  });
  const body = (await response.json()) as GraphBody;
  if (!response.ok || body.error) throw metaFailure(response, body);
  return body;
}

export async function graphList(path: string, fields: string) {
  let after = '';
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; page < 50; page++) {
    const result = await graph(path, { fields, limit: '100', ...(after ? { after } : {}) });
    rows.push(...(result.data || []));
    if (!result.paging?.next) return rows;
    after = result.paging.cursors?.after || '';
    if (!after) throw new Error('Không đọc được trang tiếp theo của Meta.');
  }
  throw new Error('Dữ liệu vượt giới hạn một lần đồng bộ.');
}
