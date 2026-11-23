// "Drum tail", step 1: pick out the hits. A fast and a slow loudness envelope are compared;
// while the fast one is clearly above the slow one a hit is starting, and only that part
// passes. Steady sound (held notes, pads, the rest of a dense mix) keeps both envelopes
// level and is shut out. The chain then gives these hit fronts a decaying tail, so every
// hit rings out longer even in a loud, busy song.
class DrumTail extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    const c = (sec) => Math.exp(-1 / (sec * sampleRate));
    this.fastAtk = c(0.0005); this.fastRel = c(0.03);
    this.slowAtk = c(0.04); this.slowRel = c(0.25);
    this.fast = 0; this.slow = 0; this.gate = 0;
    this.smooth = c(0.002);
  }

  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    const amount = params.amount[0];
    if (!input.length) return true;
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      let x = 0;
      for (const ch of input) { const v = Math.abs(ch[i]); if (v > x) x = v; }
      this.fast = x > this.fast ? this.fastAtk * this.fast + (1 - this.fastAtk) * x : this.fastRel * this.fast + (1 - this.fastRel) * x;
      this.slow = x > this.slow ? this.slowAtk * this.slow + (1 - this.slowAtk) * x : this.slowRel * this.slow + (1 - this.slowRel) * x;
      // 0 on steady sound, 1 once the fast envelope is 50% above the slow one (a hit front).
      const target = Math.min(1, Math.max(0, (this.fast / (this.slow + 1e-6) - 1) * 2));
      this.gate = this.smooth * this.gate + (1 - this.smooth) * target;
      const g = this.gate * amount;
      for (let c = 0; c < output.length; c++) {
        const src = input[c] || input[0];
        output[c][i] = src[i] * g;
      }
    }
    return true;
  }
}

registerProcessor('drum-tail', DrumTail);
