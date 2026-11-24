import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { callStore, type CallState, type ChannelState } from './callStore.ts';
import { ingest } from './ingest.ts';
import { encodeAudioFrame } from './pcm.ts';
import { sttManager } from './sttManager.ts';
import type { ClientCommand, ServerEvent } from '../shared/protocol.ts';

const CALLS_THROTTLE_MS = 250;
const LEVELS_INTERVAL_MS = 100;
const MAX_BUFFERED = 1024 * 1024; // drop audio for slow browsers instead of growing memory

interface Client {
  ws: WebSocket;
  listen: Set<string>;
}

/** WebSocket endpoint for the browser dashboard. */
class DashboardHub {
  private wss = new WebSocketServer({ noServer: true });
  private clients = new Set<Client>();
  private callsDirty = false;
  private callsTimer?: NodeJS.Timeout;

  constructor() {
    callStore.on('changed', () => this.scheduleCalls());
    callStore.on('transcript', (entry) => this.broadcast({ type: 'transcript', entry }));
    callStore.on('audio', (call: CallState, ch: ChannelState, pcm: Buffer) => this.forwardAudio(call, ch, pcm));
    ingest.on('status', (pbx) => this.broadcast({ type: 'pbx', pbx }));
    ingest.on('inspector', (message) => this.broadcast({ type: 'inspector', message }));
    sttManager.on('status', (stt) => this.broadcast({ type: 'stt', stt }));
    setInterval(() => this.sendLevels(), LEVELS_INTERVAL_MS).unref();
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
  }

  private onConnection(ws: WebSocket) {
    const client: Client = { ws, listen: new Set() };
    this.clients.add(client);
    this.send(client, {
      type: 'hello',
      calls: callStore.list(),
      transcripts: callStore.allTranscripts(),
      pbx: ingest.status(),
      stt: sttManager.status(),
    });
    ws.on('message', (data) => {
      let cmd: ClientCommand;
      try {
        cmd = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (cmd.type === 'listen' && Array.isArray(cmd.channelKeys)) client.listen = new Set(cmd.channelKeys.map(String));
      else if (cmd.type === 'setCallStt') callStore.setSttEnabled(String(cmd.callKey), !!cmd.enabled);
    });
    ws.on('close', () => this.clients.delete(client));
    ws.on('error', () => this.clients.delete(client));
  }

  private forwardAudio(call: CallState, ch: ChannelState, pcm: Buffer) {
    let frame: Buffer | undefined;
    for (const c of this.clients) {
      if (!c.listen.has(ch.key) || c.ws.readyState !== WebSocket.OPEN || c.ws.bufferedAmount > MAX_BUFFERED) continue;
      frame ??= encodeAudioFrame(ch.key, call.sampleRate, pcm);
      c.ws.send(frame, { binary: true });
    }
  }

  private sendLevels() {
    if (this.clients.size === 0) return;
    const levels: Record<string, number> = {};
    const now = Date.now();
    for (const ch of callStore.activeChannels()) levels[ch.key] = now - ch.lastFrameAt > 500 ? 0 : Math.round(ch.level * 100) / 100;
    if (Object.keys(levels).length > 0) this.broadcast({ type: 'levels', levels });
  }

  private scheduleCalls() {
    this.callsDirty = true;
    if (this.callsTimer) return;
    this.callsTimer = setTimeout(() => {
      this.callsTimer = undefined;
      if (!this.callsDirty) return;
      this.callsDirty = false;
      this.broadcast({ type: 'calls', calls: callStore.list() });
    }, CALLS_THROTTLE_MS);
  }

  private broadcast(ev: ServerEvent) {
    const text = JSON.stringify(ev);
    for (const c of this.clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(text);
  }

  private send(c: Client, ev: ServerEvent) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(ev));
  }
}

export const dashboardHub = new DashboardHub();
