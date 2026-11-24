import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { callStore, type CallState, type ChannelState } from './callStore.ts';
import { settings, type AiSettings } from './settingsStore.ts';
import type { SttGlobalStatus } from '../shared/protocol.ts';

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen';
const KEEPALIVE_MS = 5000;
const MAX_QUEUE_BYTES = 512 * 1024; // audio buffered while the socket is connecting

function deepgramUrl(ai: Pick<AiSettings, 'model' | 'language' | 'interimResults' | 'smartFormat'>, sampleRate: number) {
  const q = new URLSearchParams({
    model: ai.model,
    language: ai.language,
    encoding: 'linear16',
    sample_rate: String(sampleRate),
    channels: '1',
    interim_results: String(ai.interimResults),
    smart_format: String(ai.smartFormat),
    punctuate: 'true',
  });
  return `${DEEPGRAM_URL}?${q}`;
}

/** Read the HTTP status/body when Deepgram refuses the WebSocket upgrade. */
function describeRejection(res: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => {
      let detail = body.trim();
      try {
        const j = JSON.parse(body);
        detail = j.err_msg ?? j.message ?? j.reason ?? detail;
      } catch {
        /* plain text */
      }
      const hint = res.statusCode === 401 ? ' (API key ไม่ถูกต้อง)' : res.statusCode === 402 ? ' (เครดิตหมด)' : '';
      resolve(`HTTP ${res.statusCode}${hint}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    });
    setTimeout(() => resolve(`HTTP ${res.statusCode}`), 3000);
  });
}

/** One Deepgram live stream for one channel of a call. */
class DeepgramStream {
  private ws: WebSocket;
  private queue: Buffer[] = [];
  private queued = 0;
  private keepAlive?: NodeJS.Timeout;
  private finishTimer?: NodeJS.Timeout;
  private interimId?: string;
  closed = false;

  constructor(
    readonly key: string,
    sampleRate: number,
    ai: AiSettings,
    private onClosed: (s: DeepgramStream) => void,
  ) {
    callStore.setSttStatus(key, 'connecting');
    this.ws = new WebSocket(deepgramUrl(ai, sampleRate), { headers: { Authorization: `Token ${ai.apiKey}` } });

    this.ws.on('open', () => {
      callStore.setSttStatus(key, 'open');
      for (const b of this.queue) this.ws.send(b);
      this.queue = [];
      this.queued = 0;
      this.keepAlive = setInterval(() => this.sendJson({ type: 'KeepAlive' }), KEEPALIVE_MS);
    });
    this.ws.on('message', (data) => this.onMessage(data.toString()));
    this.ws.on('unexpected-response', async (_req, res) => {
      const msg = await describeRejection(res);
      console.warn(`[stt] ${key} rejected: ${msg}`);
      this.fail(msg);
    });
    this.ws.on('error', (err) => {
      if (!this.closed) {
        console.warn(`[stt] ${key} error: ${err.message}`);
        this.fail(err.message);
      }
    });
    this.ws.on('close', () => this.cleanup(this.closed ? undefined : 'closed'));
  }

  send(pcm: Buffer) {
    if (this.closed || pcm.length === 0) return;
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(pcm);
    else if (this.ws.readyState === WebSocket.CONNECTING && this.queued < MAX_QUEUE_BYTES) {
      this.queue.push(pcm);
      this.queued += pcm.length;
    }
  }

  /** Channel ended: ask Deepgram to flush final results, then close. */
  finish() {
    if (this.closed) return;
    if (this.ws.readyState !== WebSocket.OPEN) return this.stop();
    callStore.setSttStatus(this.key, 'closing');
    this.sendJson({ type: 'CloseStream' });
    this.finishTimer = setTimeout(() => this.stop(), 5000);
  }

  /** Close immediately (STT switched off). */
  stop() {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.ws.readyState === WebSocket.OPEN) this.sendJson({ type: 'CloseStream' });
      this.ws.close();
    } catch {
      this.ws.terminate();
    }
    this.cleanup();
  }

  private onMessage(text: string) {
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type !== 'Results') return;
    const transcript: string = msg.channel?.alternatives?.[0]?.transcript ?? '';
    const isFinal = !!msg.is_final;
    if (!transcript && !this.interimId) return;
    const entry = callStore.addTranscript(this.key, transcript, isFinal, this.interimId);
    this.interimId = isFinal ? undefined : entry?.id;
  }

  private fail(error: string) {
    this.closed = true;
    callStore.setSttStatus(this.key, 'error', error);
    this.ws.terminate();
    this.cleanup('error');
  }

  private sendJson(obj: object) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private cleanupDone = false;
  private cleanup(finalStatus?: 'closed' | 'error') {
    this.closed = true;
    if (this.cleanupDone) return;
    this.cleanupDone = true;
    clearInterval(this.keepAlive);
    clearTimeout(this.finishTimer);
    if (finalStatus !== 'error') {
      const found = callStore.findChannel(this.key);
      // Keep "off" if the user switched STT off; otherwise mark the stream as finished.
      if (found && found.ch.sttStatus !== 'error') callStore.setSttStatus(this.key, found.call.sttEnabled ? 'closed' : 'off');
    }
    this.onClosed(this);
  }
}

/** Opens/closes Deepgram streams following call lifecycle and settings. Events: status(SttGlobalStatus) */
class SttManager extends EventEmitter {
  private streams = new Map<string, DeepgramStream>();

  constructor() {
    super();
    callStore.on('channelStart', (call: CallState, ch: ChannelState) => this.maybeOpen(call, ch));
    callStore.on('audio', (_call: CallState, ch: ChannelState, pcm: Buffer) => this.streams.get(ch.key)?.send(pcm));
    callStore.on('channelEnd', (_call: CallState, ch: ChannelState) => this.streams.get(ch.key)?.finish());
    callStore.on('sttToggle', (call: CallState) => {
      for (const ch of call.channels.values()) {
        if (ch.endedAt) continue;
        if (call.sttEnabled) this.maybeOpen(call, ch);
        else {
          this.streams.get(ch.key)?.stop();
          callStore.setSttStatus(ch.key, 'off');
        }
      }
    });
    settings.on('change', (what) => {
      if (what !== 'ai') return;
      // Switching the global toggle off stops running streams; other changes apply to new streams.
      if (!settings.ai.enabled || !settings.ai.apiKey) {
        for (const ch of callStore.activeChannels()) callStore.setSttEnabled(ch.callKey, false);
      }
      this.emitStatus();
    });
  }

  status(): SttGlobalStatus {
    return {
      enabled: settings.ai.enabled,
      configured: settings.ai.apiKey.length > 0,
      provider: settings.ai.provider,
      activeStreams: this.streams.size,
    };
  }

  private maybeOpen(call: CallState, ch: ChannelState) {
    if (!call.sttEnabled || this.streams.has(ch.key)) return;
    if (!settings.ai.apiKey) {
      callStore.setSttStatus(ch.key, 'error', 'ยังไม่ได้ตั้งค่า Deepgram API key');
      return;
    }
    const stream = new DeepgramStream(ch.key, call.sampleRate, settings.ai, (s) => {
      if (this.streams.get(s.key) === s) this.streams.delete(s.key);
      this.emitStatus();
    });
    this.streams.set(ch.key, stream);
    this.emitStatus();
  }

  private emitStatus() {
    this.emit('status', this.status());
  }
}

export const sttManager = new SttManager();

/** Settings page "test connection": open a stream, send a little silence, close. */
export function testDeepgram(ai: AiSettings, sampleRate: number): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    if (!ai.apiKey) return resolve({ ok: false, message: 'ยังไม่ได้ใส่ API key' });
    const started = Date.now();
    const ws = new WebSocket(deepgramUrl(ai, sampleRate), { headers: { Authorization: `Token ${ai.apiKey}` } });
    let done = false;
    const finish = (ok: boolean, message: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      resolve({ ok, message });
    };
    const timer = setTimeout(() => finish(false, 'หมดเวลา (10 วินาที) — ตรวจการเชื่อมต่ออินเทอร์เน็ต'), 10000);
    ws.on('open', () => {
      ws.send(Buffer.alloc(sampleRate / 5)); // 100 ms of silence
      ws.send(JSON.stringify({ type: 'CloseStream' }));
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'Metadata' || msg.type === 'Results')
          finish(true, `เชื่อมต่อสำเร็จ (${Date.now() - started} ms) · model ${ai.model} · ภาษา ${ai.language}`);
      } catch {
        /* ignore */
      }
    });
    ws.on('close', () => finish(true, `เชื่อมต่อสำเร็จ (${Date.now() - started} ms)`));
    ws.on('unexpected-response', async (_req, res) => finish(false, await describeRejection(res)));
    ws.on('error', (err) => finish(false, err.message));
  });
}
