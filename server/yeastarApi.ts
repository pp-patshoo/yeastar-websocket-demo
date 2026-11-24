import { EventEmitter } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import { settings } from './settingsStore.ts';
import type { ApiState, PbxApiConfig, PbxProfile, RemoteOption, SubscribeType } from '../shared/protocol.ts';

const API_PATH = '/openapi/v1.0';
const USER_AGENT = 'YeastarAudioMonitor/1.0';
const TIMEOUT_MS = 10_000;
const REFRESH_MARGIN_MS = 120_000;

/** Thai explanations for the error codes users are likely to hit. */
const ERROR_TEXT: Record<number, string> = {
  [-2]: 'PBX เกิดข้อผิดพลาดภายใน',
  [-1]: 'คำขอล้มเหลว',
  10001: 'PBX ไม่มี API นี้ (firmware อาจเก่าเกินไป หรือไม่ใช่ Software Edition)',
  10002: 'API เวอร์ชันนี้หมดการดูแลแล้ว',
  10003: 'PBX ไม่รองรับ API เวอร์ชันนี้',
  10004: 'access token หมดอายุ',
  10005: 'ไม่มีสิทธิ์ใช้งาน API นี้',
  10009: 'ดำเนินการไม่สำเร็จ (ฟีเจอร์อาจถูกปิด หรือสิทธิ์ไม่พอ)',
  40001: 'รูปแบบพารามิเตอร์ไม่ถูกต้อง',
  40002: 'ค่าพารามิเตอร์ไม่ถูกต้อง',
  60001: 'ไม่พบข้อมูล',
  60002: 'เกินขีดจำกัด (เช่น token ครบ 8 ตัว)',
  70004: 'IP ของแอปถูก PBX บล็อก — ปลดได้ที่ Security > Security Rules > Blocked IPs',
  70087: 'IP ของแอปไม่ได้รับอนุญาต — เพิ่มที่ Integrations > API > IP Restriction',
  70123: 'ฟีเจอร์ API ใช้งานไม่ได้',
  70656: 'ยังไม่ได้เปิดใช้ API — เปิดที่ Integrations > API ของ PBX',
};

export class YeastarApiError extends Error {
  constructor(
    message: string,
    readonly errcode?: number,
    readonly kind: 'api' | 'network' | 'auth' = 'api',
  ) {
    super(message);
  }
}

function describe(res: any): string {
  const code = Number(res?.errcode);
  const base = ERROR_TEXT[code] ?? 'PBX ตอบกลับว่าไม่สำเร็จ';
  const params = Array.isArray(res?.invalid_param_list)
    ? ` [${res.invalid_param_list.map((p: any) => p.field ?? p.value ?? JSON.stringify(p)).join(', ')}]`
    : '';
  return `${base} (errcode ${res?.errcode} ${res?.errmsg ?? ''})${params}`.replace(/\s+\)/, ')');
}

/** One HTTP(S) request to the PBX; resolves with parsed JSON. */
function rawRequest(cfg: Pick<PbxApiConfig, 'baseUrl' | 'insecureTls'>, method: 'GET' | 'POST', endpoint: string, query: Record<string, string>, body?: unknown): Promise<any> {
  const url = new URL(`${cfg.baseUrl}${API_PATH}/${endpoint}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method,
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        },
        ...(isHttps ? { rejectUnauthorized: !cfg.insecureTls } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new YeastarApiError(`PBX ตอบกลับไม่ใช่ JSON (HTTP ${res.statusCode}) — ตรวจ Base URL และพอร์ต`, undefined, 'network'));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err: NodeJS.ErrnoException) => {
      const tls = /certificate|self[- ]signed|CERT_|UNABLE_TO_VERIFY/i.test(`${err.code} ${err.message}`);
      const msg =
        err.message === 'timeout'
          ? 'หมดเวลารอ PBX (10 วินาที)'
          : err.code === 'ECONNREFUSED'
            ? 'เชื่อมต่อไม่ได้ (ECONNREFUSED) — ตรวจ IP/พอร์ต'
            : tls
              ? `ใบรับรอง HTTPS ไม่ผ่านการตรวจสอบ (${err.code ?? err.message}) — ติ๊ก "ยอมรับใบรับรอง self-signed"`
              : `เชื่อมต่อไม่ได้: ${err.code ?? err.message}`;
      reject(new YeastarApiError(msg, undefined, 'network'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

interface Token {
  access: string;
  accessExp: number;
  refresh: string;
  refreshExp: number;
}

/**
 * Yeastar OpenAPI client for one PBX. Keeps one token pair and reuses it, because a PBX allows
 * only 8 valid tokens per application and blocks the caller's IP after 5 failed logins.
 */
export class YeastarApiClient {
  state: ApiState = 'unknown';
  message?: string;
  private token?: Token;
  private pending?: Promise<string>;

  constructor(
    readonly cfg: PbxApiConfig,
    private onState: () => void = () => {},
  ) {}

  private setState(state: ApiState, message?: string) {
    if (this.state === state && this.message === message) return;
    this.state = state;
    this.message = message;
    this.onState();
  }

  private storeToken(res: any) {
    const now = Date.now();
    this.token = {
      access: res.access_token,
      accessExp: now + Number(res.access_token_expire_time ?? 1800) * 1000,
      refresh: res.refresh_token,
      refreshExp: now + Number(res.refresh_token_expire_time ?? 86400) * 1000,
    };
  }

  private async login(): Promise<string> {
    if (this.state === 'auth_failed')
      throw new YeastarApiError(`${this.message} — แก้ Client ID/Secret แล้วบันทึกก่อนลองใหม่`, undefined, 'auth');
    const res = await rawRequest(this.cfg, 'POST', 'get_token', {}, { username: this.cfg.clientId, password: this.cfg.clientSecret });
    if (Number(res.errcode) !== 0) {
      const msg = describe(res);
      // Wrong credentials: stop here so we never reach the PBX's 5-failures IP block by ourselves.
      if (Number(res.errcode) === -1 || res.invalid_param_list) {
        this.setState('auth_failed', `Client ID หรือ Client Secret ไม่ถูกต้อง: ${msg}`);
        throw new YeastarApiError(this.message!, res.errcode, 'auth');
      }
      throw new YeastarApiError(msg, res.errcode);
    }
    this.storeToken(res);
    return this.token!.access;
  }

  private async refresh(): Promise<string> {
    const old = this.token!;
    const res = await rawRequest(this.cfg, 'POST', 'refresh_token', {}, { refresh_token: old.refresh });
    if (Number(res.errcode) !== 0) {
      this.token = undefined;
      return this.login();
    }
    this.storeToken(res);
    // The old access token may still count toward the 8-token limit until it expires.
    if (old.accessExp > Date.now()) rawRequest(this.cfg, 'GET', 'del_token', { access_token: old.access }).catch(() => {});
    return this.token!.access;
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.accessExp - REFRESH_MARGIN_MS > now) return this.token.access;
    // Coalesce concurrent callers so we never request several tokens at once.
    this.pending ??= (this.token && this.token.refreshExp - REFRESH_MARGIN_MS > now ? this.refresh() : this.login()).finally(
      () => (this.pending = undefined),
    );
    return this.pending;
  }

  /** Authenticated call; retries once with a fresh token on errcode 10004. */
  async call<T = any>(method: 'GET' | 'POST', endpoint: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
    try {
      for (let attempt = 0; ; attempt++) {
        const token = await this.accessToken();
        const res = await rawRequest(this.cfg, method, endpoint, { ...query, access_token: token }, body);
        if (Number(res.errcode) === 10004 && attempt === 0) {
          if (this.token) this.token.accessExp = 0;
          continue;
        }
        if (Number(res.errcode) !== 0) throw new YeastarApiError(describe(res), res.errcode);
        this.setState('ok');
        return res as T;
      }
    } catch (err) {
      if (this.state !== 'auth_failed') this.setState('error', (err as Error).message);
      throw err;
    }
  }

  /** Give the token back to the PBX (keeps us under the 8-token limit). */
  async revoke() {
    const t = this.token;
    this.token = undefined;
    if (!t || t.accessExp < Date.now()) return;
    try {
      await rawRequest(this.cfg, 'GET', 'del_token', { access_token: t.access });
    } catch {
      /* best effort */
    }
  }
}

// ---- Registry: one client per PBX profile ----

const MENUS: Record<SubscribeType, string> = {
  extension: 'extension',
  ext_group: 'ext_group',
  organization: 'org_list',
  trunk: 'trunk',
  did: 'trunk_did_id',
};

const sameCfg = (a: PbxApiConfig, b: PbxApiConfig) =>
  a.baseUrl === b.baseUrl && a.clientId === b.clientId && a.clientSecret === b.clientSecret && a.insecureTls === b.insecureTls;

/** Events: change(pbxId) when a client's API state changes. */
class ApiRegistry extends EventEmitter {
  private clients = new Map<string, YeastarApiClient>();
  private optionsCache = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor() {
    super();
    settings.on('change', (what: string, id: string, kind: string) => {
      if (what !== 'pbx') return;
      const profile = settings.getPbx(id);
      const existing = this.clients.get(id);
      // Saving the profile again also clears an auth_failed lock (the user has looked at the credentials).
      if (existing && (kind === 'deleted' || !profile?.api || !sameCfg(existing.cfg, profile.api) || existing.state === 'auth_failed')) {
        this.clients.delete(id);
        this.optionsCache.delete(id);
        void existing.revoke();
        this.emit('change', id);
      }
    });
  }

  client(profile: PbxProfile): YeastarApiClient {
    if (!profile.api) throw new YeastarApiError('ยังไม่ได้ตั้งค่า Yeastar API ของ PBX นี้');
    let c = this.clients.get(profile.id);
    if (!c) {
      c = new YeastarApiClient(profile.api, () => this.emit('change', profile.id));
      this.clients.set(profile.id, c);
    }
    return c;
  }

  status(profile: PbxProfile): { state: ApiState; message?: string } {
    if (!profile.api) return { state: 'none' };
    const c = this.clients.get(profile.id);
    return c ? { state: c.state, message: c.message } : { state: 'unknown' };
  }

  /** Subscribe options from get_menuoptions, cached for 60 s. */
  options(profile: PbxProfile, force = false) {
    const cached = this.optionsCache.get(profile.id);
    if (!force && cached && Date.now() - cached.at < 60_000) return cached.value as ReturnType<typeof this.loadOptions>;
    const value = this.loadOptions(profile);
    this.optionsCache.set(profile.id, { at: Date.now(), value });
    value.catch(() => this.optionsCache.delete(profile.id));
    return value;
  }

  private async loadOptions(profile: PbxProfile) {
    const client = this.client(profile);
    const options = {} as Record<SubscribeType, RemoteOption[]>;
    const errors: Partial<Record<SubscribeType, string>> = {};
    // Sequential: keeps load on the PBX low and avoids parallel token requests.
    for (const [type, menu] of Object.entries(MENUS) as [SubscribeType, string][]) {
      try {
        const res = await client.call<{ data?: any[] }>('GET', 'system/get_menuoptions', { menu });
        options[type] = flattenMenu(res.data ?? []);
      } catch (err) {
        options[type] = [];
        errors[type] = (err as Error).message;
        if (err instanceof YeastarApiError && err.kind !== 'api') break; // network/auth: no point continuing
      }
    }
    for (const t of Object.keys(MENUS) as SubscribeType[]) options[t] ??= [];
    return { options, errors };
  }

  async revokeAll() {
    await Promise.all([...this.clients.values()].map((c) => c.revoke()));
  }
}

function flattenMenu(items: any[], prefix = ''): RemoteOption[] {
  const out: RemoteOption[] = [];
  for (const it of items) {
    const id = Number(it.value);
    const text = `${prefix}${it.text ?? it.value}`;
    if (Number.isFinite(id)) out.push({ id, text });
    if (Array.isArray(it.item)) out.push(...flattenMenu(it.item, `${text} / `));
  }
  return out;
}

export const apiRegistry = new ApiRegistry();

/** Test credentials from the form without touching the cached client; always revokes the token. */
export async function testApi(cfg: PbxApiConfig): Promise<{ ok: boolean; message: string }> {
  const client = new YeastarApiClient(cfg);
  const started = Date.now();
  try {
    const res = await client.call('GET', 'websocketaudiostream/get');
    const enabled = Number(res.config?.enable) === 1;
    return {
      ok: true,
      message: `เชื่อมต่อสำเร็จ (${Date.now() - started} ms) · WebSocket Audio Streaming บน PBX ${enabled ? 'เปิดอยู่' : 'ปิดอยู่'}`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  } finally {
    await client.revoke();
  }
}
