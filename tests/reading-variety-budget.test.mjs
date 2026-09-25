import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadingOrchestra, MODES, planBar } from '../reader-soundscape.mjs';

// Independent score/graph audit. These tests measure admitted notes and actual
// output signatures; they make no claim about human musical preference.
const modes = Object.keys(MODES), tonics = [48, 50, 52, 53, 55, 57];
const edgeSeeds = [0, 1, 3, 0x55555555, 0xaaaaaaaa, 0x7fffffff, 0x80000000, 0xffffffff];
const profiles = [
  { energy: 0, thought: 1, space: .8, valence: -.8, confidence: 1, phraseSpace: .8, cadence: .9, words: 210, sectionProgress: .95, role: 'quote' },
  { energy: 1, thought: 0, space: .2, valence: .8, confidence: 1, phraseSpace: .1, cadence: .1, words: 30, sectionProgress: .05, role: 'heading', heading: true },
  { energy: .4, thought: .6, space: .4, valence: 0, confidence: .1, phraseSpace: .4, cadence: .5, words: 100, sectionProgress: .5, role: 'table' },
  { energy: .8, thought: .2, space: .7, valence: -.6, confidence: .9, phraseSpace: .53, cadence: .7, words: 101, sectionProgress: .75, role: 'paragraph' }
];
const allowedVoices = { bass: [3], lead: [4, 5, 6, 7, 11, 12, 13, 14], answer: [4, 5, 6, 7, 11, 12], bell: [8, 9], pulse: [10] };
const defaults = { bar: 0, beat: 60 / 90, tonic: 48, mode: 'dorian', motifSeed: 42,
  profile: { ...profiles[1], energy: .6, valence: 0, sectionSeed: 777, seed: 9 } };
const pc = pitch => ((pitch % 12) + 12) % 12;
const phraseSignature = (motifSeed, cycle, profile = defaults.profile) => JSON.stringify(
  Array.from({ length: 8 }, (_, phase) => planBar({ ...defaults, motifSeed, bar: cycle * 8 + phase, profile }).events
    .filter(event => event.role === 'lead' || event.role === 'answer')
    .map(event => [event.role, event.step, event.pitch, Number((event.duration / defaults.beat).toFixed(6))]))
);

test('generative plans stay finite, diatonic and bounded across seeds, all modes and later cycle boundaries', () => {
  const seeds = [...new Set([...Array.from({ length: 64 }, (_, i) => i), ...edgeSeeds])];
  const cycles = [0, 1, 2, 3, 7, 8, 15, 16, 31, 32, 63, 64, 127, 255, 1023, 65535];
  for (const seed of seeds) for (let m = 0; m < modes.length; m++) for (let c = 0; c < cycles.length; c++) {
    const mode = modes[m], tonic = tonics[(seed + c) % tonics.length], beat = 60 / [74, 90, 112][c % 3];
    const profile = { ...profiles[(seed + c) % profiles.length], sectionSeed: (seed ^ (c * 2654435761)) >>> 0, seed: c };
    for (let phase = 0; phase < 8; phase += 2) {
      const pair = [0, 1].map(offset => planBar({ bar: cycles[c] * 8 + phase + offset, beat, tonic, mode, motifSeed: seed, profile }));
      assert.ok(pair[0].events.length + pair[1].events.length <= 64);
      for (const plan of pair) {
        assert.equal(plan.chord.length, 3);
        assert.ok(plan.chord.every(pitch => Number.isInteger(pitch) && pitch >= 24 && pitch <= 96 && MODES[mode].includes(pc(pitch - tonic))));
        let previousStep = -1;
        for (const event of plan.events) {
          assert.ok(Number.isInteger(event.step) && event.step >= previousStep && event.step < 16);
          previousStep = event.step;
          assert.ok(allowedVoices[event.role]?.includes(event.voice));
          assert.ok(Number.isInteger(event.pitch) && event.pitch >= 12 && event.pitch <= 96);
          assert.ok(MODES[mode].includes(pc(event.pitch - tonic)), `${mode}, seed ${seed}, ${event.role} pitch ${event.pitch}`);
          assert.ok(Number.isFinite(event.attack) && event.attack > 0);
          assert.ok(Number.isFinite(event.duration) && event.duration > event.attack);
          assert.ok(Number.isFinite(event.level) && event.level > 0 && event.level <= .15);
        }
      }
    }
  }
});

test('generative output is deterministic and retains document identity independently of block seed', () => {
  for (const seed of edgeSeeds) for (const cycle of [0, 1, 7, 8, 31, 63]) {
    const expected = phraseSignature(seed, cycle);
    phraseSignature(seed ^ 0xffffffff, cycle + 1); // Unrelated call order must not advance hidden state.
    assert.equal(phraseSignature(seed, cycle), expected);
    assert.equal(phraseSignature(seed, cycle, { ...defaults.profile, seed: 999999 }), expected);
  }
});

test('actual melodic phrases vary across cycles and more than four document identities', () => {
  for (const seed of edgeSeeds) {
    const variations = new Set(Array.from({ length: 32 }, (_, cycle) => phraseSignature(seed, cycle)));
    assert.ok(variations.size >= 24, `seed ${seed} produced only ${variations.size}/32 distinct sounding phrases`);
  }
  const documents = new Set(Array.from({ length: 32 }, (_, seed) => phraseSignature(seed, 3)));
  assert.ok(documents.size >= 24, `only ${documents.size}/32 document seeds changed the sounding score`);
});

test('the audible opening cell keeps document identity through sections and phrase development', () => {
  const opening = (seed, cycle, sectionSeed) => planBar({ ...defaults, motifSeed: seed, bar: cycle * 8,
    profile: { ...defaults.profile, sectionSeed } }).events.filter(event => event.role === 'lead')
    .map(event => [event.step, event.pitch, event.duration]);
  for (const seed of edgeSeeds) {
    const expected = opening(seed, 0, 0);
    assert.equal(expected.length, 3);
    for (const cycle of [0, 1, 31, 65535]) for (const sectionSeed of [0, 42, 0xffffffff]) {
      assert.deepEqual(opening(seed, cycle, sectionSeed), expected);
    }
  }
});

test('large valence contrasts influence sounding material with mode, tempo and document identity fixed', () => {
  let changed = 0, cases = 0;
  for (const seed of edgeSeeds) for (const cycle of [0, 1, 7, 31]) {
    const base = { ...defaults.profile, confidence: 1 };
    const sombre = phraseSignature(seed, cycle, { ...base, valence: -.8 });
    const bright = phraseSignature(seed, cycle, { ...base, valence: .8 });
    cases++; if (sombre !== bright) changed++;
    assert.equal(phraseSignature(seed, cycle, { ...base, valence: -.8, confidence: 0 }),
      phraseSignature(seed, cycle, { ...base, valence: .8, confidence: 0 }),
      'zero-confidence valence must not create a harmonic or melodic contrast');
  }
  assert.ok(changed >= cases * .75, `valence affected ${changed}/${cases} otherwise identical phrase cases`);
});

function graphAudit() {
  const audit = { nodes: 0, sources: 0, started: 0, stopped: 0, disconnected: 0, waves: 0, closed: 0 };
  const parameter = () => ({ value: 0, cancelScheduledValues() {}, cancelAndHoldAtTime() {},
    setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = fields => { audit.nodes++; return { ...fields, connect() {}, disconnect() { audit.disconnected++; } }; };
  const context = { currentTime: 0, state: 'running', destination: {},
    createGain: () => node({ gain: parameter() }),
    createBiquadFilter: () => node({ frequency: parameter(), Q: parameter() }),
    createDynamicsCompressor: () => node({ threshold: parameter(), ratio: parameter(), knee: parameter() }),
    createDelay: () => node({ delayTime: parameter() }),
    createStereoPanner: () => node({ pan: parameter() }),
    createPeriodicWave() { audit.waves++; return {}; },
    createOscillator() { audit.sources++; return node({ frequency: parameter(), setPeriodicWave() {}, start() { audit.started++; }, stop() { audit.stopped++; } }); },
    async close() { audit.closed++; this.state = 'closed'; }
  };
  return { context, audit };
}

test('the real graph and scheduler admit every varied note while retaining two plans and fixed sources', async () => {
  for (let seedIndex = 0; seedIndex < edgeSeeds.length; seedIndex++) for (const initialMode of modes) {
    const { context, audit } = graphAudit(), engine = new ReadingOrchestra();
    engine.context = context;
    engine.current = { ...profiles[seedIndex % 4], tonic: tonics[seedIndex % 6], mode: initialMode,
      seed: 5, motifSeed: edgeSeeds[seedIndex], sectionSeed: 777 };
    engine.target = { ...engine.current }; engine.mode = engine.candidateMode = initialMode;
    engine.candidateSince = 0; engine.lastModeBar = -4; engine.buildGraph();
    let at = .06, attempted = 0, admitted = 0, pair;
    const note = engine.note.bind(engine);
    engine.note = (...args) => { attempted++; const result = note(...args); if (result) admitted++; return result; };
    try {
      for (let step = 0; step < 64 * 8 * 16; step++) {
        context.currentTime = at;
        if (step % 5 === 0) {
          const nextMode = modes[Math.floor(step / 128) % modes.length];
          engine.setTarget({ ...profiles[Math.floor(step / 32) % profiles.length], seed: step,
            mode: nextMode, valence: nextMode === 'minor' ? -.8 : nextMode === 'dorian' ? 0 : .8,
            space: nextMode === 'lydian' ? .9 : .2, confidence: .9,
            sectionSeed: (777 + Math.floor(step / 96)) >>> 0 });
        }
        const interval = engine.schedule(at);
        if (step % 32 === 0) pair = engine.plans;
        assert.equal(engine.plans, pair, 'in-flight target must not replace reserved pair');
        assert.equal(engine.plans.length, 2);
        assert.equal(engine.plans[0].beat, engine.plans[1].beat);
        assert.ok(engine.stats().plannedEvents <= 64);
        assert.equal(engine.stats().nodes, 52); assert.equal(engine.stats().sources, 15);
        assert.ok(interval > 0 && Number.isFinite(interval));
        at += interval;
      }
      assert.ok(attempted > 1000);
      assert.equal(admitted, attempted, `${initialMode} seed ${edgeSeeds[seedIndex]} dropped ${attempted - admitted} notes`);
      assert.equal(audit.nodes, 52); assert.equal(audit.sources, 15); assert.equal(audit.waves, 5);
    } finally { await engine.stop(true); }
    assert.equal(audit.stopped, 15); assert.equal(audit.disconnected, 52); assert.equal(audit.closed, 1);
    assert.equal(engine.stats().contexts, 0); assert.equal(engine.stats().plannedEvents, 0);
  }
});

test('four consecutive phrases visit distinct lead timbres with fixed pools and unchanged opening notes', () => {
  const pools = { pluck: [4, 5], flute: [6, 7], keys: [11, 12], strings: [13, 14] };
  for (const motifSeed of edgeSeeds) {
    const leaders = new Set();
    for (let cycle = 0; cycle < 4; cycle++) {
      const colours = new Set();
      for (let phase = 0; phase < 8; phase++) {
        const score = planBar({ ...defaults, motifSeed, bar: cycle * 8 + phase });
        for (const event of score.events.filter(e => ['lead', 'answer'].includes(e.role))) {
          assert.ok(pools[event.instrument].includes(event.voice));
          if (event.role === 'lead') colours.add(event.instrument);
        }
      }
      assert.equal(colours.size, 1, 'hold the lead timbre for a whole phrase');
      leaders.add([...colours][0]);
    }
    assert.deepEqual([...leaders].sort(), ['flute', 'keys', 'pluck', 'strings']);
  }
});
