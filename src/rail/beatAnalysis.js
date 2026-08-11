// ---------------------------------------------------------------------------
// Offline beat analysis for the music-driven Rail.
// ---------------------------------------------------------------------------
// Decodes an audio File with the Web Audio API and returns a list of beat
// timestamps (seconds) plus a status type per beat, so the Rail can spawn orbs
// that ARRIVE on the beat (we know the times in advance, place each orb at the
// rail-progress the player will occupy at that moment).
//
// Detection is a pragmatic energy-onset picker (Patin-style local-average
// threshold) on a downmixed mono signal, with a crude bass/treble split so orb
// TYPE tracks the music (bass hits vs bright hits). It is intentionally simple —
// good enough to feel musical for a prototype, not a production beat tracker.
// ---------------------------------------------------------------------------

const BLOCK = 1024; // samples per analysis frame (~23ms @ 44.1k)
const MIN_SPACING = 0.14; // seconds between accepted beats (density cap)
const THRESHOLD_C = 1.35; // energy must exceed C * local average to be a beat

/**
 * @param {File} file
 * @returns {Promise<{ctx:AudioContext, buffer:AudioBuffer, duration:number, beats:Array}>}
 */
export async function analyzeTrack(file) {
  const arrayBuf = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  // decodeAudioData handles mp3 / wav / ogg / m4a (whatever the browser supports).
  const buffer = await ctx.decodeAudioData(arrayBuf);
  const beats = detectBeats(buffer);
  return { ctx, buffer, duration: buffer.duration, beats };
}

function detectBeats(buffer) {
  const sr = buffer.sampleRate;
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const nBlocks = Math.floor(ch0.length / BLOCK);
  const blockDur = BLOCK / sr;

  const energy = new Float32Array(nBlocks);
  const lowEnergy = new Float32Array(nBlocks);
  const highEnergy = new Float32Array(nBlocks);

  // One-pole low-pass to separate bass (~<150Hz) from the rest.
  const a = 0.02;
  let lp = 0;
  for (let b = 0; b < nBlocks; b++) {
    const start = b * BLOCK;
    let e = 0;
    let le = 0;
    let he = 0;
    for (let i = 0; i < BLOCK; i++) {
      const idx = start + i;
      const s = ch1 ? (ch0[idx] + ch1[idx]) * 0.5 : ch0[idx];
      lp += a * (s - lp);
      const high = s - lp;
      e += s * s;
      le += lp * lp;
      he += high * high;
    }
    energy[b] = e;
    lowEnergy[b] = le;
    highEnergy[b] = he;
  }

  // Peak-pick against a ~1s trailing average.
  const history = Math.max(4, Math.round(sr / BLOCK));
  const raw = [];
  let lastTime = -1;
  for (let b = 1; b < nBlocks; b++) {
    const from = Math.max(0, b - history);
    let sum = 0;
    for (let j = from; j < b; j++) sum += energy[j];
    const avg = b > from ? sum / (b - from) : energy[b];
    const time = b * blockDur;
    if (energy[b] > THRESHOLD_C * avg && time - lastTime > MIN_SPACING) {
      const ratio = highEnergy[b] / (lowEnergy[b] + 1e-9); // brightness
      const strength = energy[b] / (avg + 1e-9);
      raw.push({ time, ratio, strength });
      lastTime = time;
    }
  }

  // Fallback: if detection found almost nothing (quiet/odd file), lay down a
  // steady grid so the rail is still playable.
  if (raw.length < 8) {
    raw.length = 0;
    for (let t = 0.5; t < buffer.duration - 0.2; t += 0.5) {
      raw.push({ time: t, ratio: 1, strength: 1.5 });
    }
  }

  // Assign status type by brightness terciles so every track gets a mix:
  // bass-heavy -> Anxiety, mid -> Calm, bright -> Focus.
  const ratios = raw.map((r) => r.ratio).sort((x, y) => x - y);
  const q = (p) => ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * p))] ?? 1;
  const lo = q(0.4);
  const hi = q(0.8);

  return raw.map((r, i) => {
    let statusId = 'calm';
    if (r.ratio <= lo) statusId = 'anxiety';
    else if (r.ratio >= hi) statusId = 'focus';
    return {
      time: r.time,
      statusId,
      theta: (i * 2.3999632) % (Math.PI * 2), // golden-angle spread around the rail
      size: r.strength > 2.2 ? 1.5 : 1,
    };
  });
}
