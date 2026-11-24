// Types shared between the Node server and the React dashboard.

/** One message as sent by the Yeastar PBX (all values are strings). */
export interface YeastarAudioMessage {
  callid: string;
  channelid: string;
  number?: string;
  callflow?: string;
  status: 'process' | 'end' | string;
  audio?: string;
}

export type SttStatus = 'off' | 'connecting' | 'open' | 'closing' | 'closed' | 'error';

export interface ChannelSummary {
  /** Unique key: callKey + '::' + channelId (channel ids may repeat across calls). */
  key: string;
  channelId: string;
  callKey: string;
  number: string;
  /** 0-based order in which this channel appeared in the call (0 = left, 1 = right). */
  index: number;
  startedAt: number;
  lastFrameAt: number;
  endedAt?: number;
  frames: number;
  bytes: number;
  /** Frames that arrived noticeably later than the expected frame interval. */
  lateFrames: number;
  sttStatus: SttStatus;
  sttError?: string;
}

export interface CallSummary {
  /** Unique key inside the app: pbxId + '/' + callid (call ids of different PBXs may collide). */
  key: string;
  /** The `callid` as sent by the PBX. */
  callId: string;
  pbxId: string;
  pbxName: string;
  callflow: string;
  startedAt: number;
  endedAt?: number;
  sampleRate: number;
  sttEnabled: boolean;
  channels: ChannelSummary[];
}

export interface TranscriptEntry {
  id: string;
  callKey: string;
  channelKey: string;
  text: string;
  isFinal: boolean;
  /** Server time when this result was received. */
  at: number;
}

export interface PbxConnectionInfo {
  id: string;
  pbxId: string;
  remoteAddress: string;
  path: string;
  connectedAt: number;
  messages: number;
  callIds: string[];
}

export interface PbxAttemptInfo {
  at: number;
  remoteAddress: string;
  path: string;
  accepted: boolean;
  reason: string;
  /** Upgrade request headers, with secret values masked. */
  headers: Record<string, string>;
}

export type ApiState = 'none' | 'unknown' | 'ok' | 'error' | 'auth_failed';

export interface PbxProfileStatus {
  id: string;
  name: string;
  enabled: boolean;
  connections: PbxConnectionInfo[];
  lastAttempt?: PbxAttemptInfo;
  api: { state: ApiState; message?: string };
}

export interface PbxStatus {
  profiles: PbxProfileStatus[];
  /** Connection attempts that matched no PBX profile (newest first). */
  unknownAttempts: PbxAttemptInfo[];
}

export interface InspectorMessage {
  at: number;
  connId: string;
  pbxName: string;
  /** Raw message with the audio field shortened. */
  raw: string;
}

export type TunnelState = 'unavailable' | 'stopped' | 'starting' | 'online' | 'error';

export interface AccessStatus {
  tunnel: {
    /** false when not running behind our proxy (no TUNNEL_TARGET), e.g. `npm run dev`. */
    available: boolean;
    enabled: boolean;
    state: TunnelState;
    url?: string;
    error?: string;
    since?: number;
    log: string[];
  };
  /** Setting: allow the dashboard from the LAN. */
  lanDashboard: boolean;
  /** What actually applies (setting, unless the tunnel is down or FORCE_LAN_DASHBOARD is set). */
  lanEffective: boolean;
  forceLan: boolean;
}

export interface AccessUpdate {
  tunnelEnabled: boolean;
  lanDashboard: boolean;
}

/** Server → browser (JSON text frames). Audio goes as binary frames, see encodeAudioFrame. */
export type ServerEvent =
  | { type: 'hello'; calls: CallSummary[]; transcripts: TranscriptEntry[]; pbx: PbxStatus; stt: SttGlobalStatus; access: AccessStatus }
  | { type: 'access'; access: AccessStatus }
  | { type: 'calls'; calls: CallSummary[] }
  | { type: 'levels'; levels: Record<string, number> }
  | { type: 'transcript'; entry: TranscriptEntry }
  | { type: 'pbx'; pbx: PbxStatus }
  | { type: 'stt'; stt: SttGlobalStatus }
  | { type: 'inspector'; message: InspectorMessage };

/** Browser → server. */
export type ClientCommand =
  | { type: 'listen'; channelKeys: string[] }
  | { type: 'setCallStt'; callKey: string; enabled: boolean };

export interface SttGlobalStatus {
  enabled: boolean;
  configured: boolean;
  provider: string;
  activeStreams: number;
}

// ---- AI settings (REST) ----

export interface AiSettingsView {
  enabled: boolean;
  provider: 'deepgram';
  model: string;
  language: string;
  interimResults: boolean;
  smartFormat: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string;
}

export interface AiSettingsUpdate {
  enabled: boolean;
  provider: 'deepgram';
  model: string;
  language: string;
  interimResults: boolean;
  smartFormat: boolean;
  /** Omit or leave empty to keep the stored key. */
  apiKey?: string;
  clearApiKey?: boolean;
}

// ---- PBX profiles (REST) ----

export interface PbxApiConfig {
  /** e.g. https://192.168.1.10:8088 */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Accept self-signed HTTPS certificates. */
  insecureTls: boolean;
}

export interface PbxProfile {
  id: string;
  name: string;
  enabled: boolean;
  authKey: string;
  authValue: string;
  sampleRate: 8000 | 16000;
  allowedIps: string[];
  /** Address of this app as seen by the PBX; empty = pick automatically. */
  appHost: string;
  api: PbxApiConfig | null;
}

export interface PbxApiView {
  baseUrl: string;
  clientId: string;
  insecureTls: boolean;
  hasClientSecret: boolean;
  clientSecretMasked: string;
}

export interface PbxProfileView extends Omit<PbxProfile, 'api'> {
  api: PbxApiView | null;
  /** The URL to configure on this PBX. */
  ingestUrl: string;
  /** Addresses of this machine to choose appHost from. */
  hostChoices: string[];
}

export interface PbxProfileUpdate extends Omit<PbxProfile, 'id' | 'api'> {
  /** clientSecret empty/omitted = keep the stored one. */
  api: (Omit<PbxApiConfig, 'clientSecret'> & { clientSecret?: string }) | null;
}

// ---- Remote WebSocket Audio Streaming config (via Yeastar API) ----

export const SUBSCRIBE_TYPES = ['extension', 'ext_group', 'organization', 'trunk', 'did'] as const;
export type SubscribeType = (typeof SUBSCRIBE_TYPES)[number];

export interface SubscribeItem {
  type: SubscribeType;
  id: number;
}

export interface RemoteStreamConfig {
  enable: boolean;
  websocketUrl: string;
  authKey: string;
  sampleRate: 8000 | 16000;
  enableExt: boolean;
  enableTrunk: boolean;
  enableDid: boolean;
  subscribe: SubscribeItem[];
}

export interface RemoteState {
  current: RemoteStreamConfig;
  /** auth_value on the PBX as returned (masked). */
  currentSecretMasked: string;
  /** true/false = PBX secret equals/differs from the app's; null = PBX hides it, can't tell. */
  secretMatches: boolean | null;
  /** Values the PBX should have so its audio reaches this profile. */
  suggested: { websocketUrl: string; authKey: string; sampleRate: 8000 | 16000 };
}

export interface RemoteApplyRequest extends RemoteStreamConfig {
  /** 'app' = send this profile's secret; 'keep' = leave auth_value on the PBX unchanged. */
  secretMode: 'app' | 'keep';
}

export interface RemoteOption {
  id: number;
  text: string;
}

export interface RemoteOptions {
  options: Record<SubscribeType, RemoteOption[]>;
  errors: Partial<Record<SubscribeType, string>>;
}

/**
 * Binary audio frame to the browser:
 * [1 byte key length][channel key utf8][2 bytes sampleRate/100 big-endian][PCM16LE samples]
 */
export function decodeAudioFrame(buf: ArrayBuffer): { channelKey: string; sampleRate: number; pcm: Int16Array } {
  const view = new DataView(buf);
  const idLen = view.getUint8(0);
  const channelKey = new TextDecoder().decode(new Uint8Array(buf, 1, idLen));
  const sampleRate = view.getUint16(1 + idLen) * 100;
  const offset = 3 + idLen;
  const byteLen = buf.byteLength - offset;
  // Copy so the Int16Array is 2-byte aligned regardless of the id length.
  const pcm = new Int16Array(buf.slice(offset, offset + byteLen - (byteLen % 2)));
  return { channelKey, sampleRate, pcm };
}
