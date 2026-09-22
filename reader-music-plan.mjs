/* A small score, not an audio graph. Two bars are planned at a time. */
import { MODES } from './reader-score-analysis.mjs?v=20260922-focus-score-2';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const MOTIFS = [[0, 2, 4], [0, 4, 2], [2, 1, 0], [4, 2, 0]];
const PROGRESSION = [0, 0, 5, 5, 3, 4, 4, 0];

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
  const phase = ((bar % 8) + 8) % 8;
  const degree = PROGRESSION[phase];
  const chord = pivot ? [tonic, tonic + 7, tonic + 12] : chordPitches(tonic, mode, degree);
  const events = [];
  const add = (step, voice, pitch, duration, level, attack, role) => events.push({ step, voice, pitch, duration, level, attack, role });
  // A pivot starts on the common tonic; the new bass waits for the old pad release.
  const bass = pivot ? tonic - 12 : scaleTone(tonic, mode, degree) - 12;
  for (const step of pivot ? [8] : [4, 10]) add(step, 3, bass, beat * 1.25, .105, .045, 'bass');
  if (pivot) return { bar, beat, chord, events };

  const energy = clamp(profile.energy ?? .32, 0, 1);
  const air = clamp(profile.phraseSpace ?? .25, 0, 1);
  const sparse = air > .52 || profile.words > 100 || profile.readingRest;
  const answering = phase % 2 === 1;
  const rhythm = answering ? (sparse ? [0] : [0, 4]) : (sparse ? [0, 6] : [0, 4, 8]);
  const motif = MOTIFS[(motifSeed >>> 0) % MOTIFS.length];
  let lastPitch = tonic + 12;
  rhythm.forEach((step, i) => {
    // A / A' / B / A'': retain the contour, vary one arrival in the middle.
    let melodicDegree = motif[i % 3] + 7;
    if (phase === 4 || phase === 5) melodicDegree += i === rhythm.length - 1 ? 1 : 0;
    if (phase >= 6 && i === rhythm.length - 1) melodicDegree = 7 + (profile.cadence >= .5 ? 0 : 4);
    let pitch = scaleTone(tonic, mode, melodicDegree);
    if (i === 0 || i === rhythm.length - 1) pitch = nearChord(pitch, chord, tonic + 10, tonic + 24);
    lastPitch = pitch;
    add(step, 4 + i % 2, pitch, beat * (sparse ? 1.5 : 1.15), .06 + energy * .024, .018, 'pluck');
  });
  if (answering) {
    // Reply to the lead's last actual pitch. The lead is silent for the reply.
    const direction = motif[2] >= motif[0] ? -2 : 2;
    const reply = nearChord(lastPitch + direction, chord, tonic + 10, tonic + 24);
    const landing = phase === 7 ? tonic + (profile.cadence >= .5 ? 12 : 19) : nearChord(reply - 2, chord, tonic + 10, tonic + 24);
    add(9, 6, reply, beat * .75, .036, Math.min(.18, beat * .3), 'flute');
    add(13, 7, landing, beat * .6, .03, Math.min(.16, beat * .25), 'flute');
  }
  // One optional, quiet structural accent per whole phrase, on a shared tone.
  if (phase === 7 && profile.cadence >= .65 && !profile.readingRest) add(14, 8, tonic + 24, beat * 1.5, .022, .025, 'bell');
  if (energy > .55 && !sparse && !answering) add(0, 10, bass - 12, .18, .034, .015, 'pulse');
  events.sort((a, b) => a.step - b.step || a.voice - b.voice);
  return { bar, beat, chord, events };
}
