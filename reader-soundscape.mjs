/* Explorations reading music: local analysis, an eight-bar motif and a fixed graph.
 * Inspired by VävR Hard Fork Fable 5.1.1. No samples or per-note audio nodes.
 */
import { MODES } from './reader-score-analysis.mjs?v=20260925-music-timing-1';
import { planBar, voiceLeading } from './reader-music-plan.mjs?v=20260925-music-timing-1';
export * from './reader-score-analysis.mjs?v=20260925-music-timing-1';
export { scaleTone, chordPitches, voiceLeading, planBar } from './reader-music-plan.mjs?v=20260925-music-timing-1';
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const midi = n => 440 * 2 ** ((n - 69) / 12);
const SCHEDULE_AHEAD = 1;
const MAX_STEPS_PER_TICK = 8;

// Fixed pool: 3 pad + bass + 2 pluck + 2 flute + 2 bell + pulse + 2 keys + 2 strings = 15 sources.
// One scheduler, <=8 steps/tick, 1 s lookahead, no per-note nodes or retained history.
// AudioParam automation keeps playing while the page's main thread is briefly
// busy. Eight steps can fill the whole horizon even at the maximum 112 BPM.
export class ReadingOrchestra {
  constructor(contextFactory = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)()) {
    this.contextFactory = contextFactory;
    this.context = null;
    this.nodes = [];
    this.voices = [];
    this.timer = null;
    this.shutdownTimer = null;
    this.closing = null;
    this.generation = 0;
    this.volume = .25;
    this.ducked = false;
    this.step = 0;
    this.plans = [];
    this.closeFailed = false;
  }

  async start(profile) {
    if (this.context || this.closing) return false;
    const generation = ++this.generation;
    const ctx = this.context = this.contextFactory();
    try {
      this.current = { ...profile };
      this.target = { ...profile };
      this.mode = profile.mode;
      this.lastModeBar = -4;
      this.pivotBar = -1;
      this.targetSince = ctx.currentTime;
      this.candidateMode = profile.mode;
      this.candidateSince = ctx.currentTime;
      this.current.motifSeed = profile.motifSeed ?? profile.seed;
      this.plans = [];
      this.lastAt = null;
      this.padPitches = null;
      this.lastFilter = null;
      this.closeFailed = false;
      this.step = 0;
      this.recoveryUntil = 0;
      this.pendingPadRecovery = false;
      this.skippedSteps = 0;
      this.buildGraph();
      await ctx.resume();
      if (this.generation !== generation || this.context !== ctx) return false;
      if (ctx.state !== 'running') throw new Error('Audio context did not start');
      this.nextAt = ctx.currentTime + .06;
      this.setVolume(this.volume);
      this.tick();
      this.timer = setInterval(() => this.tick(), 40);
      return true;
    } catch (error) {
      // A rejected old resume must not shut down a newer session.
      if (this.generation !== generation || this.context !== ctx) return false;
      await this.stop(true);
      throw error;
    }
  }

  node(node) { this.nodes.push(node); return node; }

  buildGraph() {
    const ctx = this.context;
    const bus = this.node(ctx.createGain());
    const filter = this.filter = this.node(ctx.createBiquadFilter());
    filter.type = 'lowpass'; filter.frequency.value = 2400; filter.Q.value = .45;
    const master = this.master = this.node(ctx.createGain()); master.gain.value = 0;
    const compressor = this.node(ctx.createDynamicsCompressor());
    compressor.threshold.value = -16; compressor.ratio.value = 5; compressor.knee.value = 12;
    bus.connect(filter); filter.connect(master); master.connect(compressor); compressor.connect(ctx.destination);
    // Short bounded delay, no convolution buffers and no unbounded feedback tail.
    const delay = this.node(ctx.createDelay(.8)); delay.delayTime.value = .37;
    const feedback = this.node(ctx.createGain()); feedback.gain.value = .22;
    const wet = this.node(ctx.createGain()); wet.gain.value = .09;
    filter.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(wet); wet.connect(master);
    const colours = ['triangle', 'sine', 'triangle', 'triangle', 'pluck', 'pluck', 'flute', 'flute', 'bell', 'bell', 'sine', 'keys', 'keys', 'strings', 'strings'];
    const spectra = { pluck: [0, 1, .32, .13, .06, .025], flute: [0, 1, .09, .2, .025, .04], bell: [0, 1, .035, .21, .02, .07], keys: [0, 1, .48, .12, .04, .12, .015], strings: [0, 1, .38, .23, .16, .1, .065, .035] };
    const waves = Object.fromEntries(Object.entries(spectra).map(([name, partials]) => [name, ctx.createPeriodicWave(new Float32Array(partials.length), new Float32Array(partials))]));
    colours.forEach((type, i) => {
      const oscillator = this.node(ctx.createOscillator());
      if (waves[type]) oscillator.setPeriodicWave(waves[type]); else oscillator.type = type;
      const gain = this.node(ctx.createGain()); gain.gain.value = 0;
      const pan = this.node(ctx.createStereoPanner()); pan.pan.value = i < 3 ? (i - 1) * .3 : ((i % 2) * 2 - 1) * .22;
      oscillator.connect(gain); gain.connect(pan); pan.connect(bus); oscillator.start();
      this.voices.push({ oscillator, gain, instrument: type, level: 0, until: 0 });
    });
  }

  setTarget(profile) {
    if (!this.context || !profile) return;
    if (!this.current || this.closing) return;
    let candidate = MODES[profile.mode] ? profile.mode : this.mode;
    // Cue coverage is not semantic certainty. Weak evidence and values close
    // to a boundary may colour the sound without repeatedly changing its mode.
    if (Number.isFinite(profile.confidence) && profile.confidence < .1) candidate = this.mode;
    if (candidate === 'dorian') {
      if (this.mode === 'minor' && profile.valence < -.09) candidate = 'minor';
      if (this.mode === 'major' && profile.valence > .13) candidate = 'major';
      if (this.mode === 'lydian' && profile.space > .52 && profile.valence >= -.09) candidate = 'lydian';
    }
    if (candidate !== this.candidateMode) {
      this.candidateMode = candidate;
      this.candidateSince = this.context.currentTime;
    }
    this.targetSince = this.candidateSince;
    this.target = { ...profile, mode: candidate, tonic: this.current.tonic, motifSeed: this.current.motifSeed };
  }

  setVolume(value) {
    this.volume = clamp(Number(value) || 0);
    if (this.master && !this.closing) {
      const time = this.context.currentTime;
      if (this.master.gain.cancelAndHoldAtTime) this.master.gain.cancelAndHoldAtTime(time);
      else this.master.gain.cancelScheduledValues(time);
      this.master.gain.setTargetAtTime(this.volume * (this.ducked ? .22 : 1), time, .3);
    }
  }

  duck(value) { this.ducked = value; this.setVolume(this.volume); }

  note(index, pitch, at, duration, level, attack = .03) {
    const voice = this.voices[index];
    if (!voice || at + 1e-7 < voice.until) return false;
    const gain = voice.gain.gain;
    gain.cancelScheduledValues(at);
    gain.setValueAtTime(0, at);
    voice.oscillator.frequency.cancelScheduledValues(at);
    voice.oscillator.frequency.setValueAtTime(midi(pitch), at);
    gain.linearRampToValueAtTime(level, at + attack);
    // Breath/bow tones need a held body; plucks/keys keep their decaying attack.
    // The release still ends inside the score's original voice reservation.
    if (voice.instrument === 'flute' || voice.instrument === 'strings') {
      gain.linearRampToValueAtTime(level * .78, at + duration * .58);
    }
    gain.exponentialRampToValueAtTime(.0001, at + duration);
    gain.setValueAtTime(0, at + duration + .01);
    voice.until = at + duration + .02;
    return true;
  }

  padLevel(voice, at) {
    const points = voice.envelope;
    if (!points?.length) return 0;
    if (at <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      if (at <= points[i][0]) {
        const [t0, v0] = points[i - 1], [t1, v1] = points[i];
        return v0 + (v1 - v0) * (at - t0) / Math.max(.0001, t1 - t0);
      }
    }
    return points.at(-1)[1];
  }

  pads(at, pitches) {
    const chord = voiceLeading(this.padPitches, pitches);
    const level = .032 + this.current.space * .012;
    chord.forEach((pitch, i) => {
      const voice = this.voices[i], gain = voice.gain.gain;
      if (voice.pitch === pitch && Math.abs((voice.level || 0) - level) < .001) return;
      const from = this.padLevel(voice, at);
      gain.cancelScheduledValues(at);
      gain.setValueAtTime(from, at);
      if (voice.pitch === pitch) {
        gain.linearRampToValueAtTime(level, at + .7);
        voice.envelope = [[at, from], [at + .7, level]];
      } else {
        // Hold exact zero around the frequency change; never retune on an attack.
        gain.linearRampToValueAtTime(0, at + .32);
        gain.setValueAtTime(0, at + .36);
        voice.oscillator.frequency.cancelScheduledValues(at);
        voice.oscillator.frequency.setValueAtTime(midi(pitch), at + .34);
        gain.linearRampToValueAtTime(level, at + 1.25);
        voice.envelope = [[at, from], [at + .32, 0], [at + .36, 0], [at + 1.25, level]];
      }
      voice.pitch = pitch;
      voice.level = level;
    });
    this.padPitches = chord;
  }

  planPair(bar, at, { beat: lockedBeat, holdMode = false } = {}) {
    const p = this.current;
    const candidate = this.candidateMode ?? this.target.mode;
    const since = this.candidateSince ?? this.targetSince ?? 0;
    let pivot = false;
    if (!holdMode && candidate !== this.mode && MODES[candidate] && bar - this.lastModeBar >= 2 && at - since >= 1.5) {
      this.mode = candidate;
      this.lastModeBar = bar;
      this.pivotBar = bar;
      pivot = true;
    }
    // Lock time and role decisions for two bars. Later tempo targets cannot
    // move an already reserved attack earlier and break the voice budget.
    const desiredTempo = clamp(82 + p.energy * 30 - p.thought * 8, 74, 112);
    const previousTempo = this.plans.length ? 60 / this.plans.at(-1).beat : desiredTempo;
    const beat = lockedBeat ?? 60 / clamp(desiredTempo, previousTempo - 3, previousTempo + 3);
    const profile = { ...this.target, energy: p.energy, space: p.space, thought: p.thought, valence: p.valence };
    const motifSeed = p.motifSeed ?? p.seed;
    this.plans = [0, 1].map(offset => planBar({ bar: bar + offset, beat, tonic: p.tonic, mode: this.mode, motifSeed, documentProfile: p.documentProfile, profile, pivot: pivot && offset === 0 }));
    if (this.plans.reduce((count, plan) => count + plan.events.length, 0) > 64) throw new Error('Reading score exceeded its event budget');
  }

  schedule(at, checkDeadline = false) {
    const step = this.step % 16, bar = Math.floor(this.step / 16);
    const p = this.current;
    const dt = this.lastAt == null ? 0 : Math.max(0, at - this.lastAt);
    const mix = 1 - Math.exp(-dt / 2.5);
    for (const key of ['energy', 'space', 'thought', 'valence']) p[key] += (this.target[key] - p[key]) * mix;
    this.lastAt = at;
    if (!this.plans.length || (step === 0 && !this.plans.some(plan => plan.bar === bar))) this.planPair(bar, at);
    const plan = this.plans.find(plan => plan.bar === bar);
    // Planning is normally tiny, but may be interrupted by the browser. Leave
    // this attack unscheduled if its safety margin expired during planning.
    if (checkDeadline && at < this.context.currentTime + .02) return 0;
    if (step === 0) this.pads(at, plan.chord);
    // At most four filter updates per bar; replace future automation rather
    // than accumulating an event on every sixteenth note indefinitely.
    if (step % 4 === 0) {
      const frequency = 1500 + p.energy * 1500 + p.space * 650;
      if (this.lastFilter == null || Math.abs(frequency - this.lastFilter) > 4) {
        const parameter = this.filter.frequency;
        if (parameter.cancelAndHoldAtTime) parameter.cancelAndHoldAtTime(at);
        else parameter.cancelScheduledValues(at);
        parameter.setTargetAtTime(frequency, at, 1.2);
        this.lastFilter = frequency;
      }
    }
    for (const event of plan.events) {
      if (event.step !== step || at < (this.recoveryUntil || 0)) continue;
      this.note(event.voice, event.pitch, at, event.duration, event.level, event.attack);
    }
    this.step++;
    return plan.beat / 4;
  }

  tick() {
    if (!this.context || !this.current || this.closing || this.closeFailed || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    const safeAt = now + .02;
    if (this.nextAt < safeAt) {
      // Keep the existing beat grid and skip missed attacks analytically. Never
      // submit notes in the past or replay a catch-up queue after a scroll stall.
      const previousBar = Math.floor((this.step - 1) / 16);
      const beat = this.plans.at(-1)?.beat ?? 60 / 90;
      const skipped = Math.ceil((safeAt - this.nextAt) / (beat / 4));
      this.step += skipped;
      this.skippedSteps = (this.skippedSteps || 0) + skipped;
      this.nextAt += skipped * beat / 4;
      const bar = Math.floor(this.step / 16);
      if (!this.plans.some(plan => plan.bar === bar)) this.planPair(bar - bar % 2, this.nextAt, { beat, holdMode: true });
      if (bar !== previousBar) {
        this.pendingPadRecovery = true;
      }
    }
    // Re-read after recovery planning. A missed deadline is retried by the next
    // ordinary tick, retaining pad recovery without allocating a retry timer.
    if (this.nextAt < this.context.currentTime + .02) return;
    if (this.pendingPadRecovery) {
      if (this.step % 16 !== 0) this.pads(this.nextAt, this.plans.find(plan => plan.bar === Math.floor(this.step / 16)).chord);
      this.recoveryUntil = this.nextAt + .37;
      this.pendingPadRecovery = false;
    }
    let count = 0;
    while (this.nextAt < now + SCHEDULE_AHEAD && count++ < MAX_STEPS_PER_TICK) {
      const interval = this.schedule(this.nextAt, true);
      if (!interval) break;
      this.nextAt += interval;
    }
  }

  stop(immediate = false) {
    ++this.generation;
    clearInterval(this.timer); this.timer = null;
    if (this.closing) {
      if (immediate) this.finishStop?.();
      return this.closing;
    }
    const ctx = this.context;
    if (!ctx) return Promise.resolve();
    const master = this.master;
    this.closing = new Promise(resolve => {
      this.finishStop = () => {
        clearTimeout(this.shutdownTimer); this.shutdownTimer = null;
        this.finishStop = null;
        for (const voice of this.voices) { try { voice.oscillator.stop(); } catch {} }
        for (const node of this.nodes) { try { node.disconnect(); } catch {} }
        this.nodes.length = 0; this.voices.length = 0; this.plans.length = 0;
        this.master = null; this.filter = null; this.current = null; this.target = null;
        this.padPitches = null;
        // Retain ownership until close really succeeds. A failed close blocks
        // allocation of a second context and remains visible in diagnostics/UI.
        let closing;
        try { closing = ctx.close(); } catch (error) { closing = Promise.reject(error); }
        Promise.resolve(closing).then(() => {
          this.context = null; this.closeFailed = false;
        }, () => {
          this.closeFailed = ctx.state !== 'closed';
          this.context = this.closeFailed ? ctx : null;
        }).then(resolve);
      };
      if (immediate || ctx.state !== 'running' || !master) this.finishStop();
      else {
        const now = ctx.currentTime;
        if (master.gain.cancelAndHoldAtTime) master.gain.cancelAndHoldAtTime(now);
        else master.gain.cancelScheduledValues(now);
        master.gain.setTargetAtTime(0, now, .07);
        this.shutdownTimer = setTimeout(() => this.finishStop?.(), 350);
      }
    }).finally(() => { this.closing = null; });
    return this.closing;
  }

  stats() {
    return { contexts: Number(Boolean(this.context)), sources: this.voices.length, nodes: this.nodes.length,
      schedulers: Number(this.timer !== null), closing: Boolean(this.closing), closeFailed: this.closeFailed,
      plannedEvents: this.plans.reduce((count, plan) => count + plan.events.length, 0),
      step: this.step, mode: this.mode, skippedSteps: this.skippedSteps || 0 };
  }
}
