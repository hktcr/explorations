import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadingOrchestra, MODES } from '../reader-soundscape.mjs';

const profile = { valence: 0, energy: .32, space: .22, thought: .3, confidence: 1,
  words: 40, phraseSpace: .25, cadence: .8, seed: 9, motifSeed: 5, tonic: 48, mode: 'dorian' };
function parameter() {
  return { events: [], cancelScheduledValues(at) { this.events.push(['cancel', at]); },
    setValueAtTime(v, at) { this.events.push(['set', v, at]); },
    linearRampToValueAtTime(v, at) { this.events.push(['linear', v, at]); },
    exponentialRampToValueAtTime(v, at) { this.events.push(['exp', v, at]); },
    setTargetAtTime(v, at, time) { this.events.push(['target', v, at, time]); } };
}
function engine(mode = 'dorian') {
  const e = new ReadingOrchestra();
  e.context = { currentTime: 0, state: 'running' };
  e.current = { ...profile, mode }; e.target = { ...e.current }; e.mode = mode;
  e.lastModeBar = -4; e.candidateMode = mode; e.candidateSince = 0;
  e.voices = Array.from({length: 15}, () => ({ oscillator: { frequency: parameter() }, gain: { gain: parameter() }, until: 0, level: 0 }));
  e.filter = { frequency: parameter() };
  return e;
}

test('the actual scheduler preserves every planned attack across tempo and text changes', () => {
  for (const initial of Object.keys(MODES)) {
    const e = engine(initial); let at = .06, count = 0, dropped = 0, maxEvents = 0;
    const note = e.note;
    e.note = function(...args) { count++; const played = note.apply(this, args); if (!played) dropped++; return played; };
    for (let i = 0; i < 16 * 64; i++) {
      e.context.currentTime = at;
      if (i % 17 === 0) e.setTarget({ ...profile, seed: i, mode: Object.keys(MODES)[Math.floor(i / 64) % 4],
        energy: i % 34 ? .95 : .02, thought: i % 34 ? .05 : .95,
        words: i % 51 ? 40 : 180, phraseSpace: i % 51 ? .25 : .8 });
      at += e.schedule(at);
      maxEvents = Math.max(maxEvents, e.stats().plannedEvents);
      assert.equal(e.plans.length, 2);
    }
    assert.ok(count > 200); assert.equal(dropped, 0); assert.ok(maxEvents <= 64);
  }
});

test('a sustained candidate survives new block IDs but a changed mode starts its own clock', () => {
  const e = engine(); let at = .06;
  for (let i = 0; i < 40; i++) {
    e.context.currentTime = at; e.setTarget({ ...profile, seed: i, mode: 'minor', valence: -.6 });
    at += e.schedule(at);
  }
  assert.equal(e.mode, 'minor'); assert.equal(e.candidateSince, .06);
  e.context.currentTime = at;
  e.setTarget({ ...profile, seed: 39, mode: 'major', valence: .6 });
  assert.equal(e.candidateSince, at);
  const until = at + 1.5;
  while (at < until) { e.context.currentTime = at; at += e.schedule(at); assert.equal(e.mode, 'minor'); }
  while (e.mode !== 'major') { e.context.currentTime = at; at += e.schedule(at); assert.ok(at < until + 7); }
});

test('weak or boundary cues leave the mode stable while continuous colour remains available', () => {
  const e = engine('minor');
  e.setTarget({ ...profile, mode: 'dorian', valence: -.11, space: .5 });
  assert.equal(e.candidateMode, 'minor'); assert.equal(e.target.space, .5);
  e.setTarget({ ...profile, mode: 'major', valence: .8, confidence: .05 });
  assert.equal(e.candidateMode, 'minor');
  e.setTarget({ ...profile, mode: 'major', valence: .8, confidence: .8 });
  assert.equal(e.candidateMode, 'major');
});

test('tempo and structural decisions stay fixed inside the current two-bar reservation', () => {
  const e = engine(); let at = .06; at += e.schedule(at);
  const plans = JSON.stringify(e.plans), beat = e.plans[0].beat;
  for (let i = 1; i < 32; i++) {
    e.context.currentTime = at; e.setTarget({ ...profile, energy: 1, thought: 0, words: 220, phraseSpace: .9 });
    at += e.schedule(at); assert.equal(JSON.stringify(e.plans), plans);
  }
  at += e.schedule(at); assert.notEqual(e.plans[0].beat, beat); assert.equal(e.plans[0].bar, 2);
});

test('all directed mode transitions have a common pivot with delayed bass', () => {
  for (const from of Object.keys(MODES)) for (const to of Object.keys(MODES)) if (from !== to) {
    for (const bar of [0, 2, 4, 6]) {
      const e = engine(from); e.step = (bar + 2) * 16;
      e.context.currentTime = 10; e.setTarget({ ...profile, mode: to,
        valence: to === 'minor' ? -.6 : to === 'dorian' ? 0 : .6, space: to === 'lydian' ? .8 : .22 });
      e.schedule(11.6);
      assert.equal(e.mode, to);
      assert.deepEqual(e.plans[0].chord, [48, 55, 60]);
      assert.ok(e.plans[0].events.every(event => event.role === 'bass' && event.step >= 8 && event.pitch === 36));
    }
  }
});

test('unchanged pads continue, and changed frequencies are scheduled inside a zero-gain hold', () => {
  const e = engine(); e.pads(0, [48, 51, 55]);
  const count = e.voices.slice(0, 3).map(v => v.oscillator.frequency.events.length);
  e.pads(3, [48, 51, 55]);
  assert.deepEqual(e.voices.slice(0, 3).map(v => v.oscillator.frequency.events.length), count);
  e.pads(4, [53, 57, 60]);
  for (const voice of e.voices.slice(0, 3)) {
    const changes = voice.oscillator.frequency.events.filter(event => event[0] === 'set');
    for (const [, , at] of changes.filter(event => event[2] > 4)) assert.equal(e.padLevel(voice, at), 0);
  }
});

test('stable sound does not enqueue a fresh filter target on every scheduler step', () => {
  const e = engine(); let at = .06;
  for (let i = 0; i < 16 * 32; i++) at += e.schedule(at);
  assert.equal(e.filter.frequency.events.filter(event => event[0] === 'target').length, 1);
});
