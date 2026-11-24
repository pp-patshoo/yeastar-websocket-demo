import type {
  AccessStatus,
  AccessUpdate,
  AiSettingsUpdate,
  AiSettingsView,
  PbxApiConfig,
  PbxProfileUpdate,
  PbxProfileView,
  RemoteApplyRequest,
  RemoteOptions,
  RemoteState,
} from '../../../shared/protocol';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

type ApiForm = Omit<PbxApiConfig, 'clientSecret'> & { clientSecret?: string };
const enc = encodeURIComponent;

export type AccessView = AccessStatus & { viewerViaTunnel: boolean; note?: string };

export const api = {
  getAccess: () => request<AccessView>('GET', '/api/access'),
  saveAccess: (u: AccessUpdate) => request<AccessView>('PUT', '/api/access', u),

  getAi: () => request<AiSettingsView>('GET', '/api/settings/ai'),
  saveAi: (s: AiSettingsUpdate) => request<AiSettingsView>('PUT', '/api/settings/ai', s),
  testAi: (s: Partial<AiSettingsUpdate>) => request<{ ok: boolean; message: string }>('POST', '/api/settings/ai/test', s),

  listPbx: () => request<PbxProfileView[]>('GET', '/api/pbx'),
  createPbx: (name?: string) => request<PbxProfileView>('POST', '/api/pbx', { name }),
  getPbx: (id: string) => request<PbxProfileView>('GET', `/api/pbx/${enc(id)}`),
  savePbx: (id: string, p: PbxProfileUpdate) => request<PbxProfileView>('PUT', `/api/pbx/${enc(id)}`, p),
  deletePbx: (id: string) => request<{ ok: true }>('DELETE', `/api/pbx/${enc(id)}`),
  testPbxApi: (id: string, form: ApiForm) => request<{ ok: boolean; message: string }>('POST', `/api/pbx/${enc(id)}/api/test`, form),
  getRemote: (id: string) => request<RemoteState>('GET', `/api/pbx/${enc(id)}/remote`),
  getRemoteOptions: (id: string, refresh = false) =>
    request<RemoteOptions>('GET', `/api/pbx/${enc(id)}/remote/options${refresh ? '?refresh=1' : ''}`),
  applyRemote: (id: string, body: RemoteApplyRequest) => request<RemoteState>('POST', `/api/pbx/${enc(id)}/remote/apply`, body),
};
