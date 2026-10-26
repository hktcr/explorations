const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sameArticles, reviewedRelationCount, libraryStatus } = require('../bibliotek.js');
const network = require('../natverk-index.json');
const slugs = network.artiklar.map(article => article.slug);

test('bibliotekets antal härleds från aktuella artiklar och granskade samband', () => {
  assert.equal(reviewedRelationCount(network, slugs), network.kanter.length);
  assert.equal(libraryStatus(slugs.length, slugs.length, false, network.kanter.length, false),
    `${slugs.length} essäer. ${network.kanter.length} granskade samband i biblioteket.`);
  const expanded = structuredClone(network);
  expanded.artiklar.push({slug: 'next-essay'});
  expanded.kanter.push({a: slugs[0], b: 'next-essay', status: 'reviewed'});
  assert.equal(reviewedRelationCount(expanded, [...slugs, 'next-essay']), network.kanter.length + 1);
  assert.match(libraryStatus(slugs.length + 1, slugs.length + 1, false, expanded.kanter.length, false), /^34 essäer\. 48 /);
});

test('status skiljer synliga kort från bibliotekets totaler och okända samband', () => {
  assert.equal(libraryStatus(33, 31, true, 47, false), '31 av 33 essäer visas (lästa dolda). 47 granskade samband i biblioteket.');
  assert.match(libraryStatus(33, 0, true, 47, false), /^0 av 33/);
  assert.equal(libraryStatus(33, 33, false, null, false), '33 essäer.');
  assert.equal(libraryStatus(33, 33, false, null, true), '33 essäer. Sambandsantalet kunde inte hämtas.');
});

test('felaktiga eller gamla index får inte ge pålitligt klingande antal', () => {
  assert.equal(sameArticles(network, [...slugs, 'next-essay']), false);
  for (const mutate of [
    data => { data.releaseId = 'stale'; },
    data => { data.artiklar[1].slug = data.artiklar[0].slug; },
    data => { data.kanter[0].status = 'candidate'; },
    data => { data.kanter[0].a = 'unknown'; },
    data => { data.kanter[0].a = data.kanter[0].b; },
    data => { data.kanter.push(data.kanter[0]); }
  ]) {
    const data = structuredClone(network); mutate(data);
    assert.throws(() => reviewedRelationCount(data, slugs));
  }
});

test('bibliotekets status är ett artigt atomiskt liveområde utan statisk antalskopia', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /id="natverkStatus" role="status" aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(html, /\d+ essäer, \d+ granskade samband/);
});

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
test('metatexten har minst 4,5:1 kontrast i ljus- och mörkläge', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const palettes = [...html.matchAll(/:root\{([^}]+)\}/g)];
  assert.equal(palettes.length, 2);
  for (const [, palette] of palettes) {
    const color = name => {
      let value = palette.match(new RegExp(`--${name}:#([a-f0-9]+)`))[1];
      if (value.length === 3) value = [...value].map(character => character.repeat(2)).join('');
      return luminance(value);
    };
    for (const surface of ['bg', 'card']) {
      const values = [color('meta'), color(surface)].sort((a, b) => a - b);
      assert.ok((values[1] + 0.05) / (values[0] + 0.05) >= 4.5, `${surface}: ${palette}`);
    }
  }
});
