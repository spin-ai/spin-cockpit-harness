/**
 * 生成一段轻量的电子氛围铺底（无版权问题，纯合成）。
 * - 96 BPM，Am7 – Fmaj7 – Cmaj7 – G6
 * - 软 pad + 轻 kick + 八分音符 pluck + 细 hi-hat
 * - 输出 48k 单声道 wav，给 ffmpeg 和配音一起混
 */
const fs = require("node:fs");

const TAU = Math.PI * 2;

function writeWav(file, samples, sampleRate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

function renderMusic(total, out) {
  const sr = 48000;
  const n = Math.ceil(total * sr);
  const data = new Float32Array(n);
  const bpm = 96;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const chords = [
    [220.0, 261.63, 329.63, 392.0], // Am7
    [174.61, 220.0, 261.63, 329.63], // Fmaj7
    [130.81, 164.81, 196.0, 246.94], // Cmaj7
    [196.0, 246.94, 293.66, 329.63], // G6
  ];

  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < n; i += 1) {
    const t = i / sr;
    const barIdx = Math.floor(t / bar);
    const chord = chords[barIdx % chords.length];
    const lb = t - barIdx * bar;
    const env = Math.min(1, lb / 0.35) * Math.min(1, (bar - lb) / 0.5);

    let pad = 0;
    for (const f of chord) {
      pad += Math.sin(TAU * f * t) + 0.45 * Math.sin(TAU * f * 1.006 * t + 0.3);
    }
    pad *= 0.014 * env;

    const beatIdx = Math.floor(t / beat);
    const lbBeat = t - beatIdx * beat;
    const kick = beatIdx % 2 === 0
      ? Math.sin(TAU * (46 + 90 * Math.exp(-lbBeat / 0.035)) * lbBeat) * Math.exp(-lbBeat / 0.15) * 0.18
      : 0;

    const half = beat / 2;
    const hp = t % half;
    const hat = Math.exp(-hp / 0.025) * 0.016 * (rand() * 2 - 1);

    const root = chord[0] / 2;
    const bass = Math.sin(TAU * root * t) * 0.05 * env;

    const pi = Math.floor(t / half) % chord.length;
    const pt = t % half;
    const pluck = Math.sin(TAU * chord[pi] * 2 * t) * Math.min(1, pt / 0.012) * Math.exp(-pt / 0.11) * 0.028;

    const duck = 1 - 0.35 * Math.exp(-lbBeat / 0.12);
    data[i] = (pad + bass + pluck * 0.8) * duck + kick + hat;
  }

  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 0.62 / peak : 1;
  for (let i = 0; i < n; i += 1) data[i] *= gain;

  const fadeIn = Math.min(n, Math.round(2 * sr));
  const fadeOut = Math.min(n, Math.round(3 * sr));
  for (let i = 0; i < fadeIn; i += 1) data[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i += 1) data[n - 1 - i] *= i / fadeOut;

  writeWav(out, data, sr);
  return out;
}

module.exports = { renderMusic };
