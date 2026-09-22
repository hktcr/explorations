/* Explorations: a bounded, local reading score. Musical interpretation, not sentiment fact.
 * Inspiration: VävR Hard Fork reborn Fable 5.1.1 (motivic identity, harmonic worlds,
 * shared harmony and strict resource budgets), plus melodic answering voices.
 * No VävR engine, sample library, network analysis or per-note audio nodes are loaded.
 */
export const MODES = Object.freeze({
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11]
});
export const MODE_LABELS = { major: 'dur', minor: 'moll', dorian: 'dorisk', lydian: 'lydisk' };
export const MAX_BLOCKS = 1600;
export const MAX_CHARACTERS = 600000;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const words = text => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const dictionary = entries => new Set(entries.split(' '));
const lexicon = {
  light: dictionary('hope hopeful joy love care trust possibility possibilities discovery discover beauty beautiful recovery recover freedom success resilient wonder creative creativity connection healing compassion hopp glädje kärlek omsorg tillit möjlighet upptäckt skönhet återhämtning frihet läkning gemenskap'),
  dark: dictionary('loss grief death dying violence war failure failed fear harm harmful suffering pain abuse danger crisis threat threats attack attacks breach exploit intrusion injustice loneliness doubt sorrow förlust sorg död våld krig rädsla skada lidande smärta hot kris intrång orättvisa ensamhet'),
  motion: dictionary('urgent sudden rapidly rapid conflict change changes action struggle acceleration attack breakthrough transformation tension quickly urgency plötsligt snabbt konflikt förändring handling kamp genombrott omvandling spänning'),
  space: dictionary('ocean sea sky stars space universe silence memory memories landscape night dream dreams time distance forest nature light consciousness hav himmel stjärnor rymd universum tystnad minne landskap natt dröm tid skog natur ljus medvetande'),
  reason: dictionary('evidence research study studies analysis data method methods theory experiment results system systems model models probability however uncertainty question questions argument philosophy evidence forskning studie analys metod teori resultat modell osäkerhet fråga argument filosofi')
};
const negations = dictionary('not no never without neither inte ingen aldrig utan inga inget');

export function fingerprint(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function describeText(text) {
  const tokens = words(text.slice(0, 16000));
  const counts = { light: 0, dark: 0, motion: 0, space: 0, reason: 0 };
  tokens.forEach((word, i) => {
    const negated = tokens.slice(Math.max(0, i - 3), i).some(t => negations.has(t));
    for (const key of Object.keys(counts)) {
      if (lexicon[key].has(word)) counts[key] += negated ? -.45 : 1;
    }
  });
  const mass = Math.max(3, Math.sqrt(tokens.length) * .65);
  return {
    valence: clamp((counts.light - counts.dark) / mass, -1, 1),
    energy: clamp(.32 + counts.motion / mass * .3 + Math.min(3, (text.match(/!/g) || []).length) * .035),
    space: clamp(.22 + counts.space / mass * .45),
    thought: clamp(.3 + counts.reason / mass * .45 + Math.min(4, (text.match(/\?/g) || []).length) * .04),
    words: tokens.length, seed: fingerprint(text)
  };
}

export function modeFor(profile) {
  if (profile.valence < -.13) return 'minor';
  if (profile.valence > .18) return profile.space > .5 ? 'lydian' : 'major';
  return profile.space > .56 ? 'lydian' : 'dorian';
}

export function blendProfiles(a, b, weight) {
  const out = { ...b };
  for (const key of ['valence', 'energy', 'space', 'thought']) out[key] = a[key] * (1 - weight) + b[key] * weight;
  out.mode = modeFor(out);
  return out;
}

export const BLOCK_SKIP = 'nav,footer,aside,script,style,[data-xr-reader-ui],[data-engagement-asset],.references,.sources,.source-item,.bibliography,.toc,#toc,.table-of-contents,#references,#sources,.related-essays';

// Bound the element references and retained profiles; text is discarded after each chunk.
export async function analyseDocument(article, title = '', signal) {
  const blocks = [];
  const walker = article.ownerDocument.createTreeWalker(article, 1);
  let element, characters = 0, heading = describeText(title), processed = 0;
  const aggregate = { valence: 0, energy: 0, space: 0, thought: 0, words: 0, seed: fingerprint(title) };
  while ((element = walker.nextNode()) && blocks.length < MAX_BLOCKS && characters < MAX_CHARACTERS) {
    if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    if (!element.matches('h1,h2,h3,h4,p,li,blockquote,pre') || element.closest(BLOCK_SKIP)) continue;
    if (element.matches('li,blockquote') && element.querySelector('p,li')) continue;
    const text = (element.textContent || '').trim().slice(0, Math.min(16000, MAX_CHARACTERS - characters));
    if (text.length < 15) continue;
    characters += text.length;
    const raw = describeText(text);
    const isHeading = /^H[1-4]$/.test(element.tagName);
    if (isHeading) heading = raw;
    const profile = blendProfiles(raw, heading, isHeading ? 0 : .2);
    const weight = Math.min(180, raw.words) * (isHeading ? 2 : 1);
    for (const key of ['valence', 'energy', 'space', 'thought']) aggregate[key] += raw[key] * weight;
    aggregate.words += weight;
    blocks.push({ element, ...profile, words: raw.words, seed: raw.seed, heading: isHeading });
    if (++processed % 24 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  for (const key of ['valence', 'energy', 'space', 'thought']) aggregate[key] = aggregate.words ? aggregate[key] / aggregate.words : describeText(title)[key];
  const global = blendProfiles(aggregate, describeText(title), .18);
  global.seed = fingerprint(title + ':' + blocks.map(b => b.seed).join(','));
  global.tonic = [48, 50, 52, 53, 55, 57][global.seed % 6];
  blocks.forEach((block, i) => {
    let local = blendProfiles(block, blocks[Math.max(0, i - 1)], .15);
    local = blendProfiles(local, blocks[Math.min(blocks.length - 1, i + 1)], .15);
    Object.assign(block, blendProfiles(global, local, .72), { element: block.element, words: block.words, seed: block.seed, heading: block.heading });
  });
  return { global, blocks, limited: blocks.length === MAX_BLOCKS || characters >= MAX_CHARACTERS };
}

export function readingFraction(top, bottom, viewport, scrollY, offset = 80) {
  const start = Math.max(0, top - offset);
  const end = Math.max(start, bottom - viewport + 28);
  if (end <= start) return bottom <= scrollY + viewport ? 1 : 0;
  return clamp((scrollY - start) / (end - start));
}

const midi = n => 440 * 2 ** ((n - 69) / 12);
const MOTIFS = [[0, 2, 4, 3, 2, 0, 1, 4], [0, 4, 5, 4, 2, 1, 2, 0], [2, 3, 4, 6, 5, 4, 2, 1], [4, 2, 1, 0, 2, 4, 3, 0]];

// Fixed pool: 3 pad + bass + 2 pluck + 2 flute + 2 bell + pulse = 11 sources.
// One scheduler, <=4 steps/tick, 120 ms lookahead, no per-note nodes or retained history.
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
      this.step = 0;
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
    const wet = this.node(ctx.createGain()); wet.gain.value = .18;
    filter.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(wet); wet.connect(master);
    const colours = ['triangle', 'sine', 'triangle', 'triangle', 'pluck', 'pluck', 'flute', 'flute', 'bell', 'bell', 'sine'];
    const spectra = { pluck: [0, 1, .32, .13, .06, .025], flute: [0, 1, .09, .2, .025, .04], bell: [0, 1, .035, .21, .02, .07] };
    const waves = Object.fromEntries(Object.entries(spectra).map(([name, partials]) => [name, ctx.createPeriodicWave(new Float32Array(partials.length), new Float32Array(partials))]));
    colours.forEach((type, i) => {
      const oscillator = this.node(ctx.createOscillator());
      if (waves[type]) oscillator.setPeriodicWave(waves[type]); else oscillator.type = type;
      const gain = this.node(ctx.createGain()); gain.gain.value = 0;
      const pan = this.node(ctx.createStereoPanner()); pan.pan.value = i < 3 ? (i - 1) * .3 : ((i % 2) * 2 - 1) * .22;
      oscillator.connect(gain); gain.connect(pan); pan.connect(bus); oscillator.start();
      this.voices.push({ oscillator, gain, level: 0, until: 0 });
    });
  }

  setTarget(profile) {
    if (!this.context || !profile) return;
    if (profile.seed !== this.target.seed) this.targetSince = this.context.currentTime;
    this.target = { ...profile, tonic: this.current.tonic };
  }

  setVolume(value) {
    this.volume = clamp(Number(value) || 0);
    if (this.master && !this.closing) {
      const time = this.context.currentTime;
      this.master.gain.cancelScheduledValues(time);
      this.master.gain.setTargetAtTime(this.volume * (this.ducked ? .22 : 1), time, .3);
    }
  }

  duck(value) { this.ducked = value; this.setVolume(this.volume); }

  note(index, pitch, at, duration, level, attack = .03) {
    const voice = this.voices[index];
    if (!voice || at < voice.until) return;
    const gain = voice.gain.gain;
    gain.cancelScheduledValues(at);
    gain.setValueAtTime(0, at);
    voice.oscillator.frequency.cancelScheduledValues(at);
    voice.oscillator.frequency.setValueAtTime(midi(pitch), at);
    gain.linearRampToValueAtTime(level, at + attack);
    gain.exponentialRampToValueAtTime(.0001, at + duration);
    gain.setValueAtTime(0, at + duration + .01);
    voice.until = at + duration + .02;
  }

  pads(at, root, scale, pivot) {
    const chord = pivot ? [0, 7, 12] : [0, scale[2], 7];
    chord.forEach((degree, i) => {
      const voice = this.voices[i], gain = voice.gain.gain;
      gain.cancelScheduledValues(at);
      gain.setValueAtTime(voice.level, at);
      gain.linearRampToValueAtTime(0, at + .9);
      voice.oscillator.frequency.cancelScheduledValues(at);
      voice.oscillator.frequency.setValueAtTime(midi(root + degree), at + .92);
      voice.level = .034 + this.current.space * .016;
      gain.linearRampToValueAtTime(voice.level, at + 2.2);
    });
  }

  schedule(at) {
    const step = this.step % 16, bar = Math.floor(this.step / 16);
    const p = this.current;
    for (const key of ['energy', 'space', 'thought', 'valence']) p[key] += (this.target[key] - p[key]) * .028;
    if (step === 0 && this.target.mode !== this.mode && bar - this.lastModeBar >= 2 && at - this.targetSince >= 1.5) {
      this.mode = this.target.mode; this.lastModeBar = bar; this.pivotBar = bar;
    }
    const pivot = this.pivotBar === bar;
    const scale = MODES[this.mode] || MODES.dorian;
    const progression = [0, 5, 3, 4];
    const chordDegree = progression[Math.floor(bar / 2) % progression.length];
    const root = p.tonic + scale[chordDegree];
    const tone = degree => p.tonic + scale[((degree % 7) + 7) % 7] + 12 * Math.floor(degree / 7);
    const beat = 60 / (82 + p.energy * 30 - p.thought * 8);
    this.filter.frequency.setTargetAtTime(1500 + p.energy * 1800 + p.space * 700, at, 2);
    if (step === 0) this.pads(at, root, [0, 0, scale[(chordDegree + 2) % 7] + (chordDegree + 2 >= 7 ? 12 : 0) - scale[chordDegree]], pivot);
    if (step === 0 || step === 8 || (step === 11 && p.energy > .58)) this.note(3, root - 12, at, beat * 1.35, .12, .04);
    if ([0, 8].includes(step) && p.energy > .38) this.note(10, root - 24, at, .2, .055, .012);
    const motif = MOTIFS[p.seed % MOTIFS.length];
    const longParagraph = this.target.words > 100;
    const rhythm = longParagraph ? [0, 6, 10] : [0, 3, 6, 10, 14];
    if (!pivot && rhythm.includes(step)) {
      const index = rhythm.indexOf(step);
      const variation = bar % 8 >= 4 ? 1 : 0;
      const degree = motif[(index + Math.floor(bar / 2)) % motif.length] + variation;
      this.note(4 + index % 2, tone(degree + 7), at, beat * 1.25, .065 + p.energy * .03, .012);
    }
    // Answer the motif with breath and space; both instruments share the same harmony.
    if (!pivot && bar % 4 >= 2 && [2, 9].includes(step)) {
      const degree = motif[(bar + (step === 9 ? 2 : 0)) % motif.length];
      this.note(6 + (step === 9 ? 1 : 0), tone(degree + 7), at, beat * (longParagraph ? 2.5 : 1.8), .043, .3);
    }
    if (!pivot && step === 12 && (bar % 4 === 3 || (this.target.heading && bar % 2 === 1))) this.note(8 + bar % 2, tone(chordDegree + 14), at, beat * 2.7, .045, .018);
    this.step++;
    return beat / 4 * (step % 2 ? .96 : 1.04);
  }

  tick() {
    if (!this.context || this.closing || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (this.nextAt < now - .12) this.nextAt = now + .04; // Never replay a backlog after throttling.
    let count = 0;
    while (this.nextAt < now + .12 && count++ < 4) this.nextAt += this.schedule(this.nextAt);
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
        this.nodes.length = 0; this.voices.length = 0;
        this.context = null; this.master = null; this.filter = null; this.current = null; this.target = null;
        Promise.resolve(ctx.close()).catch(() => {}).then(resolve);
      };
      if (immediate || ctx.state !== 'running') this.finishStop();
      else {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(0, ctx.currentTime, .07);
        this.shutdownTimer = setTimeout(() => this.finishStop?.(), 350);
      }
    }).finally(() => { this.closing = null; });
    return this.closing;
  }

  stats() { return { contexts: Number(Boolean(this.context)), sources: this.voices.length, nodes: this.nodes.length, schedulers: Number(this.timer !== null), closing: Boolean(this.closing), step: this.step, mode: this.mode }; }
}
