'use strict';
// Synthetic data only. DOM tests are not browser or screen-reader verification.
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
async function harness(url='https://example.test/natverk/') {
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
  w.fetch = async url => ({ok:true, json:async()=> url.includes('natverk-index') ? {schemaVersion:2, releaseId:RELEASE, artiklar:articles, kanter:relations} : {schemaVersion:1, releaseId:RELEASE, relations}});
  w.localStorage.setItem('synthetic-private-sentinel', 'unchanged');
  w.eval(fs.readFileSync(path.join(__dirname, '../natverk.js'), 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise(resolve => setImmediate(resolve));
  const el = id => w.document.getElementById(id);
  const query = text => {el('essaSok').value=text; el('essaSok').dispatchEvent(new w.Event('input'));};
  return {w, el, query, frames, media, get paints(){return paints;},
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
  const wait = () => new Promise(resolve => setTimeout(resolve, 30));
  try {
    assert.equal(h.el('essaAntal').textContent, '2');
    assert.equal(h.el('natverk').classList.contains('natverk-fel'), false);
    h.el('natverkNoder').children[0].click();
    h.el('natverkNoder').children[1].click();
    h.w.history.back(); await wait();
    assert.equal(h.el('relationspanelTitel').textContent, 'Vatten och café');
    assert.equal(h.el('essaSok').value, 'vatten');
    h.w.history.forward(); await wait();
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
