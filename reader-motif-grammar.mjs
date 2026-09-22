/* Bounded, deterministic melodic grammar. No audio nodes, text retention or history.
 * Eight scale degrees form a document identity; three landmarks survive development.
 * Rhythm values are relative duration weights, never unsafe scheduler timestamps.
 */
const LENGTH = 8;
const LOW = 0, HIGH = 9, MAX_LEAPS = 2;
const ANCHORS = Object.freeze([0, 3, 7]);
const FREE = Object.freeze([1, 2, 4, 5, 6]);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const unit = (value, fallback) => Number.isFinite(value) ? clamp(value, 0, 1) : fallback;

function hash(...parts) {
  let result = 2166136261;
  for (const part of parts) {
    const token = `${typeof part}:${String(part).slice(0, 128)};`;
    for (let i = 0; i < token.length; i++) result = Math.imul(result ^ token.charCodeAt(i), 16777619);
  }
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb352d);
  result ^= result >>> 15;
  result = Math.imul(result, 0x846ca68b);
  return (result ^ (result >>> 16)) >>> 0;
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// The small feasibility table has 8 * 10 * 3 cells and is discarded on return.
// It guarantees that weighted choices can still reach every fixed landmark,
// with no jump larger than three degrees and at least five stepwise/repeated moves.
function melodicPath(landmarks, preferred, rng) {
  const memo = new Uint8Array(LENGTH * (HIGH + 1) * (MAX_LEAPS + 1));
  const allowed = (index, previous) => landmarks[index] == null
    ? Array.from({ length: Math.min(HIGH, previous + 3) - Math.max(LOW, previous - 3) + 1 }, (_, i) => Math.max(LOW, previous - 3) + i)
    : [landmarks[index]];
  const possible = (index, previous, remaining) => {
    if (index === LENGTH) return true;
    const key = (index * (HIGH + 1) + previous) * (MAX_LEAPS + 1) + remaining;
    if (memo[key]) return memo[key] === 2;
    const result = allowed(index, previous).some(next => {
      const distance = Math.abs(next - previous), cost = Number(distance > 1);
      return distance <= 3 && cost <= remaining && possible(index + 1, next, remaining - cost);
    });
    memo[key] = result ? 2 : 1;
    return result;
  };
  const degrees = [landmarks[0]];
  let remaining = MAX_LEAPS;
  for (let index = 1; index < LENGTH; index++) {
    const previous = degrees[index - 1];
    const candidates = allowed(index, previous).filter(next => {
      const distance = Math.abs(next - previous), cost = Number(distance > 1);
      return distance <= 3 && cost <= remaining && possible(index + 1, next, remaining - cost);
    });
    // Generated landmarks always admit a route. Fail explicitly if a future
    // grammar change violates this invariant, rather than emitting a wild jump.
    if (!candidates.length) throw new Error('Melodic landmarks cannot be connected');
    const weights = candidates.map(next => {
      const distance = Math.abs(next - previous);
      const movement = distance === 1 ? 3 : distance === 0 ? 1.35 : .5;
      return movement * Math.exp(-Math.abs(next - preferred[index]) * .7);
    });
    let draw = rng() * weights.reduce((sum, weight) => sum + weight, 0);
    let chosen = candidates.at(-1);
    for (let i = 0; i < candidates.length; i++) {
      draw -= weights[i];
      if (draw <= 0) { chosen = candidates[i]; break; }
    }
    remaining -= Number(Math.abs(chosen - previous) > 1);
    degrees.push(chosen);
  }
  return degrees;
}

const contourOf = degrees => degrees.slice(1).map((degree, i) => Math.sign(degree - degrees[i]));
const signatureOf = (degrees, rhythm) => hash('melodic-content-v1', ...degrees, ...rhythm);

export function generateTheme(documentSeed = 0) {
  const rng = random(hash('document-theme-v1', documentSeed));
  const beginning = Math.floor(rng() * 3) * 2;
  const direction = rng() < .5 ? -1 : 1;
  const middle = clamp(beginning + direction * (2 + Math.floor(rng() * 2)), LOW, 7);
  const ending = Math.floor(rng() * 3) * 2;
  const landmarks = { 0: beginning, 3: middle, 7: ending };
  const preferred = Array.from({ length: LENGTH }, (_, index) => {
    const left = index <= 3 ? 0 : 3, right = index <= 3 ? 3 : 7;
    const progress = (index - left) / (right - left);
    return landmarks[left] + (landmarks[right] - landmarks[left]) * progress + (rng() - .5) * 2;
  });
  const degrees = melodicPath(landmarks, preferred, rng);
  const rhythm = Array.from({ length: LENGTH }, (_, index) => {
    const value = rng();
    return ANCHORS.includes(index) ? 2 + Math.floor(value * 3) : 1 + Math.floor(value * 3);
  });
  return { degrees, anchorIndices: [...ANCHORS], rhythm, signature: signatureOf(degrees, rhythm) };
}

export function developTheme({ documentSeed = 0, sectionSeed = 0, cycle = 0, profile = {} } = {}) {
  const theme = generateTheme(documentSeed);
  const stableCycle = Number.isFinite(cycle) ? Math.max(0, Math.floor(cycle)) : 0;
  const sectionRng = random(hash('section-development-v1', documentSeed, sectionSeed));
  const rng = random(hash('phrase-development-v1', documentSeed, sectionSeed, stableCycle));
  const energy = unit(profile.energy, .32), space = unit(profile.space, .22);
  const thought = unit(profile.thought, .3), air = unit(profile.phraseSpace, .25);
  const confidence = unit(profile.confidence, .5), progress = unit(profile.sectionProgress, .5);
  const valence = Number.isFinite(profile.valence) ? clamp(profile.valence, -1, 1) * confidence : 0;
  const landmarks = Object.fromEntries(ANCHORS.map(index => [index, theme.degrees[index]]));
  const preferred = theme.degrees.map((degree, index) => {
    const sectionColour = (sectionRng() - .5) * 3;
    const development = (rng() - .5) * (1 + energy * 2);
    const arc = Math.sin(index / (LENGTH - 1) * Math.PI);
    const textDirection = valence * .9 + (energy - thought) * .65;
    return clamp(degree + sectionColour + development + arc * textDirection - progress * index / 7 * .6, LOW, HIGH);
  });
  const degrees = melodicPath(landmarks, preferred, rng);
  const rhythm = theme.rhythm.map((weight, index) => {
    const texture = rng() < .45 ? -1 : rng() < .65 ? 0 : 1;
    const breathing = Number(air + thought * .25 > .62) + Number(index === 7 && progress > .72);
    return clamp(weight + texture + breathing - Number(energy > .72 && !ANCHORS.includes(index)), 1, 4);
  });
  const density = profile.readingRest ? .15 : clamp(.34 + energy * .42 - air * .24 - thought * .16 + (1 - progress) * .06, .15, .8);
  const answerShapes = ['echo', 'contrary', 'arc', 'fall'];
  const answerShape = answerShapes[(Math.floor(rng() * 4) + Number(thought > .6) + Number(valence > .3)) % 4];
  // Register is a suggestion to the caller's bounded voice-leading, not an
  // instruction to jump an octave at the next attack. Keep its side document-stable.
  const registerOffset = space > .62 && energy > .45 ? (hash('register-side', documentSeed) % 2 ? 7 : -7) : 0;
  const restIndex = progress > .8 ? 6 : FREE[Math.floor(rng() * FREE.length)];
  return {
    degrees, anchorIndices: [...ANCHORS], rhythm, contour: contourOf(degrees),
    openingDegrees: theme.degrees.slice(0, 3), openingRhythm: theme.rhythm.slice(0, 3),
    registerOffset, density, answerShape, restIndex,
    mutationCount: degrees.filter((degree, index) => degree !== theme.degrees[index]).length,
    signature: signatureOf(degrees, rhythm)
  };
}
