/** Decode the Base64 `audio` field into PCM16LE bytes (even length). */
export function decodeAudio(b64: string | undefined): Buffer {
  if (!b64) return Buffer.alloc(0);
  const buf = Buffer.from(b64, 'base64');
  return buf.length % 2 === 0 ? buf : buf.subarray(0, buf.length - 1);
}

/** RMS level of PCM16LE audio, scaled to 0..1 (roughly perceptual). */
export function rmsLevel(pcm: Buffer): number {
  const n = pcm.length >> 1;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = pcm.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  const rms = Math.sqrt(sum / n);
  // Map -60 dBFS..0 dBFS to 0..1.
  const db = 20 * Math.log10(rms || 1e-9);
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

/** Binary frame for the browser, see decodeAudioFrame in shared/protocol.ts. */
export function encodeAudioFrame(channelId: string, sampleRate: number, pcm: Buffer): Buffer {
  const id = Buffer.from(channelId, 'utf8').subarray(0, 255);
  const header = Buffer.alloc(3 + id.length);
  header.writeUInt8(id.length, 0);
  id.copy(header, 1);
  header.writeUInt16BE(Math.round(sampleRate / 100), 1 + id.length);
  return Buffer.concat([header, pcm]);
}
