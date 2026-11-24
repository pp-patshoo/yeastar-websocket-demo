/**
 * Mock Yeastar P-Series OpenAPI (just the parts this app uses), for testing without a PBX.
 *
 *   npm run mock-yeastar-api -- --port 8088 --client-id demo --client-secret demo-secret
 *
 * In the app: API Base URL = http://localhost:8088, Client ID/Secret as above.
 * Options: --port, --client-id, --client-secret, --token-ttl <s> (default 1800),
 *          --hide-secret (return auth_value as "******")
 */
import http from 'node:http';
import crypto from 'node:crypto';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') ? 'true' : (process.argv[++i] ?? 'true'));
}
const port = Number(args.get('port') ?? 8088);
const clientId = args.get('client-id') ?? 'demo';
const clientSecret = args.get('client-secret') ?? 'demo-secret';
const ttl = Number(args.get('token-ttl') ?? 1800);
const hideSecret = args.has('hide-secret');
const MAX_TOKENS = 8;

const tokens = new Map<string, number>(); // access token -> expiry
const refreshTokens = new Map<string, number>();
let failures = 0;
let blocked = false;

let streamConfig: Record<string, unknown> = {
  enable: 0,
  websocket_url: '',
  auth_key: '',
  auth_value: '',
  sample_rate: 0,
  enable_ext: 0,
  enable_trunk: 0,
  enable_did: 0,
};
let subscribeList: { id: number; subscribe_type: string; subscribe_id: number }[] = [];

const MENUS: Record<string, unknown[]> = {
  extension: [1000, 1001, 1002, 1003, 1004, 1005].map((n, i) => ({ text: `${n} - User ${n}`, value: String(i + 1), type: 'extension' })),
  ext_group: [
    { text: 'Sales', value: '11', type: 'ext_group' },
    { text: 'Support', value: '12', type: 'ext_group' },
  ],
  org_list: [{ text: 'Head Office', value: '21', type: 'org', item: [{ text: 'Bangkok', value: '22', type: 'org' }] }],
  trunk: [
    { text: 'AIS SIP Trunk', value: '31', type: 'trunk' },
    { text: 'True SIP Trunk', value: '32', type: 'trunk' },
  ],
  trunk_did_id: [
    { text: '021234567', value: '41', type: 'did' },
    { text: '029876543', value: '42', type: 'did' },
  ],
};

const newToken = () => crypto.randomBytes(16).toString('hex');
const purge = () => {
  const now = Date.now();
  for (const [t, exp] of tokens) if (exp < now) tokens.delete(t);
};

function issue() {
  purge();
  if (tokens.size >= MAX_TOKENS) return { errcode: 60002, errmsg: 'MAX LIMITATION EXCEEDED' };
  const access = newToken();
  const refresh = newToken();
  tokens.set(access, Date.now() + ttl * 1000);
  refreshTokens.set(refresh, Date.now() + 86400 * 1000);
  return {
    errcode: 0,
    errmsg: 'SUCCESS',
    access_token: access,
    access_token_expire_time: ttl,
    refresh_token: refresh,
    refresh_token_expire_time: 86400,
  };
}

function handle(method: string, path: string, q: URLSearchParams, body: any): unknown {
  if (blocked) return { errcode: 70004, errmsg: 'ACCOUNT IP BLOCKED' };
  if (path === 'get_token' && method === 'POST') {
    if (body?.username !== clientId || body?.password !== clientSecret) {
      failures++;
      if (failures >= 5) blocked = true;
      return { errcode: -1, errmsg: 'FAILURE', invalid_param_list: [{ field: 'username or password', validation_type: 'invalid' }] };
    }
    failures = 0;
    return issue();
  }
  if (path === 'refresh_token' && method === 'POST') {
    const exp = refreshTokens.get(body?.refresh_token);
    if (!exp || exp < Date.now()) return { errcode: 10004, errmsg: 'TOKEN EXPIRED' };
    refreshTokens.delete(body.refresh_token);
    return issue();
  }

  const token = q.get('access_token') ?? '';
  const exp = tokens.get(token);
  if (!exp || exp < Date.now()) return { errcode: 10004, errmsg: 'TOKEN EXPIRED' };

  if (path === 'del_token') {
    tokens.delete(token);
    return { errcode: 0, errmsg: 'SUCCESS' };
  }
  if (path === 'websocketaudiostream/get' && method === 'GET')
    return {
      errcode: 0,
      errmsg: 'SUCCESS',
      config: { ...streamConfig, auth_value: hideSecret && streamConfig.auth_value ? '******' : streamConfig.auth_value },
      subscribe_list: subscribeList,
    };
  if (path === 'websocketaudiostream/update' && method === 'POST') {
    const { subscribe_list, ...rest } = body ?? {};
    if (rest.sample_rate !== undefined && ![0, 1].includes(rest.sample_rate)) return { errcode: 40002, errmsg: 'PARAMETER ERROR' };
    if (Array.isArray(subscribe_list)) {
      if (subscribe_list.some((s: any) => !Number.isInteger(s.subscribe_id))) return { errcode: 40001, errmsg: 'PARAMETER SYNTAX ERROR' };
      subscribeList = subscribe_list.map((s: any, i: number) => ({ id: i + 1, subscribe_type: s.subscribe_type, subscribe_id: s.subscribe_id }));
    }
    streamConfig = { ...streamConfig, ...rest };
    return { errcode: 0, errmsg: 'SUCCESS' };
  }
  if (path === 'system/get_menuoptions' && method === 'GET') {
    const menu = q.get('menu') ?? '';
    if (!(menu in MENUS)) return { errcode: 40002, errmsg: 'PARAMETER ERROR' };
    return { errcode: 0, errmsg: 'SUCCESS', data: MENUS[menu] };
  }
  return { errcode: 10001, errmsg: 'INTERFACE NOT EXISTED' };
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname.replace(/^\/openapi\/v1\.0\//, '');
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: any;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = undefined;
      }
      const ua = req.headers['user-agent'];
      const out = ua ? handle(req.method ?? 'GET', path, url.searchParams, body) : { errcode: 40001, errmsg: 'MISSING USER-AGENT' };
      const shownBody = body?.password ? { ...body, password: '••••' } : body?.auth_value ? { ...body, auth_value: '••••' } : body;
      console.log(`${req.method} /${path} ${shownBody ? JSON.stringify(shownBody) : ''} → ${(out as any).errcode} · tokens=${tokens.size}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  })
  .listen(port, () => console.log(`[mock-yeastar-api] http://localhost:${port}  client-id=${clientId}  token-ttl=${ttl}s`));
