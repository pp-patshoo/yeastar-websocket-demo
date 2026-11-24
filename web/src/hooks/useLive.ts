import { useSyncExternalStore } from 'react';
import { LivePlayer } from '../audio/player';
import {
  decodeAudioFrame,
  type CallSummary,
  type ClientCommand,
  type InspectorMessage,
  type PbxStatus,
  type ServerEvent,
  type SttGlobalStatus,
  type TranscriptEntry,
} from '../../../shared/protocol';

const HISTORY_POINTS = 80; // level history per channel (~8 s at 10 Hz)
const MAX_INSPECTOR = 60;

export interface LiveState {
  connected: boolean;
  calls: CallSummary[];
  transcripts: Record<string, TranscriptEntry[]>; // by call key
  levels: Record<string, number>;
  levelHistory: Record<string, number[]>;
  pbx: PbxStatus;
  stt: SttGlobalStatus;
  inspector: InspectorMessage[];
  listening: string[];
}

const initial: LiveState = {
  connected: false,
  calls: [],
  transcripts: {},
  levels: {},
  levelHistory: {},
  pbx: { profiles: [], unknownAttempts: [] },
  stt: { enabled: false, configured: false, provider: 'deepgram', activeStreams: 0 },
  inspector: [],
  listening: [],
};

/** Single WebSocket to the server shared by every page, with auto-reconnect. */
class LiveStore {
  state: LiveState = initial;
  readonly player = new LivePlayer();
  private ws?: WebSocket;
  private listeners = new Set<() => void>();
  private retry = 0;

  constructor() {
    this.connect();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ui`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.set({ connected: true });
      if (this.state.listening.length) this.send({ type: 'listen', channelKeys: this.state.listening });
    };
    ws.onclose = () => {
      this.set({ connected: false });
      setTimeout(() => this.connect(), Math.min(5000, 500 * 2 ** this.retry++));
    };
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) return this.onAudio(ev.data);
      this.onEvent(JSON.parse(ev.data) as ServerEvent);
    };
  }

  private send(cmd: ClientCommand) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(cmd));
  }

  private onEvent(ev: ServerEvent) {
    switch (ev.type) {
      case 'hello': {
        const transcripts: Record<string, TranscriptEntry[]> = {};
        for (const t of ev.transcripts) (transcripts[t.callKey] ??= []).push(t);
        return this.set({ calls: ev.calls, transcripts, pbx: ev.pbx, stt: ev.stt });
      }
      case 'calls': {
        // Stop listening to channels that ended or were dropped.
        const live = new Set(ev.calls.flatMap((c) => c.channels.filter((ch) => !ch.endedAt).map((ch) => ch.key)));
        const listening = this.state.listening.filter((k) => live.has(k));
        if (listening.length !== this.state.listening.length) this.setListening(listening);
        const known = new Set(ev.calls.map((c) => c.key));
        const transcripts = Object.fromEntries(Object.entries(this.state.transcripts).filter(([id]) => known.has(id)));
        return this.set({ calls: ev.calls, transcripts });
      }
      case 'levels': {
        const levelHistory = { ...this.state.levelHistory };
        for (const [k, v] of Object.entries(ev.levels)) {
          const h = (levelHistory[k] ?? []).concat(v);
          levelHistory[k] = h.length > HISTORY_POINTS ? h.slice(-HISTORY_POINTS) : h;
        }
        return this.set({ levels: ev.levels, levelHistory });
      }
      case 'transcript': {
        const list = [...(this.state.transcripts[ev.entry.callKey] ?? [])];
        const i = list.findIndex((t) => t.id === ev.entry.id);
        if (i >= 0) list[i] = ev.entry;
        else list.push(ev.entry);
        return this.set({ transcripts: { ...this.state.transcripts, [ev.entry.callKey]: list } });
      }
      case 'pbx':
        return this.set({ pbx: ev.pbx });
      case 'stt':
        return this.set({ stt: ev.stt });
      case 'inspector':
        return this.set({ inspector: [ev.message, ...this.state.inspector].slice(0, MAX_INSPECTOR) });
    }
  }

  private onAudio(buf: ArrayBuffer) {
    const { channelKey, sampleRate, pcm } = decodeAudioFrame(buf);
    if (!this.state.listening.includes(channelKey)) return;
    let pan = 0;
    if (this.state.listening.length > 1) {
      const ch = this.state.calls.flatMap((c) => c.channels).find((c) => c.key === channelKey);
      pan = ch?.index === 0 ? -0.8 : ch?.index === 1 ? 0.8 : 0;
    }
    this.player.play(channelKey, sampleRate, pcm, pan);
  }

  setListening(keys: string[]) {
    for (const k of this.state.listening) if (!keys.includes(k)) this.player.stop(k);
    this.set({ listening: keys });
    this.send({ type: 'listen', channelKeys: keys });
  }

  async toggleListen(keys: string[]) {
    await this.player.resume();
    const all = keys.every((k) => this.state.listening.includes(k));
    this.setListening(
      all ? this.state.listening.filter((k) => !keys.includes(k)) : [...new Set([...this.state.listening, ...keys])],
    );
  }

  setCallStt(callKey: string, enabled: boolean) {
    this.send({ type: 'setCallStt', callKey, enabled });
  }
}

export const live = new LiveStore();

export function useLive(): LiveState {
  return useSyncExternalStore(live.subscribe, live.getSnapshot);
}
