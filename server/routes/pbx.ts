import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ingestUrlFor, lanInterfaces } from '../network.ts';
import { maskSecret, settings, ValidationError, ProfileUpdateSchema } from '../settingsStore.ts';
import { apiRegistry, testApi, YeastarApiError } from '../yeastarApi.ts';
import {
  SUBSCRIBE_TYPES,
  type PbxProfile,
  type PbxProfileView,
  type RemoteApplyRequest,
  type RemoteState,
  type RemoteStreamConfig,
} from '../../shared/protocol.ts';

export function sendError(res: Response, err: unknown) {
  if (err instanceof z.ZodError)
    return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'ข้อมูล'}: ${i.message}`).join('; ') });
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  if (err instanceof YeastarApiError) return res.status(502).json({ error: err.message, errcode: err.errcode });
  console.error(err);
  res.status(500).json({ error: String(err) });
}

export function profileView(p: PbxProfile): PbxProfileView {
  const { api, ...rest } = p;
  return {
    ...rest,
    api: api
      ? {
          baseUrl: api.baseUrl,
          clientId: api.clientId,
          insecureTls: api.insecureTls,
          hasClientSecret: api.clientSecret.length > 0,
          clientSecretMasked: maskSecret(api.clientSecret),
        }
      : null,
    ingestUrl: ingestUrlFor(p),
    hostChoices: lanInterfaces().map((i) => i.address),
  };
}

function getProfile(req: Request): PbxProfile {
  const p = settings.getPbx(String(req.params.id));
  if (!p) throw new ValidationError('ไม่พบ PBX นี้');
  return p;
}

// ---- Yeastar websocketaudiostream <-> app shape ----

function fromYeastar(res: any): { cfg: RemoteStreamConfig; authValue: unknown } {
  const c = res?.config ?? {};
  const types = new Set<string>(SUBSCRIBE_TYPES);
  return {
    cfg: {
      enable: Number(c.enable) === 1,
      websocketUrl: String(c.websocket_url ?? ''),
      authKey: String(c.auth_key ?? ''),
      sampleRate: Number(c.sample_rate) === 1 ? 16000 : 8000,
      enableExt: Number(c.enable_ext) === 1,
      enableTrunk: Number(c.enable_trunk) === 1,
      enableDid: Number(c.enable_did) === 1,
      subscribe: (Array.isArray(res?.subscribe_list) ? res.subscribe_list : [])
        .filter((s: any) => types.has(s.subscribe_type))
        .map((s: any) => ({ type: s.subscribe_type, id: Number(s.subscribe_id) })),
    },
    authValue: c.auth_value,
  };
}

function remoteState(p: PbxProfile, res: any): RemoteState {
  const { cfg, authValue } = fromYeastar(res);
  const value = typeof authValue === 'string' ? authValue : '';
  // If the PBX hides the value (e.g. "******"), we can't tell whether it matches.
  const hidden = typeof authValue !== 'string' || /^\*+$/.test(value);
  return {
    current: cfg,
    currentSecretMasked: hidden ? '(PBX ไม่เปิดเผย)' : maskSecret(value) || '(ว่าง)',
    secretMatches: hidden ? null : value === p.authValue,
    suggested: { websocketUrl: ingestUrlFor(p), authKey: p.authKey, sampleRate: p.sampleRate },
  };
}

const ApplySchema = z.object({
  enable: z.boolean(),
  websocketUrl: z.string().trim().max(255).regex(/^(wss?:\/\/\S+)?$/, 'URL ต้องขึ้นต้นด้วย ws:// หรือ wss://'),
  authKey: z.string().trim().max(63),
  secretMode: z.enum(['app', 'keep']),
  sampleRate: z.union([z.literal(8000), z.literal(16000)]),
  enableExt: z.boolean(),
  enableTrunk: z.boolean(),
  enableDid: z.boolean(),
  subscribe: z.array(z.object({ type: z.enum(SUBSCRIBE_TYPES), id: z.number().int().nonnegative() })).max(2000),
});

function toYeastar(p: PbxProfile, r: RemoteApplyRequest) {
  return {
    enable: r.enable ? 1 : 0,
    websocket_url: r.websocketUrl,
    auth_key: r.authKey,
    ...(r.secretMode === 'app' ? { auth_value: p.authValue } : {}),
    sample_rate: r.sampleRate === 16000 ? 1 : 0,
    enable_ext: r.enableExt ? 1 : 0,
    enable_trunk: r.enableTrunk ? 1 : 0,
    enable_did: r.enableDid ? 1 : 0,
    // Always send the full list: the docs don't say whether update merges or replaces it.
    subscribe_list: r.subscribe.map((s) => ({ subscribe_id: s.id, subscribe_type: s.type })),
  };
}

// ---- routes ----

export const pbxRouter = Router();

const wrap = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err) {
    sendError(res, err);
  }
};

pbxRouter.get('/', wrap(() => settings.pbxList.map(profileView)));

pbxRouter.post(
  '/',
  wrap((req) => profileView(settings.addPbx(typeof req.body?.name === 'string' ? req.body.name : undefined))),
);

pbxRouter.get('/:id', wrap((req) => profileView(getProfile(req))));

pbxRouter.put('/:id', wrap((req) => profileView(settings.updatePbx(getProfile(req).id, ProfileUpdateSchema.parse(req.body)))));

pbxRouter.delete(
  '/:id',
  wrap((req) => {
    settings.deletePbx(getProfile(req).id);
    return { ok: true };
  }),
);

/** Test API credentials from the form (secret falls back to the stored one). */
pbxRouter.post(
  '/:id/api/test',
  wrap(async (req) => {
    const p = getProfile(req);
    const form = ProfileUpdateSchema.shape.api.unwrap().parse(req.body);
    const clientSecret = form.clientSecret || p.api?.clientSecret || '';
    if (!clientSecret) return { ok: false, message: 'กรอก Client Secret' };
    return testApi({ ...form, clientSecret });
  }),
);

pbxRouter.get(
  '/:id/remote',
  wrap(async (req) => {
    const p = getProfile(req);
    return remoteState(p, await apiRegistry.client(p).call('GET', 'websocketaudiostream/get'));
  }),
);

pbxRouter.get(
  '/:id/remote/options',
  wrap(async (req) => apiRegistry.options(getProfile(req), req.query.refresh === '1')),
);

pbxRouter.post(
  '/:id/remote/apply',
  wrap(async (req) => {
    const p = getProfile(req);
    const body = ApplySchema.parse(req.body) as RemoteApplyRequest;
    if (body.secretMode === 'app' && !p.authValue) throw new ValidationError('PBX นี้ยังไม่ได้ตั้ง Secret ในแอป');
    const client = apiRegistry.client(p);
    const payload = toYeastar(p, body);
    console.log(`[yeastar-api] ${p.name}: update websocketaudiostream`, { ...payload, auth_value: payload.auth_value ? '••••' : undefined });
    await client.call('POST', 'websocketaudiostream/update', {}, payload);
    // Read back so the UI shows what the PBX actually stored.
    return remoteState(p, await client.call('GET', 'websocketaudiostream/get'));
  }),
);
