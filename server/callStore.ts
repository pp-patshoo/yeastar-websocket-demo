import { EventEmitter } from 'node:events';
import { config } from './config.ts';
import { rmsLevel } from './pcm.ts';
import { settings } from './settingsStore.ts';
import type { CallSummary, ChannelSummary, SttStatus, TranscriptEntry } from '../shared/protocol.ts';

export interface ChannelState extends ChannelSummary {
  connId: string;
  level: number;
}

export interface CallState {
  /** pbxId + '/' + callid */
  key: string;
  callId: string;
  pbxId: string;
  callflow: string;
  startedAt: number;
  endedAt?: number;
  sampleRate: number;
  sttEnabled: boolean;
  channels: Map<string, ChannelState>;
  transcripts: TranscriptEntry[];
}

export const callKeyOf = (pbxId: string, callId: string) => `${pbxId}/${callId}`;
export const channelKeyOf = (callKey: string, channelId: string) => `${callKey}::${channelId}`;

/**
 * In-memory state of calls and channels.
 * Events: channelStart(call, ch) · audio(call, ch, pcm) · channelEnd(call, ch) · callEnd(call)
 *         transcript(entry) · changed()
 */
class CallStore extends EventEmitter {
  private calls = new Map<string, CallState>();
  /** Order of ended calls, oldest first, for trimming. */
  private ended: string[] = [];
  private transcriptSeq = 0;

  list(): CallSummary[] {
    return [...this.calls.values()]
      .sort((a, b) => Number(!!a.endedAt) - Number(!!b.endedAt) || b.startedAt - a.startedAt)
      .map(toSummary);
  }

  get(callKey: string) {
    return this.calls.get(callKey);
  }

  findChannel(key: string): { call: CallState; ch: ChannelState } | undefined {
    const call = this.calls.get(key.split('::')[0]);
    const ch = call?.channels.get(key);
    return call && ch ? { call, ch } : undefined;
  }

  activeChannels(): ChannelState[] {
    const out: ChannelState[] = [];
    for (const call of this.calls.values()) for (const ch of call.channels.values()) if (!ch.endedAt) out.push(ch);
    return out;
  }

  allTranscripts(): TranscriptEntry[] {
    return [...this.calls.values()].flatMap((c) => c.transcripts);
  }

  /** Handle one `process` frame from the PBX. */
  frame(opts: {
    connId: string;
    pbxId: string;
    callId: string;
    channelId: string;
    number: string;
    callflow: string;
    pcm: Buffer;
    sampleRate: number;
    sttDefault: boolean;
  }) {
    const now = Date.now();
    const callKey = callKeyOf(opts.pbxId, opts.callId);
    let call = this.calls.get(callKey);
    if (!call || call.endedAt) {
      if (call?.endedAt) this.forget(call.key); // same callid re-used: start fresh
      call = {
        key: callKey,
        callId: opts.callId,
        pbxId: opts.pbxId,
        callflow: opts.callflow,
        startedAt: now,
        sampleRate: opts.sampleRate,
        sttEnabled: opts.sttDefault,
        channels: new Map(),
        transcripts: [],
      };
      this.calls.set(call.key, call);
    }
    if (opts.callflow && !call.callflow) call.callflow = opts.callflow;

    const key = channelKeyOf(callKey, opts.channelId);
    let ch = call.channels.get(key);
    let isNew = false;
    if (!ch) {
      isNew = true;
      ch = {
        key,
        channelId: opts.channelId,
        callKey,
        number: opts.number,
        index: call.channels.size,
        startedAt: now,
        lastFrameAt: now,
        frames: 0,
        bytes: 0,
        lateFrames: 0,
        sttStatus: 'off',
        connId: opts.connId,
        level: 0,
      };
      call.channels.set(key, ch);
    } else {
      // A frame normally covers bytes/2/rate seconds; flag gaps well beyond that.
      const frameMs = (opts.pcm.length / 2 / call.sampleRate) * 1000 || 80;
      if (now - ch.lastFrameAt > frameMs * 2.5) ch.lateFrames++;
      ch.connId = opts.connId;
      if (opts.number && !ch.number) ch.number = opts.number;
    }
    ch.frames++;
    ch.bytes += opts.pcm.length;
    ch.lastFrameAt = now;
    ch.level = rmsLevel(opts.pcm);

    if (isNew) {
      this.emit('channelStart', call, ch);
      this.emit('changed');
    }
    this.emit('audio', call, ch, opts.pcm);
  }

  /** Handle an `end` message for one channel. */
  endChannel(pbxId: string, callId: string, channelId: string) {
    const callKey = callKeyOf(pbxId, callId);
    const call = this.calls.get(callKey);
    const ch = call?.channels.get(channelKeyOf(callKey, channelId));
    if (call && ch) this.closeChannel(call, ch);
  }

  /** PBX connection closed: end every channel that was streaming on it. */
  connectionClosed(connId: string) {
    for (const call of this.calls.values())
      for (const ch of call.channels.values()) if (ch.connId === connId && !ch.endedAt) this.closeChannel(call, ch);
  }

  setSttEnabled(callKey: string, enabled: boolean) {
    const call = this.calls.get(callKey);
    if (!call || call.endedAt) return;
    call.sttEnabled = enabled;
    this.emit('sttToggle', call);
    this.emit('changed');
  }

  setSttStatus(key: string, status: SttStatus, error?: string) {
    const found = this.findChannel(key);
    if (!found) return;
    found.ch.sttStatus = status;
    found.ch.sttError = error;
    this.emit('changed');
  }

  /** Add or replace (interim → final) a transcript line. */
  addTranscript(key: string, text: string, isFinal: boolean, replaceId?: string): TranscriptEntry | undefined {
    const found = this.findChannel(key);
    if (!found) return;
    const { call } = found;
    const entry: TranscriptEntry = {
      id: replaceId ?? `t${++this.transcriptSeq}`,
      callKey: call.key,
      channelKey: key,
      text,
      isFinal,
      at: Date.now(),
    };
    const i = replaceId ? call.transcripts.findIndex((t) => t.id === replaceId) : -1;
    if (i >= 0) {
      entry.at = call.transcripts[i].at;
      call.transcripts[i] = entry;
    } else call.transcripts.push(entry);
    this.emit('transcript', entry);
    return entry;
  }

  private closeChannel(call: CallState, ch: ChannelState) {
    if (ch.endedAt) return;
    ch.endedAt = Date.now();
    ch.level = 0;
    this.emit('channelEnd', call, ch);
    if ([...call.channels.values()].every((c) => c.endedAt)) {
      call.endedAt = Date.now();
      this.ended.push(call.key);
      this.emit('callEnd', call);
      while (this.ended.length > config.keepEndedCalls) this.forget(this.ended[0]);
    }
    this.emit('changed');
  }

  private forget(callKey: string) {
    this.calls.delete(callKey);
    this.ended = this.ended.filter((k) => k !== callKey);
  }
}

function toSummary(call: CallState): CallSummary {
  return {
    key: call.key,
    callId: call.callId,
    pbxId: call.pbxId,
    pbxName: settings.pbxName(call.pbxId),
    callflow: call.callflow,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    sampleRate: call.sampleRate,
    sttEnabled: call.sttEnabled,
    channels: [...call.channels.values()].map(({ connId: _c, level: _l, ...rest }) => rest),
  };
}

export const callStore = new CallStore();
