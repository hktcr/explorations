/* A small score, not an audio graph. Two bars are planned at a time. */
import { MODES } from './reader-score-analysis.mjs?v=20260922-focus-score-3';
import { developTheme } from './reader-motif-grammar.mjs?v=20260922-focus-score-3';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mixSeed = value => {
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  return (value ^ value >>> 16) >>> 0;
};
const stepTime = (step, beat) => (Math.floor(step / 2) * .5 + (step % 2 ? .26 : 0)) * beat;
const choose = (items, seed) => items[(seed >>> 0) % items.length];

export function scaleTone(tonic, mode, degree) {
  const scale = MODES[mode] || MODES.dorian;
  return tonic + scale[((degree % 7) + 7) % 7] + 12 * Math.floor(degree / 7);
}

export function chordPitches(tonic, mode, chordDegree) {
  return [0, 2, 4].map(offset => scaleTone(tonic, mode, chordDegree + offset));
}

// Search three inversions in a bounded register. Common pitches have zero cost.
export function voiceLeading(previous, pitches) {
  if (!previous?.length) return [...pitches];
  const classes = pitches.map(p => ((p % 12) + 12) % 12);
  if (previous.every(p => classes.includes(((p % 12) + 12) % 12)) && new Set(previous.map(p => p % 12)).size === 3) return [...previous];
  let best = [...pitches], bestCost = Infinity;
  const centre = previous.reduce((a, b) => a + b, 0) / 3;
  for (let inversion = 0; inversion < 3; inversion++) {
    const rotated = pitches.slice(inversion).concat(pitches.slice(0, inversion).map(p => p + 12));
    for (let octave = -2; octave <= 1; octave++) {
      const notes = rotated.map(p => p + octave * 12);
      if (notes[0] < 36 || notes[2] > 79) continue;
      const cost = notes.reduce((sum, p, i) => sum + Math.abs(p - previous[i]), 0)
        + Math.abs(notes.reduce((a, b) => a + b, 0) / 3 - centre) * .1;
      if (cost < bestCost) { bestCost = cost; best = notes; }
    }
  }
  return best;
}

const nearChord = (pitch, chord, min = 60, max = 88) => {
  let best = pitch, distance = Infinity;
  for (const tone of chord) for (let octave = -1; octave <= 3; octave++) {
    const candidate = tone + 12 * octave;
    if (candidate < min || candidate > max) continue;
    if (Math.abs(candidate - pitch) < distance) { distance = Math.abs(candidate - pitch); best = candidate; }
  }
  return best;
};

export function planBar({ bar, beat, tonic, mode, motifSeed = 0, profile = {}, pivot = false }) {
  const phase = ((bar % 8) + 8) % 8, cycle = Math.floor(bar / 8);
  const sectionSeed = profile.sectionSeed ?? motifSeed;
  const stamp = mixSeed((motifSeed >>> 0) ^ Math.imul(sectionSeed >>> 0, 0x9e3779b1) ^ Math.imul(cycle + 1, 0x85ebca6b));
  const theme = developTheme({ documentSeed: motifSeed, sectionSeed, cycle, profile });
  const energy = clamp(profile.energy ?? .32, 0, 1);
  const air = clamp(profile.phraseSpace ?? .25, 0, 1);
  const thought = clamp(profile.thought ?? .3, 0, 1);
  const valence = (profile.valence || 0) * clamp(profile.confidence ?? .5, 0, 1);
  // Functional destinations, with related routes selected by document/section
  // and phrase cycle. Every chord is still derived from the active mode.
  const progression = [0, choose([0, 0, 5], stamp), choose([3, 5, 1], stamp >>> 3),
    choose(thought > .55 ? [1, 3, 5] : [3, 5, 0], stamp >>> 6),
    choose(valence < -.2 ? [5, 3, 1] : [3, 1, 5], stamp >>> 9),
    choose(energy > .55 ? [4, 4, 1] : [3, 4, 5], stamp >>> 12),
    choose([4, 3, 4], stamp >>> 15), 0];
  const degree = progression[phase];
  const chord = pivot ? [tonic, tonic + 7, tonic + 12] : chordPitches(tonic, mode, degree);
  const events = [];
  const add = (step, voice, pitch, duration, level, attack, role) => events.push({ step, voice, pitch, duration, level, attack, role });
  const bass = pivot ? tonic - 12 : scaleTone(tonic, mode, degree) - 12;
  const bassSteps = pivot ? [8] : air > .65 ? [4] : choose([[4, 10], [4, 11]], stamp + phase);
  for (const step of bassSteps) add(step, 3, bass, beat * 1.25, .09 + energy * .025, .045, 'bass');
  if (pivot) return { bar, beat, chord, events };

  const sparse = air > .58 || theme.density < .3 || profile.readingRest;
  const answering = phase % 2 === 1;
  const rhythmSeed = mixSeed(stamp ^ Math.imul(phase + 1, 0x27d4eb2d) ^ theme.rhythm[phase]);
  const opening = phase === 0;
  const rhythm = opening ? [0, 4, 8] : answering
    ? (sparse ? [0] : choose([[0, 4], [0, 5]], rhythmSeed))
    : (sparse ? choose([[0, 6], [0, 8]], rhythmSeed) : choose([[0, 4, 8], [0, 5, 9], [0, 6, 10]], rhythmSeed));
  const registerShift = Math.sign(theme.registerOffset) * 2;
  let lastPitch = tonic + 12, leadEnd = 0;
  rhythm.forEach((step, i) => {
    // Unfold all eight theme degrees across the phrase; three document anchors
    // survive section and cycle development inside the generator.
    const index = (phase * 2 + i) % theme.degrees.length;
    let melodicDegree = opening ? theme.openingDegrees[i] + 7 : clamp(theme.degrees[index] + 7 + registerShift, 5, 16);
    if (phase === 7 && i === rhythm.length - 1) melodicDegree = profile.cadence >= .5 ? 7 : 11;
    let pitch = scaleTone(tonic, mode, melodicDegree);
    // Present the document's opening cell before adapting its final arrival.
    // This keeps the audible identity intact through chord projection elsewhere.
    if ((!opening && i === 0) || i === rhythm.length - 1) pitch = nearChord(pitch, chord, tonic + 8, tonic + 28);
    // Intentional late ornaments may rest, while the first and last anchors remain.
    if (!opening && i > 0 && i < rhythm.length - 1 && index === theme.restIndex) return;
    const weight = opening ? theme.openingRhythm[i] : theme.rhythm[index];
    const duration = beat * (sparse ? 1.25 + weight * .06 : .72 + weight * .1);
    lastPitch = pitch;
    leadEnd = Math.max(leadEnd, stepTime(step, beat) + duration);
    add(step, 4 + i % 2, pitch, duration, .052 + energy * .03 + (i === 0 ? .004 : 0), .018, 'pluck');
  });
  if (answering) {
    const motion = theme.contour[(phase * 2 + 1) % theme.contour.length] || 1;
    const direction = theme.answerShape === 'echo' ? 0 : theme.answerShape === 'contrary' ? -motion * 2 : theme.answerShape === 'arc' ? 2 : -2;
    const reply = nearChord(lastPitch + direction, chord, tonic + 8, tonic + 28);
    const landing = phase === 7 ? tonic + (profile.cadence >= .5 ? 12 : 19)
      : nearChord(reply + (theme.answerShape === 'arc' ? -2 : direction), chord, tonic + 8, tonic + 28);
    const firstStep = [9, 10, 11].find(step => step >= 9 + rhythmSeed % 3 && stepTime(step, beat) >= leadEnd + beat * .08) ?? 11;
    const duration = Math.min(beat * .8, stepTime(13, beat) - stepTime(firstStep, beat) - beat * .14);
    if (!sparse || phase === 3 || phase === 7) add(firstStep, 6, reply, duration, .029 + energy * .009, Math.min(.15, duration * .4), 'flute');
    add(13, 7, landing, beat * (.5 + theme.rhythm[phase] * .03), .027 + (profile.space ?? .22) * .007, .11, 'flute');
  }
  // The bell marks occasional structural arrivals; it does not narrate every paragraph.
  if ((phase === 7 && profile.cadence >= .65 || phase === 3 && profile.role === 'quote') && !profile.readingRest && (stamp % 3 !== 0)) {
    add(14, 8 + cycle % 2, tonic + (profile.space > .6 ? 31 : 24), beat * 1.3, .019 + energy * .008, .025, 'bell');
  }
  if (energy > .55 && !sparse && !answering && (stamp + phase) % 3) add(0, 10, bass - 12, .18, .032, .015, 'pulse');
  events.sort((a, b) => a.step - b.step || a.voice - b.voice);
  return { bar, beat, chord, events };
}
