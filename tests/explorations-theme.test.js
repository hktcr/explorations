const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const load = file => fs.readFileSync(path.join(root,file),'utf8');
const runtime = load('explorations-theme.js');
const css = '@media (prefers-color-scheme: dark) and (min-width: 430px) { body { color: red } }';
function start(saved) {
  const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body><span data-xr-theme-slot></span></body></html>`, { runScripts:'outside-only', url:'https://example.test/explorations/' });
  const w = dom.window;
  if (saved !== undefined) w.localStorage.setItem('explorationsReadingTheme',saved);
  w.eval(runtime);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return w;
}
test('dark default is independent of OS; one control persists light with existing preference key', () => {
  const w = start();
  let b = w.document.querySelector('[data-xr-global-theme]');
  assert.equal(w.document.documentElement.dataset.theme,'dark');
  assert.equal(b.getAttribute('aria-pressed'),'false');
  assert.equal(w.document.querySelectorAll('[data-xr-global-theme]').length,1);
  b.click();
  assert.equal(b.getAttribute('aria-pressed'),'true');
  assert.equal(w.localStorage.getItem('explorationsReadingTheme'),'light');
  const next = start(w.localStorage.getItem('explorationsReadingTheme'));
  assert.equal(next.document.documentElement.dataset.theme,'light');
  assert.equal(next.document.documentElement.style.colorScheme,'light');
  next.close(); w.close();
});
test('same-tab setter, external storage, back/forward keep theme and listeners in sync', () => {
  const w = start('x');
  const events = [];
  w.addEventListener(w.ExplorationsTheme.event,e=>events.push(e.detail.theme));
  w.ExplorationsTheme.set('light'); assert.equal(w.ExplorationsTheme.get(),'light');
  w.localStorage.setItem('explorationsReadingTheme','dark');
  w.dispatchEvent(new w.StorageEvent('storage',{key:'explorationsReadingTheme'}));
  w.localStorage.setItem('explorationsReadingTheme','light');
  w.dispatchEvent(new w.PageTransitionEvent('pageshow',{persisted:true}));
  assert.deepEqual(events,['light','dark','light']);
  assert.equal(w.document.documentElement.dataset.readingTheme,'light');
  w.close();
});
test('legacy media rules keep extra conditions intact and can toggle repeatedly', () => {
  const w = start();
  const rule = w.document.styleSheets[0].cssRules[0];
  assert.match(rule.media.mediaText,/min-width:\s*430px/);
  assert.doesNotMatch(rule.media.mediaText,/prefers-color-scheme/);
  assert.match(rule.media.mediaText,/min-width:\s*0px/);
  w.ExplorationsTheme.set('light'); assert.match(rule.media.mediaText,/width < 0px/);
  w.ExplorationsTheme.set('dark'); assert.match(rule.media.mediaText,/min-width:\s*0px/);
  w.close();
});
test('library and network have a single slot and all 36 essays use the same script without a parallel slot', () => {
  for (const filename of ['index.html','natverk/index.html']) {
    const html = load(filename);
    assert.equal((html.match(/data-xr-theme-slot/g)||[]).length,1,filename);
    assert.equal((html.match(/explorations-theme\.js\?/g)||[]).length,1,filename);
  }
  const articles = [...load('index.html').matchAll(/href="([^"/]+)\/index\.html"/g)].map(m=>m[0].slice(6,-1));
  assert.ok(articles.length >= 36);
  for (const filename of articles) {
    const html = load(filename);
    assert.equal((html.match(/explorations-theme\.js\?/g)||[]).length,1,filename);
    assert.doesNotMatch(html,/data-xr-theme-slot/,filename);
    assert.ok(html.indexOf('explorations-theme.js') < html.indexOf('reader-settings.js'),filename);
  }
});
