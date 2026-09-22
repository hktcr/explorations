import test from 'node:test';
import assert from 'node:assert/strict';
import { describeText, modeFor, blendProfiles, readingFraction, ReadingOrchestra } from '../reader-soundscape.mjs';

test('contrasting texts have contrasting musical profiles and negation is bounded', () => {
  const sombre = describeText('War, death, grief and suffering. Loss and fear spread through the night.');
  const hopeful = describeText('Hope, joy and healing. Recovery, care and compassion bring freedom and love.');
  assert.equal(modeFor(sombre), 'minor');
  assert.equal(modeFor(hopeful), 'major');
  assert.ok(describeText('not a threat').valence > describeText('a threat').valence);
  assert.ok(blendProfiles(sombre, hopeful, .1).valence < 0);
  assert.ok(describeText('Evidence, analysis, research and questions?').thought > describeText('one quiet sentence').thought);
});

test('reading progress excludes material beyond the article and handles short pages', () => {
  assert.equal(readingFraction(300, 3000, 800, 0), 0);
  assert.equal(readingFraction(300, 3000, 800, 2228), 1);
  assert.equal(readingFraction(100, 400, 800, 0), 1);
  assert.equal(readingFraction(1200, 1400, 800, 0), 0);
  assert.ok(readingFraction(300, 3000, 800, 1200) > .4);
});

test('stopping during an unresolved audio start cannot resurrect a scheduler', async () => {
  let resume, closes = 0;
  const context = { currentTime: 0, state: 'suspended', resume: () => new Promise(resolve => { resume = resolve; }), close: async () => { closes++; context.state = 'closed'; } };
  const engine = new ReadingOrchestra(() => context);
  engine.buildGraph = () => {};
  const pending = engine.start({ ...describeText('Quiet'), tonic: 48, mode: 'dorian' });
  await engine.stop(true); resume();
  assert.equal(await pending, false);
  assert.equal(engine.stats().contexts, 0); assert.equal(engine.stats().schedulers, 0);
  assert.equal(closes, 1);
});

test('repeated stop closes the context once and refuses restart during close', async () => {
  let finish, closes = 0;
  const context = { currentTime: 0, state: 'suspended', close: () => { closes++; return new Promise(resolve => { finish = resolve; }); } };
  const engine = new ReadingOrchestra(() => { throw new Error('must not allocate'); });
  engine.context = context;
  const first = engine.stop(true), second = engine.stop(true);
  assert.equal(await engine.start({}), false);
  finish(); await Promise.all([first, second]);
  assert.equal(closes, 1); assert.equal(engine.stats().contexts, 0);
});
