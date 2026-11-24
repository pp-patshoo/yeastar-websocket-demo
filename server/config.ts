import 'dotenv/config';
import path from 'node:path';

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

export const config = {
  port: Number(process.env.PORT ?? 8080),
  dataDir: path.resolve(process.env.DATA_DIR ?? 'data'),
  webDist: path.resolve('web/dist'),
  ingestPath: '/yeastar',
  dashboardPath: '/ui',
  /** How many ended calls to keep in memory. */
  keepEndedCalls: 20,
  /** Defaults used only when data/settings.json does not exist yet. */
  defaults: {
    pbx: {
      authKey: process.env.YEASTAR_AUTH_KEY ?? 'auth_key',
      authValue: process.env.YEASTAR_AUTH_VALUE ?? '',
      sampleRate: process.env.SAMPLE_RATE === '16000' ? (16000 as const) : (8000 as const),
      allowedIps: [] as string[],
    },
    ai: {
      enabled: bool(process.env.STT_ENABLED, false),
      provider: 'deepgram' as const,
      apiKey: process.env.DEEPGRAM_API_KEY ?? '',
      model: process.env.STT_MODEL ?? 'nova-3',
      language: process.env.STT_LANGUAGE ?? 'th',
      interimResults: true,
      smartFormat: true,
    },
  },
};
