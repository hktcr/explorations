'use strict';
// DOM interactions use synthetic data. The catalogue integrity test checks the published files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { networkSearch, RELEASE } = require('../natverk.js');
const articles = [
  {slug:'a', id:'EXP#01', titel:'Vatten och café', amne:'Ekologi'},
  {slug:'b', id:'EXP#02', titel:'Vatten i mark', amne:'Geologi'},
  {slug:'c', id:'EXP#03', titel:'Is', amne:'Klimat'},
  {slug:'d', id:'EXP#04', titel:'Ljus', amne:'Fysik'}
];
const relations = [
  {a:'a', b:'b', status:'reviewed', type:'contrast', reason:'Olika syntetiska perspektiv.', terms:['vatten']},
  {a:'b', b:'c', status:'reviewed', type:'mechanism', reason:'Syntetisk mekanism.', terms:['fas']}
];
test('metadata relevance is separate from reviewed one-hop relations', () => {
  const data = JSON.stringify({articles, relations});
  const result = networkSearch(articles, [...relations, {a:'a', b:'d', status:'candidate'}], 'VATTEN');
  assert.deepEqual([...result.matches.keys()], ['a','b']);
  assert.deepEqual(result.matches.get('a'), ['titel']);
  assert.deepEqual([...result.neighbors], ['c']);
  assert.deepEqual([...result.links], [0,1]);
  assert.equal(JSON.stringify({articles, relations}), data);
  assert.deepEqual([...networkSearch(articles, relations, 'vatten geologi').matches.keys()], ['b']);
});
test('numeric IDs, Unicode, single letters, empty and punctuation queries are explicit', () => {
  assert.deepEqual([...networkSearch(articles, relations, 'EXP#02').matches.keys()], ['b']);
  assert.deepEqual([...networkSearch(articles, relations, 'cafe\u0301').matches.keys()], ['a']);
  assert.equal(networkSearch(articles, relations, 'v').matches.size, 2);
  for (const query of ['???', '<img src=x onerror=alert(1)>', 'okänt']) {
    const result = networkSearch(articles, relations, query);
    assert.equal(result.active, true);
    assert.equal(result.matches.size, 0);
    assert.equal(result.links.size, 0);
  }
  assert.equal(networkSearch(articles, relations, '  ').active, false);
});
async function harness(url='https://example.test/natverk/', catalogue) {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../natverk/index.html'), 'utf8'), {url, runScripts:'outside-only', pretendToBeVisual:true});
  await new Promise(resolve => setImmediate(resolve));
  const w = dom.window, media = new Map(), frames = new Map();
  let next = 0, paints = 0, hidden = false;
  Object.defineProperty(w.document, 'hidden', {get:()=>hidden});
  w.matchMedia = query => {
    if (!media.has(query)) media.set(query, {matches:false, addEventListener(type, listener){this.listener=listener;}});
    return media.get(query);
  };
  w.requestAnimationFrame = fn => {frames.set(++next, fn); return next;};
  w.cancelAnimationFrame = id => frames.delete(id);
  w.HTMLElement.prototype.scrollIntoView = function() {};
  w.HTMLElement.prototype.getBoundingClientRect = () => ({width:800, height:600});
  const ctx = {setTransform(){}, clearRect(){paints++;}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, arc(){}, fill(){}};
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  const requested = [];
  w.fetch = async url => {
    requested.push(url);
    if (url === '../vetenskaplig-briefing/') return {ok:true, text:async()=>catalogue};
    return {ok:true, json:async()=>url.includes('natverk-index') ? {schemaVersion:2, releaseId:RELEASE, artiklar:articles, kanter:relations} : {schemaVersion:1, releaseId:RELEASE, relations}};
  };
  w.localStorage.setItem('synthetic-private-sentinel', 'unchanged');
  w.eval(fs.readFileSync(path.join(__dirname, '../natverk/briefing.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, '../natverk.js'), 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise(resolve => setImmediate(resolve));
  const el = id => w.document.getElementById(id);
  const query = text => {el('essaSok').value=text; el('essaSok').dispatchEvent(new w.Event('input'));};
  return {w, el, query, frames, media, requested, get paints(){return paints;},
    visibility(value){hidden=value; w.document.dispatchEvent(new w.Event('visibilitychange'));},
    close(){assert.equal(w.localStorage.getItem('synthetic-private-sentinel'), 'unchanged'); w.close();}};
}
test('search, selection and clear preserve distinct graph states and keyboard focus', async () => {
  const h = await harness();
  try {
    h.el('essaSok').focus(); h.query('vatten');
    assert.equal(h.w.document.activeElement.id, 'essaSok');
    assert.equal(h.el('natverkNoder').querySelectorAll('.nod-traff').length, 2);
    assert.equal(h.el('natverkNoder').querySelectorAll('.nod-kopplad').length, 1);
    assert.equal(h.el('natverkNoder').querySelectorAll('.svag').length, 1);
    assert.match(h.el('essaSokStatus').textContent, /2 direkta träffar, 2 granskade samband/);
    h.el('natverkNoder').children[2].click();
    assert.equal(h.el('relationspanelTitel').textContent, 'Is');
    assert.equal(h.el('natverkNoder').querySelectorAll('.nod-traff').length, 2);
    assert.equal(h.el('essaAntal').textContent, '2');
    assert.equal(h.el('relationspanelTitel'), h.w.document.activeElement);
    h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(h.el('essaSok').value, '');
    assert.equal(h.el('essaAntal').textContent, '4');
    assert.equal(h.el('natverkNoder').querySelectorAll('.nod-vald').length, 1);
    h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(h.el('natverkNoder').querySelectorAll('.nod-vald').length, 0);
    h.el('natverkNoder').children[0].click();
    assert.equal(h.w.document.activeElement.id, 'relationspanelTitel');
    h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(h.w.document.activeElement.id, 'essaSok');
    h.query('???');
    assert.match(h.el('essaSokStatus').textContent, /Inga träffar/);
    assert.equal(h.el('natverkNoder').querySelectorAll('.svag').length, 4);
    h.el('essaSokRensa').click();
    assert.equal(h.w.document.activeElement.id, 'essaSok');
  } finally {h.close();}
});
test('pause, reduced motion and hidden document cancel animation without losing information', async () => {
  const h = await harness();
  try {
    assert.equal(h.frames.size, 0);
    h.query('vatten'); assert.equal(h.frames.size, 1);
    h.el('natverkRorelse').click(); assert.equal(h.frames.size, 0);
    assert.equal(h.el('natverkRorelse').getAttribute('aria-pressed'), 'true');
    assert.equal(h.el('natverkNoder').querySelectorAll('.nod-traff').length, 2);
    h.el('natverkRorelse').click(); assert.equal(h.frames.size, 1);
    h.visibility(true); assert.equal(h.frames.size, 0);
    assert.equal(h.el('natverk').classList.contains('sok-rorelse'), false);
    h.visibility(false); assert.equal(h.frames.size, 1);
    const reduced = h.media.get('(prefers-reduced-motion: reduce)');
    reduced.matches = true; reduced.listener();
    assert.equal(h.frames.size, 0);
    assert.equal(h.el('natverkRorelse').disabled, true);
    h.el('natverkNoder').children[0].click();
    assert.equal(h.frames.size, 0);
    h.el('natverkAterstall').click();
    assert.equal(h.el('essaSok').value, '');
    assert.equal(h.frames.size, 0);
  } finally {h.close();}
});
test('back/forward and malformed hashes restore query and selection safely', async () => {
  const h = await harness('https://example.test/natverk/?q=vatten#%FF');
  function traverse(action) {
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('No popstate on '+action)),2000);
      h.w.addEventListener('popstate',()=>{clearTimeout(timeout);resolve();},{once:true});
      h.w.history[action]();
    });
  }
  try {
    assert.equal(h.el('essaAntal').textContent, '2');
    assert.equal(h.el('natverk').classList.contains('natverk-fel'), false);
    h.el('natverkNoder').children[0].click();
    h.el('natverkNoder').children[1].click();
    await traverse('back');
    assert.equal(h.el('relationspanelTitel').textContent, 'Vatten och café');
    assert.equal(h.el('essaSok').value, 'vatten');
    await traverse('forward');
    assert.equal(h.el('relationspanelTitel').textContent, 'Vatten i mark');
    assert.equal(h.el('natverkNoder').querySelectorAll('.nod-traff').length, 2);
  } finally {h.close();}
});
test('prototype property names in URL fragments never select a nonexistent essay', async () => {
  for (const slug of ['constructor', '__proto__', 'toString']) {
    const h = await harness('https://example.test/natverk/?q=vatten#' + slug);
    try {
      assert.equal(h.el('relationspanelInnehall').hidden, true);
      assert.equal(h.el('natverkNoder').querySelectorAll('.nod-vald').length, 0);
      assert.equal(h.el('natverkNoder').querySelectorAll('.nod-traff').length, 2);
      assert.equal(h.el('natverk').classList.contains('natverk-fel'), false);
    } finally {h.close();}
  }
});
test('chronicle Escape does not clear inactive essay search; returning reuses the essay query', async () => {
  const h=await harness('https://example.test/natverk/?q=vatten');
  try {
    h.w.history.pushState(null,'','?q=vatten&cq=PFAS#kronikor');
    h.w.dispatchEvent(new h.w.CustomEvent('explorations:networkview'));
    h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(h.el('essaSok').value,'vatten');
    assert.match(h.w.location.href,/q=vatten&cq=PFAS#kronikor$/);
    h.w.history.pushState(null,'','?q=vatten&cq=PFAS#essaer');
    h.w.dispatchEvent(new h.w.CustomEvent('explorations:networkview'));
    assert.equal(h.el('natverkNoder').querySelectorAll('.nod-traff').length,2);
  } finally {h.close();}
});

test('briefing category connects each catalogue entry to its real destination', async () => {
  const menu = await harness();
  const dest = menu.el('xrBriefingNetwork').href;
  assert.equal(menu.requested.includes('../vetenskaplig-briefing/'), false);
  menu.close();

  const h = await harness(dest, '<a data-briefing href="test/">Syntetisk provtext</a><a href="arkiv/">Övrig navigering</a>');
  try {
    assert.deepEqual(h.requested, ['../vetenskaplig-briefing/']);
    const graph = h.el('natverkNoder');
    assert.equal(graph.children.length, 2);
    const category = graph.querySelector('button[data-node-kind="category"]');
    const reading = graph.querySelector('a[data-node-kind="article"]');
    assert.equal(category.getAttribute('aria-label'), 'Vetenskaplig briefing');
    assert.equal(reading.getAttribute('aria-label'), 'Syntetisk provtext');
    assert.equal(reading.href, 'https://example.test/vetenskaplig-briefing/test/');
    category.click();
    assert.equal(h.el('relationspanelTitel').textContent, category.getAttribute('aria-label'));
    assert.equal(h.el('relationspanelLas').href, 'https://example.test/vetenskaplig-briefing/');
    const edge = h.el('relationspanelLista').querySelector('button');
    assert.equal(edge.querySelector('.relationspanel-relationstyp').textContent, 'Formattillhörighet');
    edge.click();
    assert.equal(h.el('relationspanelTitel').textContent, 'Syntetisk provtext');
    assert.equal(h.el('relationspanelLas').href, reading.href);
    h.query('provtext');
    assert.equal(graph.querySelector('.nod-traff'), reading);
    assert.equal(graph.querySelector('.nod-kopplad'), category);
    assert.equal(h.w.location.search.includes('format=vetenskaplig-briefing'), true);
    assert.equal(h.el('xrShowChronicles').href, 'https://example.test/natverk/#kronikor');
  } finally {h.close();}
});

test('an invalid briefing catalogue cannot create membership or an external reading link', async () => {
  const h = await harness('https://example.test/natverk/?format=vetenskaplig-briefing',
    '<a data-briefing href="https://example.org/private/">Fel källa</a>');
  try {
    assert.equal(h.el('natverkNoder').children.length, 0);
    assert.match(h.el('natverkStatus').textContent, /kunde inte läsas/);
  } finally {h.close();}
});

test('briefing reading links label the subject and open the exact essay section', async () => {
  const related = '<a data-briefing-related="Magnetfält" data-essay-id="EXP#03" href="../falt/index.html#magnet">Fält i ett material</a>';
  const entry = (id) => '<article><a data-briefing href="test-'+id+'/">Test '+id+'</a>'+related+'</article>';
  const h = await harness('https://example.test/natverk/?format=vetenskaplig-briefing', entry('ett')+entry('tva'));
  try {
    const graph=h.el('natverkNoder');
    const essay=graph.querySelector('a[data-node-kind="essay-section"]');
    assert.equal(graph.querySelectorAll('[data-node-kind="essay-section"]').length,1);
    assert.equal(essay.href,'https://example.test/falt/index.html#magnet');
    assert.match(h.el('natverkStatus').textContent,/2 texter/);
    graph.querySelector('[data-node-kind="category"]').click();
    const buttons=()=>[...h.el('relationspanelLista').querySelectorAll('button')];
    assert.deepEqual(buttons().map(b=>b.querySelector('.relationspanel-relationstyp').textContent),['Formattillhörighet','Formattillhörighet']);
    buttons()[0].click();
    assert.equal(h.el('relationspanelLas').textContent,'Läs briefingen');
    const extension=buttons().find(b=>b.querySelector('.relationspanel-relationstyp').textContent==='Magnetfält');
    extension.click();
    assert.equal(h.el('relationspanelLas').textContent,'Läs essäavsnittet');
    assert.equal(h.el('relationspanelLas').href,essay.href);
    assert.equal(h.el('relationspanelMeta').textContent,'EXP#03');
    h.query('test ett');
    assert.ok(essay.classList.contains('nod-kopplad'));
    assert.doesNotMatch(essay.getAttribute('aria-label'),/samma format/);
  } finally {h.close();}
});

test('every published briefing subject link points to its named existing essay and a real section', () => {
  const root=path.join(__dirname,'..');
  const nodes=JSON.parse(fs.readFileSync(path.join(root,'natverk-index.json'),'utf8')).artiklar;
  const catalog=new JSDOM(fs.readFileSync(path.join(root,'vetenskaplig-briefing/index.html'),'utf8'));
  try {
    const links=[...catalog.window.document.querySelectorAll('a[data-briefing-related]')];
    assert.ok(links.some(a=>a.dataset.essayId==='EXP#27' && a.closest('article').querySelector('a[data-briefing]').getAttribute('href')==='elektricitet/'));
    for (const a of links) {
      const target=/^\.\.\/([a-z0-9-]+)\/index\.html#([a-z0-9-]+)$/.exec(a.getAttribute('href'));
      assert.ok(target);
      assert.ok(nodes.some(n=>n.slug===target[1] && n.id===a.dataset.essayId));
      assert.ok(a.dataset.briefingRelated.trim());
      const dest=new JSDOM(fs.readFileSync(path.join(root,target[1],'index.html'),'utf8'));
      try { assert.match(dest.window.document.getElementById(target[2])?.tagName||'',/^H[1-6]$/); }
      finally {dest.window.close();}
    }
  } finally {catalog.window.close();}
});
