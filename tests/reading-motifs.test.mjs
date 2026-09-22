import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTheme, developTheme } from '../reader-motif-grammar.mjs';

const profile = { energy: .45, space: .4, thought: .3, valence: .2, confidence: .8, sectionProgress: .5, phraseSpace: .3 };
const fingerprint = theme => JSON.stringify([theme.degrees, theme.rhythm]);

function assertMelodicBounds(theme) {
  assert.equal(theme.degrees.length, 8);
  assert.equal(theme.rhythm.length, 8);
  assert.ok(theme.degrees.every(degree => Number.isInteger(degree) && degree >= 0 && degree <= 9));
  assert.ok(theme.rhythm.every(weight => Number.isInteger(weight) && weight >= 1 && weight <= 4));
  const intervals = theme.degrees.slice(1).map((degree, index) => Math.abs(degree - theme.degrees[index]));
  assert.ok(intervals.every(interval => interval <= 3), 'one melodic gesture must not contain an uncontrolled leap');
  assert.ok(intervals.filter(interval => interval <= 1).length >= 5, 'the majority of the gesture must move by a step or repetition');
}

test('one hundred document seeds create a broad set of melodic and rhythmic identities', () => {
  const degrees = new Set(), themes = new Set(), rhythms = new Set();
  for (let documentSeed = 0; documentSeed < 100; documentSeed++) {
    const theme = generateTheme(documentSeed);
    assertMelodicBounds(theme);
    assert.deepEqual(theme.anchorIndices, [0, 3, 7]);
    degrees.add(theme.degrees.join(','));
    rhythms.add(theme.rhythm.join(','));
    themes.add(fingerprint(theme));
  }
  assert.ok(degrees.size >= 90, `${degrees.size} distinct pitch gestures is too little document identity`);
  assert.ok(rhythms.size >= 80, `${rhythms.size} rhythmic identities is too little variety`);
  assert.ok(themes.size >= 95);
});

test('section and cycle development preserve landmarks while creating substantial new contours and rhythms', () => {
  const degreeVariants = new Set(), variants = new Set(), contours = new Set(), rhythms = new Set();
  let totalDisplacement = 0;
  for (let documentSeed = 0; documentSeed < 100; documentSeed++) {
    const base = generateTheme(documentSeed);
    for (let sectionSeed = 0; sectionSeed < 4; sectionSeed++) for (let cycle = 0; cycle < 4; cycle++) {
      const variant = developTheme({ documentSeed, sectionSeed, cycle, profile });
      assertMelodicBounds(variant);
      for (const index of base.anchorIndices) assert.equal(variant.degrees[index], base.degrees[index]);
      assert.equal(variant.contour.length, 7);
      assert.ok(variant.contour.every(direction => [-1, 0, 1].includes(direction)));
      assert.ok(!base.anchorIndices.includes(variant.restIndex), 'a planned rest must not erase an identity landmark');
      assert.ok(variant.mutationCount >= 0 && variant.mutationCount <= 5);
      assert.ok([-7, 0, 7].includes(variant.registerOffset));
      assert.ok(variant.density >= .15 && variant.density <= .8);
      assert.ok(['echo', 'contrary', 'arc', 'fall'].includes(variant.answerShape));
      totalDisplacement += variant.degrees.reduce((sum, degree, index) => sum + Math.abs(degree - base.degrees[index]), 0);
      degreeVariants.add(variant.degrees.join(','));
      variants.add(fingerprint(variant));
      contours.add(variant.contour.join(','));
      rhythms.add(variant.rhythm.join(','));
    }
  }
  assert.ok(degreeVariants.size >= 1000, `${degreeVariants.size} pitch variants`);
  assert.ok(variants.size >= 1400, `${variants.size} pitch/rhythm variants`);
  assert.ok(contours.size >= 400, `${contours.size} distinct contours`);
  assert.ok(rhythms.size >= 1000, `${rhythms.size} rhythmic variants`);
  assert.ok(totalDisplacement / (1600 * 8) < 1.5, 'development must still resemble the document gesture');
});

test('cycle evolution changes pitch rather than merely assigning new identifiers', () => {
  let changedPitch = 0;
  for (let documentSeed = 0; documentSeed < 100; documentSeed++) {
    const first = developTheme({ documentSeed, sectionSeed: 12, cycle: 0 });
    const second = developTheme({ documentSeed, sectionSeed: 12, cycle: 1 });
    if (first.degrees.join(',') !== second.degrees.join(',')) changedPitch++;
  }
  assert.ok(changedPitch >= 90, `only ${changedPitch} documents evolved their pitches between phrase cycles`);
});

test('development is reproducible, input-preserving and independent of call order or mutated return values', () => {
  const input = Object.freeze({ documentSeed: 12345, sectionSeed: 678, cycle: 9001, profile: Object.freeze({ ...profile }) });
  const original = developTheme(input);
  const expected = structuredClone(original);
  for (let cycle = 0; cycle < 50; cycle++) developTheme({ documentSeed: 12, sectionSeed: 34, cycle, profile });
  assert.deepEqual(developTheme(input), expected);
  original.degrees[0] = 999;
  original.rhythm[1] = 999;
  original.anchorIndices[0] = 999;
  assert.deepEqual(developTheme(input), expected);
  assert.deepEqual(input.profile, profile);
  const base = generateTheme(12345), pristine = structuredClone(base);
  base.degrees.fill(-100);
  assert.deepEqual(generateTheme(12345), pristine);
});

test('text features affect the gesture without replacing its document landmarks', () => {
  let lighterPitchSum = 0, darkerPitchSum = 0, breathingChanges = 0;
  for (let documentSeed = 0; documentSeed < 100; documentSeed++) {
    const input = { documentSeed, sectionSeed: 93, cycle: 4 };
    const bright = developTheme({ ...input, profile: { valence: 1, confidence: 1 } });
    const dark = developTheme({ ...input, profile: { valence: -1, confidence: 1 } });
    lighterPitchSum += bright.degrees.reduce((sum, degree) => sum + degree, 0);
    darkerPitchSum += dark.degrees.reduce((sum, degree) => sum + degree, 0);
    const narrow = developTheme({ ...input, profile: { phraseSpace: .1 } });
    const spacious = developTheme({ ...input, profile: { phraseSpace: .9 } });
    assert.ok(spacious.density < narrow.density);
    if (spacious.rhythm.join(',') !== narrow.rhythm.join(',')) breathingChanges++;
    const moving = developTheme({ ...input, profile: { energy: .9 } });
    const still = developTheme({ ...input, profile: { energy: .1 } });
    assert.ok(moving.density > still.density);
    for (const index of bright.anchorIndices) assert.equal(bright.degrees[index], dark.degrees[index]);
  }
  assert.ok(lighterPitchSum > darkerPitchSum, 'the declared valence bias should affect a cohort, not just metadata');
  assert.ok(breathingChanges >= 90, 'phrase spacing should alter the rhythmic DNA as well as density');
});

test('low confidence removes emotional pitch bias and reading rest reduces density', () => {
  const input = { documentSeed: 29, sectionSeed: 67, cycle: 12 };
  assert.deepEqual(
    developTheme({ ...input, profile: { valence: 1, confidence: 0 } }),
    developTheme({ ...input, profile: { valence: -1, confidence: 0 } })
  );
  const ordinary = developTheme({ ...input, profile });
  const rest = developTheme({ ...input, profile: { ...profile, readingRest: true } });
  assert.ok(rest.density < ordinary.density);
  assert.deepEqual(rest.degrees, ordinary.degrees);
});

test('large cycle indices and incomplete profiles remain finite and bounded', () => {
  for (const cycle of [0, 1, 1000000, 2 ** 32, Number.MAX_SAFE_INTEGER]) {
    const theme = developTheme({ documentSeed: 0xffffffff, sectionSeed: 0, cycle, profile: { energy: NaN, space: Infinity, valence: -Infinity } });
    assertMelodicBounds(theme);
    assert.ok(Number.isFinite(theme.density));
    assert.ok(Number.isInteger(theme.signature));
  }
  assertMelodicBounds(generateTheme());
  assertMelodicBounds(developTheme());
});


test('the opening cell retains document identity through section and cycle changes without shared mutable arrays', () => {
  for (let documentSeed = 0; documentSeed < 32; documentSeed++) {
    const base = generateTheme(documentSeed);
    const expectedDegrees = base.degrees.slice(0, 3), expectedRhythm = base.rhythm.slice(0, 3);
    for (const sectionSeed of [0, 13, 98]) for (const cycle of [0, 1, 10, 1000000]) {
      const input = { documentSeed, sectionSeed, cycle, profile };
      const variant = developTheme(input);
      assert.deepEqual(variant.openingDegrees, expectedDegrees);
      assert.deepEqual(variant.openingRhythm, expectedRhythm);
      assert.notEqual(variant.openingDegrees, variant.degrees);
      assert.notEqual(variant.openingRhythm, variant.rhythm);
      const degrees = [...variant.degrees], rhythm = [...variant.rhythm];
      variant.openingDegrees[0] = 999;
      variant.openingRhythm[0] = 999;
      assert.deepEqual(variant.degrees, degrees);
      assert.deepEqual(variant.rhythm, rhythm);
      const next = developTheme(input);
      assert.deepEqual(next.openingDegrees, expectedDegrees);
      assert.deepEqual(next.openingRhythm, expectedRhythm);
    }
  }
});
