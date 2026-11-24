import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config } from './config.ts';
import type { AiSettingsUpdate, AiSettingsView, PbxProfile, PbxProfileUpdate } from '../shared/protocol.ts';

const ApiConfigSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .max(255)
    .regex(/^https?:\/\/[^\s/]+(:\d+)?\/?$/i, 'ต้องเป็นรูปแบบ https://IP:พอร์ต เช่น https://192.168.1.10:8088')
    .transform((s) => s.replace(/\/+$/, '')),
  clientId: z.string().trim().min(1, 'กรอก Client ID').max(255),
  clientSecret: z.string().max(255),
  insecureTls: z.boolean(),
});

const ProfileFields = {
  name: z.string().trim().min(1, 'กรอกชื่อ PBX').max(60),
  enabled: z.boolean(),
  authKey: z.string().trim().max(63).regex(/^[A-Za-z0-9_-]*$/, 'ใช้ได้เฉพาะ A-Z a-z 0-9 _ -'),
  authValue: z.string().max(255),
  sampleRate: z.union([z.literal(8000), z.literal(16000)]),
  allowedIps: z.array(z.string().trim().min(1)).max(50),
  appHost: z.string().trim().max(255).regex(/^[A-Za-z0-9.\-:[\]]*$/, 'ใส่เฉพาะ IP หรือ hostname'),
};

const ProfileSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), ...ProfileFields, api: ApiConfigSchema.nullable() });

export const ProfileUpdateSchema = z.object({
  ...ProfileFields,
  api: ApiConfigSchema.extend({ clientSecret: z.string().max(255).optional() }).nullable(),
});

const AiSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.literal('deepgram'),
  apiKey: z.string(),
  model: z.string().trim().min(1).max(64),
  language: z.string().trim().min(1).max(32),
  interimResults: z.boolean(),
  smartFormat: z.boolean(),
});

export const AiSettingsUpdateSchema = AiSettingsSchema.omit({ apiKey: true }).extend({
  apiKey: z.string().trim().max(200).optional(),
  clearApiKey: z.boolean().optional(),
});

const FileSchema = z.object({ pbxList: z.array(ProfileSchema), ai: AiSettingsSchema });

export type AiSettings = z.infer<typeof AiSettingsSchema>;
type SettingsFile = z.infer<typeof FileSchema>;

const filePath = path.join(config.dataDir, 'settings.json');

export class ValidationError extends Error {}

export function maskSecret(value: string): string {
  if (!value) return '';
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

export function randomSecret() {
  return crypto.randomBytes(18).toString('base64url').slice(0, 24);
}

function newId(name: string, taken: Set<string>) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'pbx';
  let id: string;
  do id = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
  while (taken.has(id));
  return id;
}

function defaultProfile(id: string, name: string, overrides: Partial<PbxProfile> = {}): PbxProfile {
  return {
    id,
    name,
    enabled: true,
    authKey: 'auth_key',
    authValue: randomSecret(),
    sampleRate: 8000,
    allowedIps: [],
    appHost: '',
    api: null,
    ...overrides,
  };
}

/**
 * Settings persisted in data/settings.json.
 * Events: change('ai') · change('pbx', id, kind: 'added'|'updated'|'deleted', before?: PbxProfile)
 */
class SettingsStore extends EventEmitter {
  private data: SettingsFile;

  constructor() {
    super();
    this.data = this.load();
  }

  private load(): SettingsFile {
    const d = config.defaults;
    const defaults: SettingsFile = {
      pbxList: [defaultProfile('pbx-1', 'PBX 1', { ...d.pbx, authValue: d.pbx.authValue || randomSecret() })],
      ai: { ...d.ai },
    };
    let raw: any;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[settings] cannot read settings.json:', err);
      return defaults;
    }
    // Migrate the single-PBX format ({ pbx: {...} }) to a list.
    let pbxList = raw.pbxList;
    if (!Array.isArray(pbxList)) {
      pbxList = [defaultProfile('pbx-1', 'PBX 1', { ...d.pbx, ...(raw.pbx ?? {}) })];
      console.log('[settings] migrated single PBX settings to "PBX 1"');
    }
    pbxList = pbxList.map((p: any) => ({ ...defaultProfile(p.id ?? 'pbx', p.name ?? 'PBX'), ...p }));
    const parsed = FileSchema.safeParse({ pbxList, ai: { ...defaults.ai, ...raw.ai } });
    if (parsed.success) {
      this.data = parsed.data;
      if (!Array.isArray(raw.pbxList)) this.save();
      return parsed.data;
    }
    console.warn('[settings] invalid settings.json, using defaults:', parsed.error.message);
    return defaults;
  }

  private save() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, filePath);
  }

  // ---- PBX profiles ----

  get pbxList(): readonly PbxProfile[] {
    return this.data.pbxList;
  }

  getPbx(id: string): PbxProfile | undefined {
    return this.data.pbxList.find((p) => p.id === id);
  }

  pbxName(id: string) {
    return this.getPbx(id)?.name ?? id;
  }

  /** A secret must identify exactly one PBX (the PBX may drop the URL path). */
  private checkUnique(profile: PbxProfile) {
    for (const p of this.data.pbxList) {
      if (p.id === profile.id) continue;
      if (profile.authValue && p.authValue === profile.authValue)
        throw new ValidationError(`Secret ซ้ำกับ "${p.name}" — แต่ละ PBX ต้องใช้ Secret ต่างกัน`);
      if (p.name === profile.name) throw new ValidationError(`มี PBX ชื่อ "${p.name}" อยู่แล้ว`);
    }
  }

  addPbx(name?: string): PbxProfile {
    const taken = new Set(this.data.pbxList.map((p) => p.id));
    let n = this.data.pbxList.length + 1;
    let finalName = name?.trim() || `PBX ${n}`;
    while (this.data.pbxList.some((p) => p.name === finalName)) finalName = `PBX ${++n}`;
    const profile = defaultProfile(newId(finalName, taken), finalName);
    this.data = { ...this.data, pbxList: [...this.data.pbxList, profile] };
    this.save();
    this.emit('change', 'pbx', profile.id, 'added');
    return profile;
  }

  updatePbx(id: string, update: PbxProfileUpdate): PbxProfile {
    const before = this.getPbx(id);
    if (!before) throw new ValidationError('ไม่พบ PBX นี้');
    const u = ProfileUpdateSchema.parse(update);
    const api = u.api
      ? { ...u.api, clientSecret: u.api.clientSecret ? u.api.clientSecret : (before.api?.clientSecret ?? '') }
      : null;
    if (api && !api.clientSecret) throw new ValidationError('กรอก Client Secret');
    const next = ProfileSchema.parse({ ...u, id, api });
    this.checkUnique(next);
    this.data = { ...this.data, pbxList: this.data.pbxList.map((p) => (p.id === id ? next : p)) };
    this.save();
    this.emit('change', 'pbx', id, 'updated', before);
    return next;
  }

  deletePbx(id: string) {
    const before = this.getPbx(id);
    if (!before) throw new ValidationError('ไม่พบ PBX นี้');
    this.data = { ...this.data, pbxList: this.data.pbxList.filter((p) => p.id !== id) };
    this.save();
    this.emit('change', 'pbx', id, 'deleted', before);
  }

  // ---- AI ----

  get ai(): AiSettings {
    return this.data.ai;
  }

  aiView(): AiSettingsView {
    const { apiKey, ...rest } = this.data.ai;
    return { ...rest, hasApiKey: apiKey.length > 0, apiKeyMasked: maskSecret(apiKey) };
  }

  updateAi(update: AiSettingsUpdate) {
    const { apiKey, clearApiKey, ...rest } = AiSettingsUpdateSchema.parse(update);
    const key = clearApiKey ? '' : apiKey ? apiKey : this.data.ai.apiKey;
    this.data = { ...this.data, ai: AiSettingsSchema.parse({ ...rest, apiKey: key }) };
    this.save();
    this.emit('change', 'ai');
  }
}

export const settings = new SettingsStore();
