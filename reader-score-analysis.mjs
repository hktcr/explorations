/* Bounded, local musical cues. These heuristics do not infer an author's feelings.
 * Profiles retain numbers and DOM anchors only; no source text or token history.
 */
export const MODES = Object.freeze({
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11]
});
export const MODE_LABELS = { major: 'dur', minor: 'moll', dorian: 'dorisk', lydian: 'lydisk' };
export const MAX_BLOCKS = 1600;
export const MAX_CHARACTERS = 600000;
const MAX_BLOCK_CHARACTERS = 16000;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const dictionary = entries => new Set(entries.split(' '));
const keys = ['valence', 'energy', 'space', 'thought', 'confidence', 'phraseSpace'];
const lexicon = {
  light: dictionary('hope hopeful joy love care trust possibility possibilities discovery discover beauty beautiful recovery recover freedom success resilient wonder creative creativity connection healing compassion hopp glädje kärlek omsorg tillit möjlighet upptäckt skönhet återhämtning frihet läkning gemenskap'),
  dark: dictionary('loss grief death dying violence war failure failed fear harm harmful suffering pain abuse danger crisis threat threats attack attacks breach exploit intrusion injustice loneliness doubt sorrow förlust sorg död våld krig rädsla skada lidande smärta hot kris intrång orättvisa ensamhet'),
  motion: dictionary('urgent sudden rapidly rapid conflict change changes action struggle acceleration attack breakthrough transformation tension quickly urgency plötsligt snabbt konflikt förändring handling kamp genombrott omvandling spänning'),
  space: dictionary('ocean sea sky stars space universe silence memory memories landscape night dream dreams time distance forest nature light consciousness hav himmel stjärnor rymd universum tystnad minne landskap natt dröm tid skog natur ljus medvetande'),
  reason: dictionary('evidence research study studies analysis data method methods theory experiment results system systems model models probability however uncertainty question questions argument philosophy forskning studie analys metod teori resultat modell osäkerhet fråga argument filosofi')
};
// Explicit common forms, not stemming: scientific terms must not be truncated.
const forms = new Map([
  ['fears', 'fear'], ['feared', 'fear'], ['threatening', 'threat'], ['threatened', 'threat'],
  ['attacked', 'attack'], ['attacking', 'attack'], ['attacks', 'attack'], ['threats', 'threat'], ['losses', 'loss'], ['deaths', 'death'],
  ['hopes', 'hope'], ['hoping', 'hope'], ['loved', 'love'], ['loves', 'love'],
  ['discoveries', 'discovery'], ['discovered', 'discover'], ['failures', 'failure'],
  ['sorgen', 'sorg'], ['rädslan', 'rädsla'], ['rädslor', 'rädsla'], ['hotet', 'hot'], ['hoten', 'hot'],
  ['kriget', 'krig'], ['krigen', 'krig'], ['döden', 'död'], ['förlusten', 'förlust'], ['förluster', 'förlust'],
  ['smärtan', 'smärta'], ['lidandet', 'lidande'], ['hoppet', 'hopp'], ['glädjen', 'glädje'],
  ['kärleken', 'kärlek'], ['omsorgen', 'omsorg'], ['möjligheter', 'möjlighet'], ['upptäckter', 'upptäckt'],
  ['frågor', 'fråga'], ['frågan', 'fråga'], ['forskningen', 'forskning'], ['studier', 'studie'],
  ['förändringar', 'förändring'], ['minnen', 'minne'], ['drömmar', 'dröm']
]);
const negations = dictionary("not no never without neither cannot can't don't doesn't didn't won't inte ingen aldrig utan inga inget");

export function fingerprint(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function describeText(value) {
  const text = String(value || '').slice(0, MAX_BLOCK_CHARACTERS);
  const counts = { light: 0, dark: 0, motion: 0, space: 0, reason: 0 };
  let wordCount = 0, sentenceCount = 0, effectiveHits = 0;
  // A negation may attenuate a cue in its own clause; it never reverses its sign.
  // Sentence/semicolon boundaries survive tokenisation, and 'not only' is additive.
  for (const sentence of text.toLowerCase().match(/[^.!?;\n]+/gu) || []) {
    const tokens = (sentence.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) || []).map(t => t.replaceAll('’', "'"));
    if (!tokens.length) continue;
    sentenceCount++; wordCount += tokens.length;
    let lastNegation = -4;
    tokens.forEach((token, i) => {
      const additive = (token === 'not' && tokens[i + 1] === 'only') || (token === 'inte' && tokens[i + 1] === 'bara');
      if (negations.has(token) && !additive) lastNegation = i;
      const word = forms.get(token) || token;
      const amount = i > lastNegation && i - lastNegation <= 3 ? .2 : 1;
      let hit = false;
      for (const key of Object.keys(counts)) if (lexicon[key].has(word)) { counts[key] += amount; hit = true; }
      if (hit) effectiveHits += amount;
    });
  }
  const mass = Math.max(3, Math.sqrt(wordCount) * .65);
  return {
    valence: clamp((counts.light - counts.dark) / mass, -1, 1),
    energy: clamp(.32 + counts.motion / mass * .3 + Math.min(3, (text.match(/!/g) || []).length) * .035),
    space: clamp(.22 + counts.space / mass * .45),
    thought: clamp(.3 + counts.reason / mass * .45 + Math.min(4, (text.match(/\?/g) || []).length) * .04),
    // Cue support, not a calibrated probability of semantic correctness.
    confidence: clamp(effectiveHits / Math.max(3, Math.sqrt(wordCount) * .8)),
    phraseSpace: clamp(.18 + Math.min(1, wordCount / 120) * .34 + Math.min(1, wordCount / Math.max(1, sentenceCount) / 35) * .24),
    cadence: 0, words: wordCount, seed: fingerprint(text)
  };
}

export function modeFor(profile) {
  if (profile.valence < -.13) return 'minor';
  if (profile.valence > .18) return profile.space > .5 ? 'lydian' : 'major';
  return profile.space > .56 ? 'lydian' : 'dorian';
}

export function blendProfiles(a, b, weight) {
  // Identity and structural metadata belong to the current (a) block.
  const out = { ...a }, w = clamp(weight);
  for (const key of keys) {
    const first = Number.isFinite(a[key]) ? a[key] : 0;
    const second = Number.isFinite(b[key]) ? b[key] : first;
    out[key] = first * (1 - w) + second * w;
  }
  out.mode = modeFor(out);
  return out;
}

export const BLOCK_SKIP = 'nav,footer,aside,script,style,noscript,[hidden],[aria-hidden="true"],[data-xr-reader-ui],[data-engagement-asset],[data-xr-exclude],.references,.sources,.source-item,.bibliography,.toc,#toc,.table-of-contents,#references,#sources,.related-essays,.related';
const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,tr';
const OWNERS = 'p,li,blockquote,pre,tr';

function blockText(element, budget, ownText) {
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  let node, text = '';
  while ((node = walker.nextNode()) && text.length <= budget) {
    if (node.parentElement?.closest(BLOCK_SKIP)) continue;
    if (ownText && node.parentElement?.closest(OWNERS) !== element) continue;
    const chunk = node.nodeValue || '';
    if (chunk.trim()) text += (text ? ' ' : '') + chunk.slice(0, budget + 1 - text.length);
  }
  return { text: text.slice(0, budget).trim(), truncated: text.length > budget };
}

const accumulator = () => ({ ...Object.fromEntries(keys.map(key => [key, 0])), weight: 0, words: 0 });
function addProfile(sum, raw, weight) {
  for (const key of keys) sum[key] += raw[key] * weight;
  sum.weight += weight; sum.words += raw.words;
}
function meanProfile(sum, fallback) {
  return { ...Object.fromEntries(keys.map(key => [key, sum.weight ? sum[key] / sum.weight : fallback[key]])), words: sum.words };
}

export async function analyseDocument(article, title = '', signal) {
  const blocks = [], sections = [], aggregate = accumulator();
  const titleProfile = describeText(title), walker = article.ownerDocument.createTreeWalker(article, 1);
  let element, heading = titleProfile, section = null, characters = 0, visited = 0, limited = false;
  while ((element = walker.nextNode())) {
    if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    if (blocks.length >= MAX_BLOCKS || characters >= MAX_CHARACTERS) { limited = true; break; }
    if (++visited % 96 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    if (!element.matches(BLOCKS) || element.closest(BLOCK_SKIP)) continue;
    // A table row is one anchor, including its nested paragraphs and lists.
    if (element.parentElement?.closest('tr')) continue;
    if (element.matches('tr') && !element.querySelector('td,th')) continue;
    const isHeading = /^H[1-6]$/.test(element.tagName);
    const role = isHeading ? 'heading' : element.matches('tr') ? 'table' : element.matches('pre') ? 'code'
      : element.closest('blockquote') ? 'quote' : element.closest('li') ? 'list' : 'paragraph';
    const { text, truncated } = blockText(element, Math.min(MAX_BLOCK_CHARACTERS, MAX_CHARACTERS - characters), element.matches('li,blockquote'));
    limited ||= truncated;
    if (!text || (role === 'paragraph' && text.length < 15)) continue;
    characters += text.length;
    const raw = describeText(text);
    if (isHeading) heading = raw;
    if (isHeading || !section) {
      section = { id: sections.length, start: blocks.length, end: blocks.length, ...accumulator() };
      sections.push(section);
    }
    section.end = blocks.length;
    const weight = Math.min(180, raw.words) * (isHeading ? 2 : 1);
    addProfile(section, raw, weight); addProfile(aggregate, raw, weight);
    blocks.push({ ...blendProfiles(raw, heading, isHeading ? 0 : .2), element, words: raw.words, seed: raw.seed,
      heading: isHeading, role, sectionId: section.id, sectionProgress: 0, cadence: 0 });
    if (blocks.length % 24 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
  const global = blendProfiles(meanProfile(aggregate, titleProfile), titleProfile, .18);
  global.seed = fingerprint(title.slice(0, MAX_BLOCK_CHARACTERS) + ':' + blocks.map(block => block.seed).join(','));
  global.tonic = [48, 50, 52, 53, 55, 57][global.seed % 6];
  const sectionProfiles = sections.map(part => {
    // Content identity within this document, independent of position or mood bins.
    // Mix existing uint32 block hashes; no source text or extra sequence is retained.
    let sectionSeed = fingerprint(`section:${global.seed}`);
    for (let i = part.start; i <= part.end; i++) sectionSeed = Math.imul(sectionSeed ^ blocks[i].seed, 16777619) >>> 0;
    return { id: part.id, start: part.start, end: part.end, sectionSeed,
      ...blendProfiles(meanProfile(part, titleProfile), global, .15) };
  });
  // Read only original profiles. Never feed an already smoothed predecessor back.
  const originals = blocks.map(block => ({ ...block }));
  for (const part of sectionProfiles) {
    let wordsBefore = 0;
    for (let i = part.start; i <= part.end; i++) {
      const block = blocks[i], original = originals[i];
      let local = blendProfiles(original, part, .18);
      const previous = originals[Math.max(part.start, i - 1)];
      const next = originals[Math.min(part.end, i + 1)];
      // Equal neighbour weights; no leakage across an unrelated heading boundary.
      local = blendProfiles(local, blendProfiles(previous, next, .5), .2);
      const progress = part.start === part.end ? (block.heading ? 0 : 1)
        : clamp((wordsBefore + (block.heading ? 0 : block.words * .5)) / Math.max(1, part.words));
      Object.assign(block, blendProfiles(global, local, .78), {
        element: original.element, words: original.words, seed: original.seed, heading: original.heading,
        role: original.role, sectionId: part.id, sectionSeed: part.sectionSeed, sectionProgress: progress,
        cadence: block.heading ? .2 : i === part.end ? .85 : block.role === 'quote' ? .6 : .12
      });
      block.phraseSpace = clamp(block.phraseSpace + (block.role === 'quote' ? .12 : 0) + (i === part.end && !block.heading ? .1 : 0));
      wordsBefore += original.words;
    }
  }
  return { global, blocks, sections: sectionProfiles, limited, characters };
}

export function readingFraction(top, bottom, viewport, scrollY, offset = 80) {
  const start = Math.max(0, top - offset);
  const end = Math.max(start, bottom - viewport + 28);
  if (end <= start) return bottom <= scrollY + viewport ? 1 : 0;
  return clamp((scrollY - start) / (end - start));
}
