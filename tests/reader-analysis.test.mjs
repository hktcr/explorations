import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseDocument, describeText, modeFor, blendProfiles, MAX_BLOCKS, MAX_CHARACTERS } from '../reader-score-analysis.mjs';

// Small portable DOM fixture for the TreeWalker/selector subset used by analysis.
// No browser, installed package or global document is required by these tests.
class Element {
  constructor(tag, attrs, children) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.attrs = attrs; this.parentElement = null;
    this.childNodes = children.map(child => typeof child === 'string' ? { nodeType: 3, nodeValue: child } : child);
    for (const child of this.childNodes) child.parentElement = this;
  }
  matches(selector) {
    return selector.split(',').some(part => {
      if (part.startsWith('.')) return (this.attrs.class || '').split(/\s+/).includes(part.slice(1));
      if (part.startsWith('#')) return this.attrs.id === part.slice(1);
      if (part.startsWith('[')) {
        const [, key, value] = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
        return key in this.attrs && (value === undefined || this.attrs[key] === value);
      }
      return this.tagName === part.toUpperCase();
    });
  }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  querySelector(selector) {
    const walker = this.ownerDocument.createTreeWalker(this, 1); let node;
    while ((node = walker.nextNode())) if (node.matches(selector)) return node;
    return null;
  }
}
const el = (tag, ...children) => new Element(tag, {}, children);
const attr = (tag, attributes, ...children) => new Element(tag, attributes, children);
function article(...children) {
  const root = el('article', ...children);
  const doc = { createTreeWalker(node, kind) {
    const found = [];
    const visit = parent => { for (const child of parent.childNodes || []) { if (child.nodeType === (kind === 4 ? 3 : 1)) found.push(child); visit(child); } };
    visit(node); let i = 0;
    return { nextNode: () => found[i++] || null };
  } };
  const own = node => { node.ownerDocument = doc; for (const child of node.childNodes || []) own(child); };
  own(root); return root;
}
const numeric = profile => Object.fromEntries(['valence', 'energy', 'space', 'thought', 'confidence', 'phraseSpace'].map(key => [key, profile[key]]));

test('negation remains in its sentence, attenuates without reversal and handles additive expressions', () => {
  const war = describeText('War brings suffering.');
  const afterNo = describeText('No. War brings suffering.');
  assert.equal(modeFor(afterNo), 'minor');
  assert.equal(afterNo.valence, war.valence);
  assert.ok(describeText('not a threat').valence <= 0);
  assert.ok(describeText('not a threat').valence > describeText('a threat').valence);
  assert.equal(describeText('not only hope').valence, describeText('hope').valence);
  assert.equal(describeText('inte bara glädje').valence, describeText('glädje').valence);
  assert.ok(describeText('The study found no evidence of harm.').valence <= 0);
  assert.ok(describeText('no harm').confidence < describeText('harm').confidence);
});

test('explicit Swedish and English forms preserve cue direction without broad stemming', () => {
  for (const [plain, inflected] of [['sorg rädsla hot', 'sorgen rädslan hotet'], ['fear threats attacks', 'fears threatening attacked'], ['hope love discovery', 'hopes loved discoveries']]) {
    assert.equal(describeText(plain).valence, describeText(inflected).valence);
  }
  assert.equal(describeText('rational photometric interwar').valence, 0);
});

test('blending keeps the current block identity while interpolating only cue values', () => {
  const element = {}, current = { ...describeText('hope'), element, seed: 12, words: 90, role: 'quote', sectionId: 2, cadence: .6 };
  const next = { ...describeText('war'), element: {}, seed: 99, words: 101, role: 'table', sectionId: 3, cadence: .1 };
  const mixed = blendProfiles(current, next, .25);
  for (const key of ['element', 'seed', 'words', 'role', 'sectionId', 'cadence']) assert.equal(mixed[key], current[key]);
  assert.equal(mixed.valence, current.valence * .75 + next.valence * .25);
});

test('short headings retain their own section, including h5 and h6', async () => {
  const headings = [el('h2', 'War'), el('h5', 'Hope'), el('h6', 'Why?')];
  const root = article(headings[0], el('p', 'People meet around a wooden table.'), headings[1], el('p', 'People meet around a wooden table.'), headings[2], el('p', 'People meet around a wooden table.'));
  const score = await analyseDocument(root, 'A report');
  assert.equal(score.sections.length, 3);
  assert.deepEqual(score.blocks.filter(b => b.heading).map(b => b.element), headings);
  assert.deepEqual(score.blocks.map(b => b.sectionId), [0, 0, 1, 1, 2, 2]);
  assert.ok(score.blocks[1].valence < 0);
  assert.ok(score.blocks[3].valence > 0);
});

test('table rows and nested list introductions are represented exactly once', async () => {
  const row = el('tr', el('td', 'Hope'), el('td', el('p', 'joy and healing')));
  const nested = el('li', 'Care');
  const introduction = el('li', 'Choose', el('p', 'Consider the whole day before choosing.'), el('ul', nested));
  const root = article(el('table', row), el('ul', introduction));
  const score = await analyseDocument(root, 'Food');
  assert.equal(score.blocks.length, 4);
  assert.equal(score.blocks[0].element, row);
  assert.equal(score.blocks[0].role, 'table');
  assert.equal(score.blocks[0].words, 4);
  assert.equal(score.blocks[1].element, introduction);
  assert.equal(score.blocks[1].words, 1);
  assert.equal(score.blocks[2].words, 6);
  assert.equal(score.blocks[3].element, nested);
  assert.equal(score.global.words, 12);
});

test('hidden/reference/UI text is excluded and structural metadata is bounded without retained text', async () => {
  const root = article(el('h2', 'A thought'), el('p', 'An ordinary paragraph has room for a question.'),
    el('blockquote', el('p', 'A brief quotation closes this part.')),
    attr('div', { class: 'sources' }, el('p', 'War grief death and fear')),
    attr('div', { hidden: '' }, el('p', 'War grief death and fear')),
    attr('div', { 'data-xr-exclude': '' }, el('p', 'War grief death and fear')));
  const score = await analyseDocument(root, 'Report');
  assert.equal(score.blocks.length, 3);
  assert.equal(score.blocks[2].role, 'quote');
  assert.ok(score.blocks[2].cadence > score.blocks[1].cadence);
  assert.ok(score.blocks[2].phraseSpace > score.blocks[1].phraseSpace);
  for (const block of score.blocks) {
    for (const key of ['sectionProgress', 'cadence', 'phraseSpace', 'confidence']) assert.ok(block[key] >= 0 && block[key] <= 1, key);
    assert.equal('text' in block, false); assert.equal('tokens' in block, false);
  }
  for (const section of score.sections) {
    assert.equal('element' in section, false);
    assert.equal('text' in section, false);
    assert.equal('tokens' in section, false);
  }
  assert.ok(Number.isInteger(score.global.seed)); assert.ok(Number.isInteger(score.global.tonic));
});

test('neighbour smoothing is symmetric rather than feeding processed profiles into later blocks', async () => {
  const text = ['War grief suffering', 'People meet around a wooden table.', 'Hope joy healing'];
  const forward = await analyseDocument(article(...text.map(t => el('p', t))), 'A report');
  const backward = await analyseDocument(article(...[...text].reverse().map(t => el('p', t))), 'A report');
  // phraseSpace/cadence intentionally mark the final block; semantic cues must be order independent.
  for (let i = 0; i < text.length; i++) for (const key of ['valence', 'energy', 'space', 'thought', 'confidence']) {
    assert.ok(Math.abs(forward.blocks[i][key] - backward.blocks.at(-i - 1)[key]) < 1e-12, key);
  }
});

test('block, section and character budgets hold, single-block truncation is disclosed and abort is honoured', async () => {
  const many = await analyseDocument(article(...Array.from({ length: MAX_BLOCKS + 2 }, () => el('h2', 'A'))), 'Report');
  assert.equal(many.blocks.length, MAX_BLOCKS); assert.equal(many.sections.length, MAX_BLOCKS); assert.equal(many.limited, true);
  const large = await analyseDocument(article(...Array.from({ length: 50 }, () => el('p', 'word '.repeat(3200)))), 'Report');
  assert.ok(large.characters <= MAX_CHARACTERS); assert.equal(large.limited, true);
  const one = await analyseDocument(article(el('p', 'word '.repeat(5000))), 'Report');
  assert.equal(one.blocks.length, 1); assert.equal(one.limited, true); assert.ok(one.characters <= 16000);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(analyseDocument(article(el('p', 'A useful ordinary paragraph.')), 'Report', abort.signal), { name: 'AbortError' });
});

test('document motif seed is reproducible and profile output stays finite for empty cues', async () => {
  const root = article(el('h2', '...'), el('p', '12345678901234567890'));
  const a = await analyseDocument(root, 'Report'), b = await analyseDocument(root, 'Report');
  assert.equal(a.global.seed, b.global.seed);
  for (const profile of [a.global, ...a.blocks, ...a.sections]) for (const value of Object.values(numeric(profile))) assert.ok(Number.isFinite(value));
});
