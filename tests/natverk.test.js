'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RELEASE, tokenize, countMatches, searchIndex, validateNetwork, validateRelations, relationSignature } = require('../natverk.js');
const root = path.resolve(__dirname, '..');

test('Unicode tokenisering bevarar svenska och kombinerade tecken', () => {
  assert.deepEqual(tokenize('sökning människor förändring cafe\u0301'), ['sökning','människor','förändring','café']);
  assert.equal(countMatches('Ett CAFÉ och ett café.', 'café'), 2);
});

test('sökningen använder OCH semantik', () => {
  const data = {artiklar:[{slug:'a',titel:'Klimat och migration',amne:'Samhälle',avsnitt:[{rubrik:'Evidens',text:'Gränser påverkar rörlighet.'}]},{slug:'b',titel:'Klimat',amne:'Ekologi',avsnitt:[{rubrik:'Väder',text:'Värme.'}]}]};
  assert.deepEqual(searchIndex(data, 'klimat gränser').map(item => item.slug), ['a']);
});

function networkFixture() { return {schemaVersion:2,releaseId:RELEASE,generatorVersion:'x',contentHash:'h',artiklar:[{slug:'a'},{slug:'b'}],kanter:[{a:'a',b:'b',status:'reviewed',type:'mechanism',reason:'A förklarar B.',terms:['mekanism']}]}; }
function relationFixture() { return {schemaVersion:1,releaseId:RELEASE,reviewedAt:'2026-08-11',reviewer:'test',relations:[{a:'a',b:'b',status:'reviewed',type:'mechanism',reason:'A förklarar B.',terms:['mekanism']}]}; }

test('validatorerna accepterar en granskad graf', () => {
  assert.equal(validateNetwork(networkFixture(), ['a','b']).valid, true);
  assert.equal(validateRelations(relationFixture(), ['a','b']).valid, true);
  assert.equal(relationSignature(networkFixture()), relationSignature(relationFixture()));
});

test('validatorerna stoppar stale data och ogranskade relationer', () => {
  const network = networkFixture(); network.releaseId = 'old';
  const relations = relationFixture(); relations.relations[0].status = 'candidate';
  assert.equal(validateNetwork(network, ['a','b']).valid, false);
  assert.equal(validateRelations(relations, ['a','b']).valid, false);
});

test('biblioteket öppnar en separat tillgänglig nätverkssida', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const networkHtml = fs.readFileSync(path.join(root, 'natverk/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'natverk.js'), 'utf8');
  const libraryJs = fs.readFileSync(path.join(root, 'bibliotek.js'), 'utf8');
  assert.match(html, /aria-label="Sök i hela biblioteket"/);
  assert.match(html, /id="natverkOppna" href="natverk\/"/);
  assert.doesNotMatch(html, /id="natverkNoder"/);
  assert.match(networkHtml, /class="natverk-arbetsyta"/);
  assert.match(networkHtml, /id="essaLista"/);
  assert.match(networkHtml, /id="relationspanelTitel" tabindex="-1"/);
  assert.doesNotMatch(html, /input\.addEventListener\('input'/);
  assert.equal((libraryJs.match(/input\.addEventListener\('input'/g) || []).length, 1);
  assert.match(js, /event\.detail === 0/);
  assert.match(js, /function focusSelected\(node\)/);
  assert.match(js, /listElements\[node\.slug\]\.scrollIntoView/);
});

test('responsivitetskontraktet täcker telefon, surfplatta och desktop', () => {
  const css = fs.readFileSync(path.join(root, 'natverk.css'), 'utf8');
  assert.match(css, /--network-hit:\s*44px/);
  assert.match(css, /@media \(max-width:390px\)/);
  assert.match(css, /@media \(max-width:700px\)/);
  assert.match(css, /@media \(max-width:1023px\)/);
  assert.match(css, /\(pointer:coarse\)/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) clamp\(330px,29vw,440px\)/);
  assert.match(css, /\.essa-lista \{ max-height:34dvh/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /forced-colors/);
});

test('den publicerade grafen har högst fem samband per nod och inga isolerade noder', () => {
  const network = JSON.parse(fs.readFileSync(path.join(root, 'natverk-index.json'), 'utf8'));
  const degree = {}; network.kanter.forEach(edge => { degree[edge.a]=(degree[edge.a]||0)+1; degree[edge.b]=(degree[edge.b]||0)+1; });
  assert.equal(network.artiklar.length, 29); assert.equal(network.kanter.length, 41);
  network.artiklar.forEach(article => assert.ok(degree[article.slug] >= 1 && degree[article.slug] <= 5));
  assert.deepEqual([...new Set(network.kanter.map(edge => edge.status))], ['reviewed']);
});
