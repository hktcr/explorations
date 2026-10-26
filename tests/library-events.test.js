// Dependency-free event/DOM doubles, not a substitute for browser or screen-reader QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../bibliotek.js'), 'utf8');
const releaseId = '20260817-network-7';

function element() {
  const listeners = {}, classes = new Set();
  return {
    dataset: {}, textContent: '', innerHTML: '', hidden: false, value: '', children: [],
    classList: { toggle(name, state) { if (state) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
    addEventListener(name, callback) { (listeners[name] ||= []).push(callback); },
    emit(name, event = {}) { for (const callback of listeners[name] || []) callback(event); },
    focus() { this.focused = true; },
    appendChild(child) { child.parent = this; this.children.push(child); },
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); },
    querySelector(selector) { return selector === '.no-results' ? this.children.find(child => child.className === 'no-results') : null; }
  };
}
function fixture(size = 33) {
  const artiklar = Array.from({length: size}, (_, index) => ({slug: 'essay-' + index, titel: index < 3 ? 'Protein' : 'Other', amne: 'Topic', avsnitt: []}));
  const kanter = artiklar.map((article, index) => ({a: article.slug, b: artiklar[(index + 1) % size].slug, status: 'reviewed'}));
  for (let index = 0; index < 14; index++) kanter.push({a: artiklar[index].slug, b: artiklar[(index + 2) % size].slug, status: 'reviewed'});
  return {schemaVersion: 2, releaseId, artiklar, kanter};
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
const response = data => ({ok: true, json: async () => data});
const settled = () => new Promise(resolve => setImmediate(resolve));

function harness(options = {}) {
  const data = fixture(options.size || 33);
  const input = element(), grid = element(), results = element(), status = element(), document = element();
  const cards = data.artiklar.map(article => Object.assign(element(), {
    dataset: {title: article.titel, subject: article.amne}, getAttribute: () => article.slug + '/index.html'
  }));
  grid.querySelectorAll = () => cards;
  const nodes = {searchInput: input, articlesGrid: grid, traffar: results, natverkStatus: status};
  document.getElementById = id => nodes[id];
  document.createElement = element;
  let state = {hideRead: false, slugs: ['essay-0', 'essay-1']}, nextTimer = 0;
  const timers = new Map();
  vm.runInNewContext(source, {
    document, window: {explorationsReadFilter: {getState: () => state}},
    fetch: url => {
      if (url.startsWith('natverk-index')) return options.network ? options.network(data) : Promise.resolve(response(data));
      return options.search ? options.search(data) : Promise.resolve(response(data));
    },
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  document.emit('DOMContentLoaded');
  return {input, grid, results, status, cards,
    visible: () => cards.filter(card => !card.hidden).length,
    filter(hideRead, slugs = state.slugs) { state = {hideRead, slugs}; document.emit('explorations:read-filter-change'); },
    type(query) { input.value = query; input.emit('input'); for (const [id, callback] of timers) { timers.delete(id); callback(); } },
    escape() { document.emit('keydown', {key: 'Escape'}); }
  };
}

test('initialisering, filter, upprepade växlingar och Escape ger aktuella totaler', async () => {
  const ui = harness();
  assert.equal(ui.status.textContent, '33 essäer.');
  await settled();
  assert.equal(ui.status.textContent, '33 essäer. 47 granskade samband i biblioteket.');
  ui.filter(true);
  assert.equal(ui.visible(), 31);
  assert.match(ui.status.textContent, /^31 av 33/);
  ui.type('protein'); await settled();
  assert.equal(ui.status.textContent, '1 av 3 träffade essäer visas (lästa dolda).');
  ui.filter(false); await settled();
  assert.equal(ui.status.textContent, '3 essäer träffade.');
  ui.filter(true); await settled();
  ui.escape();
  assert.equal(ui.input.value, ''); assert.equal(ui.input.focused, true);
  assert.equal(ui.visible(), 31); assert.match(ui.status.textContent, /^31 av 33/);
  ui.filter(false); assert.equal(ui.visible(), 33);
});

test('nya essäer och samband räknas utan ändring av bibliotekskoden', async () => {
  const ui = harness({size: 34}); await settled();
  assert.equal(ui.visible(), 34);
  assert.equal(ui.status.textContent, '34 essäer. 48 granskade samband i biblioteket.');
});

test('lästa träffar skiljs från noll träffar och tomma kortmeddelanden rensas', async () => {
  const ui = harness(); await settled();
  ui.filter(true, Array.from({length: 33}, (_, i) => 'essay-' + i));
  assert.equal(ui.visible(), 0); assert.match(ui.grid.children[0].textContent, /Alla essäer/);
  ui.type('protein'); await settled();
  assert.equal(ui.status.textContent, '0 av 3 träffade essäer visas (lästa dolda).');
  assert.match(ui.results.innerHTML, /dolda av läsfiltret/);
  ui.type('unfindable'); await settled();
  assert.equal(ui.status.textContent, 'Ingen träff.');
  ui.escape(); ui.filter(false);
  assert.equal(ui.grid.children.length, 0); assert.equal(ui.visible(), 33);
});

test('sent nätverksantal får inte skriva över en nyare sökstatus', async () => {
  const network = deferred();
  const ui = harness({network: () => network.promise});
  ui.type('protein'); await settled();
  assert.equal(ui.status.textContent, '3 essäer träffade.');
  network.resolve(response(fixture())); await settled();
  assert.equal(ui.status.textContent, '3 essäer träffade.');
  ui.escape(); assert.match(ui.status.textContent, /47 granskade/);
});

test('sen sökning efter Escape återöppnar inte resultat', async () => {
  const search = deferred();
  const ui = harness({search: () => search.promise}); await settled();
  ui.type('protein'); assert.equal(ui.status.textContent, 'Söker…');
  ui.escape(); search.resolve(response(fixture())); await settled();
  assert.equal(ui.results.innerHTML, ''); assert.equal(ui.visible(), 33);
  assert.equal(ui.status.textContent, '33 essäer. 47 granskade samband i biblioteket.');
});

test('indexfel behåller kortsökning, ärlig status och korrekt rensning', async () => {
  const ui = harness({network: async () => ({ok: false, status: 503}), search: async () => ({ok: false, status: 503})});
  await settled(); assert.match(ui.status.textContent, /Sambandsantalet kunde inte hämtas/);
  ui.filter(true, Array.from({length: 33}, (_, i) => 'essay-' + i));
  ui.type('protein'); await settled();
  assert.match(ui.grid.children[0].textContent, /Inga synliga kort/);
  assert.equal(ui.status.textContent, '0 kort visas (lästa dolda). Fulltextsökningen är inte tillgänglig.');
  ui.filter(false); assert.equal(ui.visible(), 3); assert.equal(ui.grid.children.length, 0);
  ui.escape(); assert.equal(ui.visible(), 33); assert.match(ui.status.textContent, /Sambandsantalet kunde inte hämtas/);
});
