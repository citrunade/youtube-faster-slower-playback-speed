// Audio graph shared by the page engine (content.js) and the test page:
// input -> Signalsmith Stretch (pitch) -> low shelf (bass) -> dry + reverb + drum tail
// -> safety limiter -> output.
import SignalsmithStretch from './lib/SignalsmithStretch.mjs';

// Load the worklet from the bundled file instead of a blob: URL (MV3 CSP forbids blob scripts).
SignalsmithStretch.moduleUrl = new URL('./lib/SignalsmithStretch.mjs', import.meta.url).href;

export const semitonesFor = (speed) => -12 * Math.log2(speed);
// Total shift. Tape mode: none, pitch follows speed like a record. Otherwise undo the speed's
// pitch change, then add the user's own shift.
export const shiftFor = (s) => (s.tape ? 0 : semitonesFor(s.speed) + (Number(s.pitch) || 0));

function makeImpulse(ctx, seconds = 2.4, decay = 3.2) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const pre = Math.floor(rate * 0.012);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

// Drum tail: noise fading over ~0.7 s (no early gap, so it sounds like the hit itself lasting).
function makeTailImpulse(ctx, seconds = 0.7) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3) * TAIL_LEVEL;
  }
  return buf;
}
const TAIL_LEVEL = 0.04;

// Two ways to change speed at the original pitch:
// - music: the page plays sped up the plain way (pitch rises, nothing chopped) and the pitch
//   shifter brings the pitch back down. Smoothest for songs; ~0.12 s of delay.
// - voice: the page uses Chrome's own pitch-keeping speed change, which is built for speech
//   (clearest for talking, can sound choppy on music). The pitch shifter is skipped unless the
//   user shifts the pitch, so there is almost no delay.
export const usesNativeSpeed = (s) => s.profile === 'voice' && !s.tape;

export async function buildChain(ctx, input, settings) {
  const stretch = await SignalsmithStretch(ctx, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  input.connect(stretch);
  // Level meters for diagnostics (input before, output after pitch correction).
  const meterIn = ctx.createAnalyser(), meterOut = ctx.createAnalyser();
  meterIn.fftSize = meterOut.fftSize = 2048;
  input.connect(meterIn);
  stretch.connect(meterOut);
  const level = (an) => {
    const b = new Float32Array(an.fftSize); an.getFloatTimeDomainData(b);
    let s = 0; for (const v of b) s += v * v;
    const rms = Math.sqrt(s / b.length);
    return rms > 0 ? Math.round(20 * Math.log10(rms)) : -999;
  };
  let applied = null;

  const bass = ctx.createBiquadFilter();
  bass.type = 'lowshelf';
  bass.frequency.value = 120;
  // Either through the pitch shifter or straight past it (voice mode, no pitch shift).
  const viaStretch = ctx.createGain(), direct = ctx.createGain();
  stretch.connect(viaStretch).connect(bass);
  input.connect(direct).connect(bass);

  // Everything meets here, then a limiter so stacked effects can't clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.003; limiter.release.value = 0.15;
  // Master switch: silenced the moment the video is paused, so the ~0.15 s of sound still in
  // the pipeline doesn't keep playing after the click.
  const master = ctx.createGain();
  limiter.connect(master).connect(ctx.destination);

  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const verb = ctx.createConvolver();
  verb.buffer = makeImpulse(ctx);
  bass.connect(dry).connect(limiter);
  verb.connect(wet).connect(limiter); // fed from bass only while reverb is up (see link)

  // Drum tail: drum ranges only (snare body ~220 Hz, crack/hats above 5 kHz, kick below 120 Hz).
  // The worklet passes only the hit fronts; a short decaying tail is added to each of them.
  await ctx.audioWorklet.addModule(new URL('./drum-tail-worklet.js', import.meta.url).href);
  const tail = new AudioWorkletNode(ctx, 'drum-tail', { outputChannelCount: [2] });
  const drumIn = ctx.createGain();
  const kick = ctx.createBiquadFilter(); kick.type = 'lowpass'; kick.frequency.value = 120;
  const body = ctx.createBiquadFilter(); body.type = 'bandpass'; body.frequency.value = 220; body.Q.value = 0.8;
  const crack = ctx.createBiquadFilter(); crack.type = 'highpass'; crack.frequency.value = 5000;
  const drumBands = [kick, body, crack];
  for (const f of drumBands) f.connect(drumIn); // fed from bass only while drum tail is up
  const tailVerb = ctx.createConvolver();
  tailVerb.normalize = false;
  tailVerb.buffer = makeTailImpulse(ctx);
  drumIn.connect(tail).connect(tailVerb).connect(limiter);

  stretch.start();
  const stretchLatency = await stretch.latency();
  let useStretch = true;

  // Applies settings; returns the delay the sound now has (the picture delay must match it).
  // Effects at 0 are taken out of the sound path, so they cost nothing (less work for the
  // audio thread = fewer dropouts on a busy computer). Taken out only after they faded.
  const linked = {}, unlinkTimers = {};
  const link = (name, on, connect, disconnect) => {
    clearTimeout(unlinkTimers[name]);
    if (on && !linked[name]) { connect(); linked[name] = true; }
    else if (!on && linked[name]) unlinkTimers[name] = setTimeout(() => { try { disconnect(); } catch {} linked[name] = false; }, 400);
  };

  const apply = (s, smooth = true) => {
    const t = ctx.currentTime;
    const set = (p, v) => (smooth ? p.setTargetAtTime(v, t, 0.05) : (p.value = v));
    const native = usesNativeSpeed(s);
    const pitch = Number(s.pitch) || 0;
    const semitones = native ? pitch : shiftFor(s);
    useStretch = !native || pitch !== 0;
    applied = { semitones: Math.round(semitones * 100) / 100, speed: s.speed, pitch: s.pitch, tape: !!s.tape, engine: native ? 'voice' : 'music', shifter: useStretch };
    stretch.schedule({ semitones });
    set(viaStretch.gain, useStretch ? 1 : 0);
    set(direct.gain, useStretch ? 0 : 1);
    set(bass.gain, s.bass);
    const r = Math.max(0, Math.min(1, s.reverb));
    set(wet.gain, r * 0.5);
    set(dry.gain, 1 - r * 0.25);
    const tailAmt = Math.max(0, Math.min(1, Number(s.tail) || 0));
    set(tail.parameters.get('amount'), tailAmt);
    link('verb', r > 0, () => bass.connect(verb), () => bass.disconnect(verb));
    link('drum', tailAmt > 0, () => drumBands.forEach((f) => bass.connect(f)), () => drumBands.forEach((f) => bass.disconnect(f)));
    return useStretch ? stretchLatency : 0;
  };
  const latency = apply(settings, false);

  return {
    stretch,
    output: limiter,
    latency,
    apply,
    diag: () => ({ ctx: ctx.state, inDb: level(meterIn), outDb: level(meterOut), applied }),
    mute(on) {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(on ? 0 : 1, t, 0.004);
    },
    disconnect() {
      try { input.disconnect(); } catch {}
      try { stretch.stop(); stretch.disconnect(); } catch {}
    },
  };
}
