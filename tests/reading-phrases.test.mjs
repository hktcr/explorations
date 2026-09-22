import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, scaleTone, chordPitches, voiceLeading, planBar, ReadingOrchestra } from '../reader-soundscape.mjs';

const pc = pitch => ((pitch % 12) + 12) % 12;
const sortedClasses = pitches => pitches.map(pc).sort((a, b) => a - b);
const modes = Object.keys(MODES);
const seeds = [0, 1, 2, 3, 0xffffffff];
const beats = [60 / 74, 60 / 90, 60 / 112];
const profiles = [
  { energy: .32, space: .22, thought: .3, valence: 0, words: 60, cadence: .8, confidence: .8, role: 'paragraph', heading: false, seed: 123 },
  { energy: .15, space: .7, thought: .9, valence: -.4, words: 220, cadence: .8, confidence: .8, role: 'paragraph', heading: false, seed: 456 },
  { energy: .8, space: .3, thought: .2, valence: .7, words: 30, cadence: .2, confidence: .8, role: 'heading', heading: true, seed: 789 },
  { energy: .32, space: .22, thought: .3, valence: 0, words: 101, cadence: .2, confidence: .1, role: 'quote', heading: false, seed: 987 }
];
const allowedVoices = { bass: [3], pluck: [4, 5], flute: [6, 7], bell: [8, 9], pulse: [10] };
const options = overrides => ({ bar: 0, beat: 60 / 90, tonic: 48, mode: 'dorian', motifSeed: 0, profile: profiles[0], pivot: false, ...overrides });
const plan = overrides => planBar(options(overrides));
const eventsOf = (score, role) => score.events.filter(event => event.role === role);
// These tests inspect the score and voice reservations, not perceptual quality.
const stepTime = (step, beat) => (Math.floor(step / 2) * .5 + (step % 2 ? .26 : 0)) * beat;
const startTime = (bar, event, beat) => bar * 4 * beat + stepTime(event.step, beat);

test('scale degrees retain the mode through octave boundaries and negative degrees', () => {
  assert.equal(scaleTone(48, 'major', -1), 47);
  assert.equal(scaleTone(48, 'minor', -1), 46);
  assert.equal(scaleTone(48, 'dorian', -8), 34);
  assert.equal(scaleTone(48, 'lydian', 3), 54);
  assert.equal(scaleTone(48, 'major', 14), 72);
  for (const mode of modes) for (const tonic of [48, 53, 57]) for (let degree = -14; degree <= 20; degree++) {
    const pitch = scaleTone(tonic, mode, degree);
    assert.ok(Number.isInteger(pitch));
    assert.ok(MODES[mode].includes(pc(pitch - tonic)), `${mode}: degree ${degree} escaped its scale`);
    assert.equal(scaleTone(tonic, mode, degree + 7), pitch + 12);
  }
});

test('dorian and lydian diminished chords use their diatonic fifths', () => {
  assert.deepEqual(chordPitches(48, 'dorian', 5), [57, 60, 63]);
  assert.deepEqual(chordPitches(48, 'lydian', 3), [54, 57, 60]);
  for (const mode of modes) for (let degree = 0; degree < 7; degree++) {
    const chord = chordPitches(48, mode, degree);
    assert.equal(chord.length, 3);
    assert.ok(chord[0] < chord[1] && chord[1] < chord[2]);
    assert.equal(new Set(chord.map(pc)).size, 3);
    assert.ok(chord.every(pitch => MODES[mode].includes(pc(pitch - 48))));
  }
});

test('voice leading preserves unchanged notes and the requested chord without mutating inputs', () => {
  const previous = Object.freeze([60, 64, 67]);
  const sameChord = Object.freeze([48, 52, 55]);
  assert.deepEqual(voiceLeading(previous, sameChord), previous);
  for (const mode of modes) for (let degree = 0; degree < 7; degree++) {
    const pitches = Object.freeze(chordPitches(48, mode, degree));
    const next = voiceLeading(previous, pitches);
    assert.equal(next.length, 3);
    assert.ok(next.every(Number.isInteger));
    assert.ok(next[0] < next[1] && next[1] < next[2]);
    assert.deepEqual(sortedClasses(next), sortedClasses(pitches));
    assert.deepEqual(previous, [60, 64, 67]);
  }
});

test('bar plans are deterministic and keep document identity when only block identity changes', () => {
  const profile = Object.freeze({ ...profiles[0] });
  for (const mode of modes) for (const motifSeed of seeds) for (let bar = 0; bar < 8; bar++) {
    const input = Object.freeze(options({ bar, mode, motifSeed, profile }));
    const first = planBar(input);
    assert.deepEqual(planBar(input), first);
    assert.deepEqual(planBar({ ...input, profile: { ...profile, seed: profile.seed + 1 } }), first);
  }
});

test('the eight-bar score stays diatonic, finite and inside the agreed event and voice budgets', () => {
  for (const mode of modes) for (const motifSeed of seeds) for (const profile of profiles) {
    for (let bar = 0; bar < 8; bar += 2) {
      const pair = [bar, bar + 1].map(index => plan({ bar: index, mode, motifSeed, profile }));
      assert.ok(pair[0].events.length + pair[1].events.length <= 64);
      for (const score of pair) {
        assert.equal(score.chord.length, 3);
        assert.ok(score.chord.every(pitch => MODES[mode].includes(pc(pitch - 48))));
        assert.ok(eventsOf(score, 'pluck').length <= 3);
        assert.ok(eventsOf(score, 'flute').length <= 2);
        let lastStep = -1;
        for (const event of score.events) {
          assert.ok(Number.isInteger(event.step) && event.step >= 0 && event.step < 16);
          assert.ok(event.step >= lastStep, 'events must be in scheduling order');
          lastStep = event.step;
          assert.ok(allowedVoices[event.role]?.includes(event.voice), `unexpected ${event.role} voice ${event.voice}`);
          assert.ok(Number.isInteger(event.pitch));
          assert.ok(MODES[mode].includes(pc(event.pitch - 48)), `${mode} ${event.role} escaped its scale`);
          assert.ok(Number.isFinite(event.duration) && event.duration > event.attack);
          assert.ok(Number.isFinite(event.attack) && event.attack > 0);
          assert.ok(Number.isFinite(event.level) && event.level > 0);
        }
      }
    }
  }
});

test('all planned pluck and flute notes fit their existing pools across bar and phrase boundaries', () => {
  for (const mode of modes) for (const motifSeed of seeds) for (const beat of beats) for (const profilePattern of [...profiles.map(profile => [profile]), profiles]) {
    const until = new Map();
    let previousPluckStep = -Infinity;
    for (let bar = 0; bar < 16; bar++) {
      const profile = profilePattern[Math.floor(bar / 2) % profilePattern.length];
      const score = plan({ bar, beat, mode, motifSeed, profile });
      for (const event of score.events) {
        if (!['pluck', 'flute'].includes(event.role)) continue;
        const at = startTime(bar, event, beat);
        assert.ok(at + 1e-9 >= (until.get(event.voice) ?? 0), `${mode} seed ${motifSeed}: ${event.role} voice ${event.voice} still busy at bar ${bar} step ${event.step}`);
        until.set(event.voice, at + event.duration + .02);
        if (event.role === 'pluck') {
          const absoluteStep = bar * 16 + event.step;
          assert.ok(absoluteStep - previousPluckStep >= 4, 'pluck gestures need deliberate breathing room');
          previousPluckStep = absoluteStep;
        }
      }
    }
  }
});

test('flute responses have space after the lead and finish before the next bar', () => {
  for (const beat of beats) for (const profile of profiles) for (let bar = 1; bar < 8; bar += 2) {
    const score = plan({ bar, beat, profile });
    const lead = eventsOf(score, 'pluck'), replies = eventsOf(score, 'flute');
    assert.ok(lead.length > 0 && replies.length > 0);
    const leadEnd = Math.max(...lead.map(event => stepTime(event.step, beat) + event.duration));
    for (const event of replies) {
      assert.ok(stepTime(event.step, beat) >= leadEnd, 'response must not cover the scheduled lead phrase');
      assert.ok(stepTime(event.step, beat) + event.duration < 4 * beat, 'response must leave room for the next phrase');
    }
  }
});

test('the final phrase can close on the tonic or stay open on its fifth', () => {
  for (const mode of modes) for (const motifSeed of seeds) for (const tonic of [48, 53, 57]) {
    const closed = plan({ bar: 7, tonic, mode, motifSeed, profile: { ...profiles[0], cadence: .8 } });
    const open = plan({ bar: 7, tonic, mode, motifSeed, profile: { ...profiles[0], cadence: .2 } });
    assert.equal(eventsOf(closed, 'flute').at(-1).pitch, tonic + 12);
    assert.equal(eventsOf(open, 'flute').at(-1).pitch, tonic + 19);
    assert.ok(sortedClasses(closed.chord).includes(pc(tonic)));
    assert.ok(sortedClasses(open.chord).includes(pc(tonic + 7)));
  }
});

test('the phrase develops its gesture instead of repeating the same melodic bar eight times', () => {
  for (const motifSeed of seeds) {
    const gestures = Array.from({ length: 8 }, (_, bar) => eventsOf(plan({ bar, motifSeed }), 'pluck').map(event => event.pitch));
    assert.ok(gestures.every(gesture => gesture.length > 0));
    assert.ok(new Set(gestures.map(gesture => JSON.stringify(gesture))).size >= 2);
    assert.ok(eventsOf(plan({ bar: 0, motifSeed }), 'flute').length < eventsOf(plan({ bar: 1, motifSeed }), 'flute').length);
  }
});

test('pivot bars use common tonic harmony and defer the bass until the old pad has faded', () => {
  for (const mode of modes) for (let bar = 0; bar < 8; bar++) {
    const score = plan({ bar, mode, pivot: true, profile: profiles[2] });
    assert.deepEqual(score.chord, [48, 55, 60]);
    assert.ok(score.events.length > 0);
    assert.ok(score.events.every(event => event.role === 'bass'));
    assert.equal(score.events[0].step, 8);
    assert.ok(score.events.every(event => event.step >= 8 && event.voice === 3 && event.pitch === 36));
  }
});

function trackedParameter() {
  const calls = [];
  let scheduled = [];
  const append = (kind, value, time) => { calls.push({ kind, value, time }); scheduled.push({ kind, value, time }); };
  return {
    calls,
    cancelScheduledValues(time) { calls.push({ kind: 'cancel', time }); scheduled = scheduled.filter(event => event.time < time); },
    cancelAndHoldAtTime(time) { this.cancelScheduledValues(time); },
    setValueAtTime(value, time) { append('set', value, time); },
    linearRampToValueAtTime(value, time) { append('linear', value, time); },
    exponentialRampToValueAtTime(value, time) { append('exponential', value, time); },
    setTargetAtTime(value, time) { append('target', value, time); },
    linearValueAt(time) {
      let previous = { time: 0, value: 0 };
      for (const event of [...scheduled].sort((a, b) => a.time - b.time)) {
        if (event.time > time) {
          if (event.kind === 'linear') return previous.value + (event.value - previous.value) * (time - previous.time) / (event.time - previous.time);
          return previous.value;
        }
        previous = event;
      }
      return previous.value;
    }
  };
}

function scoreEngine(profile = profiles[0]) {
  const engine = new ReadingOrchestra();
  engine.context = { currentTime: 0, state: 'running' };
  engine.current = { ...profile, tonic: 48, mode: 'dorian', motifSeed: 0 };
  engine.target = { ...engine.current };
  engine.mode = engine.candidateMode = 'dorian';
  engine.candidateSince = 0;
  engine.lastModeBar = -4;
  engine.lastAt = null;
  engine.lastFilter = null;
  engine.padPitches = null;
  engine.filter = { frequency: trackedParameter() };
  engine.voices = Array.from({ length: 11 }, () => ({
    oscillator: { frequency: trackedParameter() }, gain: { gain: trackedParameter() }, level: 0, until: 0
  }));
  return engine;
}

test('the actual scheduler keeps each tempo pair intact and admits every planned note while targets change', () => {
  const engine = scoreEngine();
  let at = 0, admitted = 0, attempted = 0, pair, pairBeat;
  const tempos = new Set(), heardModes = new Set();
  const actualNote = engine.note.bind(engine);
  engine.note = (...args) => { attempted++; const played = actualNote(...args); if (played) admitted++; return played; };
  for (let index = 0; index < 32 * 16; index++) {
    engine.context.currentTime = at;
    if (index % 32 === 5) {
      const profile = profiles[Math.floor(index / 32) % profiles.length];
      engine.setTarget({ ...profile, mode: modes[Math.floor(index / 32) % modes.length] });
    }
    const interval = engine.schedule(at);
    if (index % 32 === 0) {
      pair = engine.plans;
      pairBeat = pair[0].beat;
      assert.equal(pair[1].beat, pairBeat);
      tempos.add(pairBeat.toFixed(6));
      heardModes.add(engine.mode);
    }
    assert.equal(engine.plans, pair, 'a new text target must not replace a reserved pair');
    assert.ok(Math.abs(interval - pairBeat / 4 * (index % 2 ? .96 : 1.04)) < 1e-10);
    assert.ok(engine.plans.reduce((sum, bar) => sum + bar.events.length, 0) <= 64);
    at += interval;
  }
  assert.ok(attempted > 100);
  assert.equal(admitted, attempted, 'all intentional notes, including bass and accents, must be admitted');
  assert.ok(tempos.size > 1 && heardModes.size > 1, 'the fixture must exercise actual tempo and tonal transitions');
});

test('unchanged pad voices sustain and moved voices retune only inside an actual zero plateau', () => {
  const engine = scoreEngine();
  engine.pads(0, [48, 52, 55]);
  const initialCalls = engine.voices.slice(0, 3).map(voice => voice.gain.gain.calls.length);
  engine.pads(3, [48, 52, 55]);
  assert.deepEqual(engine.voices.slice(0, 3).map(voice => voice.gain.gain.calls.length), initialCalls);
  const previousPitches = engine.voices.slice(0, 3).map(voice => voice.pitch);
  engine.pads(6, [53, 57, 60]);
  let changed = 0, retained = 0;
  engine.voices.slice(0, 3).forEach((voice, index) => {
    if (voice.pitch === previousPitches[index]) {
      retained++;
      assert.equal(voice.gain.gain.calls.length, initialCalls[index]);
    } else {
      changed++;
      const retune = voice.oscillator.frequency.calls.filter(event => event.kind === 'set').at(-1);
      assert.equal(voice.gain.gain.linearValueAt(retune.time), 0);
      assert.equal(voice.gain.gain.linearValueAt(retune.time - .005), 0);
      assert.equal(voice.gain.gain.linearValueAt(retune.time + .005), 0);
    }
  });
  assert.ok(changed > 0 && retained > 0, 'the fixture needs both moved and genuinely sustained voices');
});

test('a stable score does not keep appending redundant filter targets', () => {
  const engine = scoreEngine();
  let at = 0;
  for (let index = 0; index < 8 * 16; index++) {
    engine.context.currentTime = at;
    at += engine.schedule(at);
  }
  assert.equal(engine.filter.frequency.calls.filter(event => event.kind === 'target').length, 1);
});
