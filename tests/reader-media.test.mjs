import test from 'node:test';
import assert from 'node:assert/strict';
import { installReadingMedia } from '../reader-focus-media.mjs';

// A small deterministic DOM/event/clock harness. It executes the real controller
// with a controllable engine and needs no browser or additional dependency.
class Target {
  constructor(tagName = 'DIV') {
    this.tagName = tagName; this.dataset = {}; this.attributes = {}; this.handlers = new Map();
    this.style = { setProperty() {} }; this.textContent = ''; this.value = ''; this.disabled = false;
  }
  addEventListener(type, listener) { const list = this.handlers.get(type) || []; list.push(listener); this.handlers.set(type, list); }
  emit(type, detail = {}) { return Promise.all((this.handlers.get(type) || []).map(fn => fn({ type, target: this, ...detail }))); }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(selector) { return this.controls?.get(selector) || null; }
  matches(selector) { return selector.split(',').some(tag => tag.toUpperCase() === this.tagName); }
  closest() { return this.excluded ? this : null; }
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const profile = (seed, sectionId, role = 'paragraph') => ({
  seed, sectionId, role, words: 40, heading: role === 'heading', valence: 0, energy: .3,
  space: .3, thought: .3, tonic: 48, mode: 'dorian', sectionProgress: .3,
  phraseSpace: .2, cadence: .2, confidence: .4
});

function harness(t, { startQueue = [], stopQueue = [], scoreFactory } = {}) {
  let clock = 0, serial = 0, analyses = 0;
  const timers = new Map(), frames = new Map(), original = new Map(), window = new Target(), document = new Target();
  const put = (name, value) => { original.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, writable: true, configurable: true }); };
  put('scrollY', 0); put('innerHeight', 200); put('window', window); put('document', document);
  put('addEventListener', window.addEventListener.bind(window)); put('NodeFilter', { SHOW_ELEMENT: 1 });
  put('localStorage', { getItem() { return null; }, setItem() {} });
  put('setTimeout', (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: clock + delay }); return id; });
  put('clearTimeout', id => timers.delete(id));
  put('requestAnimationFrame', fn => { const id = ++serial; frames.set(id, fn); return id; });
  put('cancelAnimationFrame', id => frames.delete(id));
  const observer = { observed: false };
  put('ResizeObserver', class { observe() { observer.observed = true; } disconnect() { observer.observed = false; } });
  window.scrollTo = ({ top }) => { globalThis.scrollY = top; };
  document.hidden = false; document.title = 'Fixture'; document.documentElement = new Target(); document.querySelectorAll = () => [];
  const group = new Target();
  group.controls = new Map(['music-toggle', 'music-status', 'progress-visible', 'progress-size', 'progress-position', 'music-volume', 'music-volume-value'].map(name => [`[data-${name}]`, new Target()]));
  document.createElement = () => group;
  const element = (tag, top, bottom, text = 'A reading block with enough text') => {
    const node = new Target(tag.toUpperCase()); node.textContent = text; node.getBoundingClientRect = () => ({ top: top - scrollY, bottom: bottom - scrollY }); return node;
  };
  const article = element('article', 0, 1500);
  const nodes = [element('h2', 0, 30, 'War'), element('p', 40, 160), element('tr', 220, 400), element('h2', 600, 635, 'Joy'), element('p', 645, 900), element('tr', 1200, 1300, 'Short final row')];
  const bibliography = element('p', 1400, 1500, 'Excluded references'); bibliography.excluded = true;
  const allNodes = [...nodes, bibliography];
  document.createTreeWalker = () => {
    let i = -1;
    return { currentNode: article, lastChild() { if (i !== -1) return null; i = allNodes.length - 1; return this.currentNode = allNodes[i]; }, previousNode() { return this.currentNode = (--i >= 0 ? allNodes[i] : article); } };
  };
  const score = scoreFactory ? scoreFactory(nodes) : {
    global: { ...profile(999, 0), words: 800 },
    // Deliberately capped before the final row: progress still needs its end.
    blocks: nodes.slice(0, 5).map((element, i) => ({ ...profile(100 + i, i < 3 ? 0 : 1, i === 0 || i === 3 ? 'heading' : i === 2 ? 'table' : 'paragraph'), element })), limited: true
  };
  const engine = {
    starts: [], targets: [], stops: 0, closeFailed: false,
    start(p) { this.starts.push(p); return startQueue.length ? startQueue.shift().promise : Promise.resolve(true); },
    stop() { this.stops++; return stopQueue.length ? stopQueue.shift().promise : Promise.resolve(); },
    setTarget(p) { this.targets.push(p); }, setVolume() {}, duck() {},
    stats() { return { closeFailed: this.closeFailed, schedulers: 0 }; }
  };
  const progress = new Target('INPUT'), panel = new Target(); panel.insertBefore = () => {};
  const controller = installReadingMedia({ article, panel, progress }, { engine, analyse: async () => { analyses++; return score; }, now: () => clock });
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(clock));
    for (let i = 0; i < 3; i++) await Promise.resolve();
  };
  const advance = async ms => {
    const end = clock + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      clock = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
    }
    clock = end; await flush();
  };
  t.after(async () => {
    await window.emit('pagehide'); await flush();
    for (const [name, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  return { controller, engine, group, document, window, progress, timers, observer, nodes, flush, advance,
    control: name => group.querySelector(`[data-${name}]`),
    scroll: async (y, elapsed = 16) => { clock += elapsed; globalThis.scrollY = y; await window.emit('scroll'); await flush(); },
    analyses: () => analyses
  };
}

for (const outcome of ['resolve', 'reject']) test(`a stale ${outcome} cannot stop or overwrite a newer UI music session`, async t => {
  const old = deferred(), h = harness(t, { startQueue: [old] }); await h.flush();
  const first = h.control('music-toggle').emit('click'); await h.flush();
  assert.equal(h.controller.stats().busy, true);
  await h.document.emit('xr-focus-change', { detail: false }); await h.flush();
  await h.control('music-toggle').emit('click'); await h.flush();
  const status = h.control('music-status').textContent, stops = h.engine.stops;
  if (outcome === 'resolve') old.resolve(true); else old.reject(new Error('old resume failed'));
  await first; await h.flush();
  assert.equal(h.controller.stats().active, true); assert.equal(h.controller.stats().busy, false);
  assert.equal(h.engine.stops, stops); assert.equal(h.control('music-status').textContent, status);
  assert.equal(h.group.dataset.musicState, 'playing');
});

test('an older stop completion cannot unlock or overwrite a later stop', async t => {
  const first = deferred(), second = deferred(), h = harness(t, { stopQueue: [first, second] }); await h.flush();
  await h.control('music-toggle').emit('click'); await h.flush();
  void h.control('music-toggle').emit('click');
  void h.document.emit('xr-focus-change', { detail: false });
  first.resolve(); await h.flush();
  assert.equal(h.controller.stats().busy, true); assert.equal(h.control('music-toggle').disabled, true);
  second.resolve(); await h.flush(); assert.equal(h.controller.stats().busy, false);
});

test('global motif identity survives a start on a table and whitespace keeps the preceding section', async t => {
  const h = harness(t); await h.flush(); await h.scroll(250);
  await h.control('music-toggle').emit('click'); await h.flush();
  const start = h.engine.starts[0];
  assert.equal(start.role, 'table'); assert.equal(start.seed, 102); assert.equal(start.motifSeed, 999);
  assert.equal('element' in start, false);
  await h.scroll(470); await h.advance(220); // Reading line 546, before the heading at 600.
  assert.equal(h.engine.targets.at(-1).seed, 102); assert.equal(h.engine.targets.at(-1).sectionId, 0);
  await h.scroll(540); await h.advance(220);
  assert.equal(h.engine.targets.at(-1).seed, 103); assert.equal(h.engine.targets.at(-1).heading, true);
  assert.equal(h.engine.targets.at(-1).motifSeed, 999);
});

test('fast scrolling coalesces targets with one timer, then modest resting space is cleared on movement', async t => {
  const h = harness(t); await h.flush(); await h.control('music-toggle').emit('click'); await h.flush();
  const count = h.engine.targets.length;
  for (const y of [120, 260, 450, 700]) { await h.scroll(y); assert.equal(h.timers.size, 1); }
  assert.equal(h.engine.targets.length, count); // Progress still updates while sound waits.
  assert.ok(Number(h.progress.value) > 0);
  await h.advance(219); assert.equal(h.engine.targets.length, count);
  await h.advance(1); assert.equal(h.engine.targets.length, count + 1);
  assert.equal(h.engine.targets.at(-1).seed, 104); assert.equal(h.timers.size, 1);
  await h.advance(7780); assert.equal(h.engine.targets.at(-1).phraseSpace, .32); assert.equal(h.timers.size, 0);
  await h.scroll(701, 1000); assert.equal(h.engine.targets.at(-1).phraseSpace, .2);
  await h.control('music-toggle').emit('click'); await h.flush(); assert.equal(h.timers.size, 0);
});

test('an enclosing list introduction cannot swallow its later child reading anchors', async t => {
  const h = harness(t, { scoreFactory: nodes => {
    nodes[1].tagName = 'LI';
    nodes[1].getBoundingClientRect = () => ({ top: 40 - scrollY, bottom: 900 - scrollY });
    return { global: profile(999, 0), blocks: nodes.slice(0, 5).map((element, i) => ({
      ...profile(100 + i, 0, i === 1 ? 'list' : 'paragraph'), element
    })) };
  } });
  await h.flush(); await h.control('music-toggle').emit('click'); await h.flush();
  await h.scroll(40); await h.advance(220); assert.equal(h.engine.targets.at(-1).role, 'list');
  await h.scroll(250); await h.advance(220); assert.equal(h.engine.targets.at(-1).seed, 102);
  await h.scroll(620); await h.advance(220); assert.equal(h.engine.targets.at(-1).seed, 104);
});

test('progress reaches a final table beyond the analysis cap, excludes references and BFCache requires a new start', async t => {
  const h = harness(t); await h.flush(); await h.scroll(1128);
  assert.equal(h.progress.value, '1000');
  await h.control('music-toggle').emit('click'); await h.flush(); assert.equal(h.timers.size, 1);
  await h.window.emit('pagehide'); await h.flush();
  assert.equal(h.timers.size, 0); assert.equal(h.controller.stats().blocks, 0); assert.equal(h.observer.observed, false);
  await h.window.emit('pageshow', { persisted: true }); await h.flush();
  assert.equal(h.analyses(), 2); assert.equal(h.observer.observed, true); assert.equal(h.controller.stats().active, false);
  assert.equal(h.engine.starts.length, 1); assert.equal(h.timers.size, 0);
});

test('failed context closure stays visible and prevents another start', async t => {
  const h = harness(t); await h.flush(); await h.control('music-toggle').emit('click'); await h.flush();
  h.engine.closeFailed = true;
  await h.document.emit('xr-focus-change', { detail: false }); await h.flush();
  assert.match(h.control('music-status').textContent, /ljudmotorn kunde inte stängas/);
  assert.equal(h.control('music-toggle').disabled, true);
  await h.control('music-toggle').emit('click'); assert.equal(h.engine.starts.length, 1);
});


test('tab switches preserve playback and freeze reading work, returning does not restart audio', async t => {
  const h = harness(t); await h.flush(); await h.control('music-toggle').emit('click'); await h.flush();
  const starts = h.engine.starts.length, stops = h.engine.stops, targets = h.engine.targets.length;
  h.document.hidden = true; await h.document.emit('visibilitychange'); await h.flush();
  assert.equal(h.controller.stats().active, true); assert.equal(h.timers.size, 0);
  await h.scroll(700); await h.advance(60000);
  assert.equal(h.engine.targets.length, targets); assert.equal(h.engine.stops, stops);
  h.document.hidden = false; await h.document.emit('visibilitychange'); await h.flush();
  assert.equal(h.engine.starts.length, starts); assert.equal(h.engine.stops, stops);
  assert.equal(h.controller.stats().active, true); assert.equal(h.engine.targets.at(-1).seed, 104);
  await h.control('music-toggle').emit('click'); await h.flush();
  assert.equal(h.controller.stats().active, false); assert.equal(h.engine.stops, stops + 1);
});

test('a start clicked before a tab switch may finish while hidden without being cancelled', async t => {
  const resume = deferred(), h = harness(t, { startQueue: [resume] }); await h.flush();
  const starting = h.control('music-toggle').emit('click'); await h.flush();
  h.document.hidden = true; await h.document.emit('visibilitychange'); await h.flush();
  resume.resolve(true); await starting; await h.flush();
  assert.equal(h.controller.stats().active, true); assert.equal(h.engine.stops, 0);
  assert.equal(h.timers.size, 0);
  await h.window.emit('pagehide'); await h.flush();
  assert.equal(h.controller.stats().active, false); assert.equal(h.engine.stops, 1);
});
