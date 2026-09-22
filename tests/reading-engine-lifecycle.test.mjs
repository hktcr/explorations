import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadingOrchestra } from '../reader-soundscape.mjs';

const profile = { mode: 'dorian', tonic: 48, seed: 11, motifSeed: 99, words: 40, valence: 0, energy: .3, space: .3, thought: .3 };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function context({ resumeGate, closeGate, closeError, throwClose = false } = {}) {
  return {
    state: 'suspended', currentTime: 0, closes: 0, stopped: 0, disconnected: 0,
    closeGate, closeError, throwClose,
    resume() {
      return Promise.resolve(resumeGate?.promise).then(() => { if (this.state !== 'closed') this.state = 'running'; });
    },
    close() {
      this.closes++;
      if (this.throwClose) throw this.closeError || new Error('synchronous close failure');
      if (this.closeError) return Promise.reject(this.closeError);
      return Promise.resolve(this.closeGate?.promise).then(() => { this.state = 'closed'; });
    }
  };
}

function engineFor(t, contexts) {
  let allocated = 0;
  const engine = new ReadingOrchestra(() => {
    assert.ok(allocated < contexts.length, 'no unplanned AudioContext allocation');
    return contexts[allocated++];
  });
  // Exercise the real start/stop ownership with a tiny observable graph; graph
  // construction, scoring and native Web Audio remain separate integration tests.
  engine.buildGraph = function () {
    const ctx = this.context;
    this.master = { gain: { cancelAndHoldAtTime() {}, setTargetAtTime() {} } };
    this.voices.push({ oscillator: { stop() { ctx.stopped++; } } });
    this.nodes.push({ disconnect() { ctx.disconnected++; } });
    this.plans = [{ events: [{ pitch: 60 }] }];
  };
  engine.tick = () => {};
  t.after(async () => {
    const ctx = engine.context;
    if (ctx) { ctx.closeError = null; ctx.throwClose = false; ctx.closeGate?.resolve(); ctx.closeGate = null; }
    await engine.stop(true);
  });
  return { engine, allocations: () => allocated };
}

for (const outcome of ['resolve', 'reject']) test(`old resume ${outcome} after a new session leaves its graph and scheduler untouched`, async t => {
  const oldResume = deferred(), first = context({ resumeGate: oldResume }), second = context();
  const { engine, allocations } = engineFor(t, [first, second]);
  const oldStart = engine.start(profile);
  await engine.stop(true);
  assert.equal(await engine.start(profile), true);
  const newTimer = engine.timer, newMaster = engine.master;
  if (outcome === 'resolve') oldResume.resolve(); else oldResume.reject(new Error('old resume rejected'));
  assert.equal(await oldStart, false);
  assert.equal(engine.context, second); assert.equal(engine.timer, newTimer); assert.equal(engine.master, newMaster);
  assert.equal(second.closes, 0); assert.equal(second.stopped, 0); assert.equal(second.disconnected, 0);
  assert.equal(engine.stats().schedulers, 1); assert.equal(engine.stats().sources, 1); assert.equal(allocations(), 2);
});

test('delayed close retains context ownership, blocks allocation, and releases the graph immediately', async t => {
  const closing = deferred(), first = context({ closeGate: closing }), second = context();
  const { engine, allocations } = engineFor(t, [first, second]);
  await engine.start(profile);
  const stop = engine.stop(true), repeated = engine.stop(true);
  assert.equal(first.closes, 1, 'close is invoked synchronously and only once');
  assert.equal(first.stopped, 1); assert.equal(first.disconnected, 1);
  assert.equal(engine.stats().sources, 0); assert.equal(engine.stats().nodes, 0); assert.equal(engine.stats().plannedEvents, 0);
  assert.equal(engine.stats().schedulers, 0); assert.equal(engine.stats().contexts, 1); assert.equal(engine.stats().closing, true);
  assert.doesNotThrow(() => engine.setTarget({ ...profile, mode: 'minor' }));
  assert.equal(engine.target, null, 'a late target must not repopulate a closing session');
  assert.equal(await engine.start(profile), false); assert.equal(allocations(), 1);
  closing.resolve(); await Promise.all([stop, repeated]);
  assert.equal(engine.stats().contexts, 0); assert.equal(engine.stats().closing, false);
  assert.equal(await engine.start(profile), true); assert.equal(allocations(), 2);
});

for (const synchronous of [false, true]) test(`${synchronous ? 'synchronous throw' : 'rejected promise'} from close retains the silent context and blocks another allocation`, async t => {
  const first = context({ closeError: new Error('close failed'), throwClose: synchronous }), second = context();
  const { engine, allocations } = engineFor(t, [first, second]);
  await engine.start(profile);
  await assert.doesNotReject(engine.stop(true));
  assert.equal(engine.context, first); assert.equal(engine.stats().contexts, 1); assert.equal(engine.stats().closeFailed, true);
  assert.equal(engine.stats().closing, false); assert.equal(engine.stats().schedulers, 0);
  assert.equal(engine.stats().sources, 0); assert.equal(engine.stats().nodes, 0); assert.equal(engine.stats().plannedEvents, 0);
  assert.equal(first.stopped, 1); assert.equal(first.disconnected, 1);
  assert.doesNotThrow(() => engine.setTarget({ ...profile, mode: 'minor' }));
  assert.equal(engine.target, null, 'a failed close must not accept new musical targets');
  assert.equal(await engine.start(profile), false); assert.equal(allocations(), 1);
  // A later explicit close retry may release ownership; it never allocates.
  first.closeError = null; first.throwClose = false;
  await engine.stop(true);
  assert.equal(first.closes, 2); assert.equal(engine.stats().closeFailed, false); assert.equal(engine.stats().contexts, 0);
  assert.equal(await engine.start(profile), true); assert.equal(allocations(), 2);
});

test('immediate stop accelerates an existing fade and cancels its old timeout before restart', async t => {
  const first = context(), second = context();
  const { engine } = engineFor(t, [first, second]);
  await engine.start(profile);
  const fade = engine.stop();
  assert.notEqual(engine.shutdownTimer, null); assert.equal(first.closes, 0);
  const immediate = engine.stop(true);
  assert.equal(first.closes, 1); assert.equal(engine.shutdownTimer, null); assert.equal(engine.finishStop, null);
  await Promise.all([fade, immediate]);
  assert.equal(first.stopped, 1); assert.equal(first.disconnected, 1);
  assert.equal(await engine.start(profile), true);
  assert.equal(engine.context, second); assert.equal(second.closes, 0); assert.equal(engine.shutdownTimer, null);
});

test('a close rejection after the context is already closed is not retained as a false blocker', async t => {
  const first = context();
  first.close = function () { this.closes++; this.state = 'closed'; return Promise.reject(new Error('already closed')); };
  const { engine } = engineFor(t, [first]); await engine.start(profile);
  await engine.stop(true);
  assert.equal(engine.stats().contexts, 0); assert.equal(engine.stats().closeFailed, false); assert.equal(engine.stats().closing, false);
});

test('an owned resume failure cleans its own graph and reports the original error', async t => {
  const resume = deferred(), first = context({ resumeGate: resume }), { engine } = engineFor(t, [first]);
  const started = engine.start(profile), originalError = new Error('permission interrupted');
  resume.reject(originalError);
  await assert.rejects(started, error => error === originalError);
  assert.equal(first.closes, 1); assert.equal(first.stopped, 1); assert.equal(first.disconnected, 1);
  assert.equal(engine.stats().contexts, 0); assert.equal(engine.stats().schedulers, 0);
});
