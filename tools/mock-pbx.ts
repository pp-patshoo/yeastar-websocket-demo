/**
 * Mock Yeastar PBX: connects to the demo server like a real PBX and streams one
 * 1:1 call (two channels interleaved on one connection) in the Yeastar JSON format.
 *
 *   npm run mock-pbx                         # synthetic "conversation" tones, 20 s
 *   npm run mock-pbx -- --file sample.wav    # mono: caller side; stereo: L = caller, R = callee
 *   npm run mock-pbx -- --secret wrong       # test rejection
 *   npm run mock-pbx -- --pbx hq-1a2b        # act as a specific PBX profile (id or name)
 *   npm run mock-pbx -- --pbx hq-1a2b --no-path   # PBX that drops the URL path
 *
 * Options: --pbx, --no-path, --url, --key, --secret, --rate 8000|16000, --duration <s>,
 *          --file <wav>, --caller 1001, --callee 1002, --callflow <name>
 */
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') ? 'true' : (process.argv[++i] ?? 'true'));
}

// Defaults follow the server's saved settings so it "just works".
interface SavedPbx {
  id?: string;
  name?: string;
  authKey?: string;
  authValue?: string;
  sampleRate?: number;
}
let saved: { pbxList?: SavedPbx[]; pbx?: SavedPbx } = {};
try {
  saved = JSON.parse(fs.readFileSync(path.resolve(process.env.DATA_DIR ?? 'data', 'settings.json'), 'utf8'));
} catch {
  /* no settings yet */
}
const list = saved.pbxList ?? (saved.pbx ? [saved.pbx] : []);
const want = args.get('pbx');
const pbx = want ? list.find((p) => p.id === want || p.name === want) : list[0];
if (want && !pbx) {
  console.error(`[mock-pbx] no PBX "${want}" in settings.json. Known: ${list.map((p) => `${p.id} (${p.name})`).join(', ')}`);
  process.exit(1);
}

const port = process.env.PORT ?? 8080;
// --no-path simulates a PBX that drops the URL path: the server must match by secret.
const url = args.get('url') ?? `ws://localhost:${port}/yeastar${pbx?.id && !args.has('no-path') ? `/${pbx.id}` : ''}`;
const authKey = args.get('key') ?? pbx?.authKey ?? 'auth_key';
const secret = args.get('secret') ?? pbx?.authValue ?? '';
const rate = Number(args.get('rate') ?? pbx?.sampleRate ?? 8000);
const caller = args.get('caller') ?? '1001';
const callee = args.get('callee') ?? '1002';
const callflow = args.get('callflow') ?? '';
const frameMs = rate === 16000 ? 40 : 80;
const samplesPerFrame = (rate * frameMs) / 1000;

function readWav(file: string): Int16Array[] {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let pos = 12;
  let fmt: { channels: number; rate: number; bits: number; format: number } | undefined;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ')
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === 'data') {
      if (!fmt || fmt.bits !== 16 || (fmt.format !== 1 && fmt.format !== 0xfffe)) throw new Error('need 16-bit PCM WAV');
      const n = Math.floor(Math.min(size, buf.length - body) / 2 / fmt.channels);
      const chans = Array.from({ length: Math.min(fmt.channels, 2) }, () => new Int16Array(n));
      for (let i = 0; i < n; i++)
        for (let c = 0; c < chans.length; c++) chans[c][i] = buf.readInt16LE(body + (i * fmt.channels + c) * 2);
      return chans.map((ch) => resample(ch, fmt!.rate, rate));
    }
    pos = body + size + (size % 2);
  }
  throw new Error('no data chunk');
}

function resample(input: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return input;
  const out = new Int16Array(Math.floor((input.length * to) / from));
  for (let i = 0; i < out.length; i++) {
    const x = (i * from) / to;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = Math.round(input[i0] + (input[i1] - input[i0]) * (x - i0));
  }
  return out;
}

/** Two speakers taking turns: syllable-like tone bursts with a little noise. */
function synth(seconds: number): Int16Array[] {
  const n = Math.floor(seconds * rate);
  const a = new Int16Array(n);
  const b = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const turn = Math.floor(t / 2.5) % 2; // switch speaker every 2.5 s
    const syll = Math.max(0, Math.sin(2 * Math.PI * 3.3 * t)) ** 2; // ~3 syllables/s envelope
    const noise = (Math.random() - 0.5) * 300;
    const voiceA = Math.sin(2 * Math.PI * 220 * t) * 0.6 + Math.sin(2 * Math.PI * 440 * t) * 0.3;
    const voiceB = Math.sin(2 * Math.PI * 330 * t) * 0.6 + Math.sin(2 * Math.PI * 495 * t) * 0.3;
    a[i] = Math.round((turn === 0 ? voiceA * syll * 9000 : 0) + noise);
    b[i] = Math.round((turn === 1 ? voiceB * syll * 9000 : 0) + noise);
  }
  return [a, b];
}

const file = args.get('file');
const tracks = file ? readWav(file) : synth(Number(args.get('duration') ?? 20));
if (tracks.length === 1) tracks.push(new Int16Array(tracks[0].length).map(() => Math.round((Math.random() - 0.5) * 200)));
const totalFrames = Math.ceil(tracks[0].length / samplesPerFrame);

const callid = `${(Date.now() / 1000).toFixed(0)}.${Math.floor(Math.random() * 100)}`;
const hex = () => Math.floor(Math.random() * 0xffffff).toString(16).padStart(8, '0');
const parties = [
  { number: caller, channelid: `PJSIP/${caller}-${hex()}` },
  { number: callee, channelid: `PJSIP/${callee}-${hex()}` },
];

console.log(`[mock-pbx] ${url}  header ${secret ? `${authKey}: ••••` : '(none)'}  ${rate} Hz, ${frameMs} ms frames`);
console.log(`[mock-pbx] call ${callid}: ${caller} ↔ ${callee}, ${((totalFrames * frameMs) / 1000).toFixed(1)} s${file ? ` from ${file}` : ' synthetic'}`);

const ws = new WebSocket(url, { headers: secret ? { [authKey]: secret } : {} });
ws.on('unexpected-response', (_req, res) => {
  console.error(`[mock-pbx] rejected by server: HTTP ${res.statusCode}`);
  process.exit(1);
});
ws.on('error', (err) => {
  console.error('[mock-pbx] error:', err.message);
  process.exit(1);
});
ws.on('close', () => {
  console.log('[mock-pbx] closed');
  process.exit(0);
});

ws.on('open', () => {
  console.log('[mock-pbx] connected, streaming…');
  const start = Date.now();
  let frame = 0;
  const tick = () => {
    if (frame >= totalFrames) {
      for (const p of parties) ws.send(JSON.stringify({ callid, callflow, audio: '', number: p.number, status: 'end', channelid: p.channelid }));
      console.log(`[mock-pbx] sent ${frame} frames per channel, ending call`);
      setTimeout(() => ws.close(1000), 200);
      return;
    }
    parties.forEach((p, i) => {
      const slice = tracks[i].subarray(frame * samplesPerFrame, (frame + 1) * samplesPerFrame);
      const pcm = Buffer.alloc(samplesPerFrame * 2);
      for (let s = 0; s < slice.length; s++) pcm.writeInt16LE(slice[s], s * 2);
      ws.send(JSON.stringify({ callid, callflow, audio: pcm.toString('base64'), number: p.number, status: 'process', channelid: p.channelid }));
    });
    frame++;
    // Schedule against the start time so the stream doesn't drift.
    setTimeout(tick, Math.max(0, start + frame * frameMs - Date.now()));
  };
  tick();
});

process.on('SIGINT', () => {
  for (const p of parties) ws.send(JSON.stringify({ callid, callflow, audio: '', number: p.number, status: 'end', channelid: p.channelid }));
  ws.close(1000);
});
