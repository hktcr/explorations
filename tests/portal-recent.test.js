const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

test('rolling publications, verified five-minute refresh, focus and last good data',async()=>{
  const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://example.org/explorations/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  try {
    let now=Date.parse('2026-10-25T02:30:00Z'), hidden=false, calls=0, fulfill;
    const tasks=new Map();
    let id=0;
    w.Date.now=()=>now;
    w.setTimeout=(fn,delay)=>{tasks.set(++id,{fn,delay});return id;};
    w.clearTimeout=id=>tasks.delete(id);
    Object.defineProperty(w.document,'hidden',{get:()=>hidden});
    const poll=()=>{const [id,t]=[...tasks].find(([,v])=>v.fn.name==='check');tasks.delete(id);return t.fn();};
    w.fetch=(_url,opts)=>{assert.equal(opts.cache,'no-cache');calls++;return new Promise(resolve=>{fulfill=resolve;});};
    const make=(path,age,format='Timmen')=>({href:path+'/index.html',format,title:path,order:1,published:new Date(now-age).toISOString(),updated:'',metadata:'Publicerad'});
    const day=86400000;
    const records=[make('just-in',day-1),make('boundary',day),make('outside',day+1),make('old-essay',day*3,'Essä'),make('future',-day),{...make('revised',day*5),updated:new Date(now-1000).toISOString()}];
    const data=()=>({ok:true,json:async()=>({version:1,titles:records})});
    w.eval(fs.readFileSync('portal-recent.js','utf8'));
    const first=poll();w.dispatchEvent(new w.Event('pageshow'));
    assert.equal(calls,1);
    fulfill(data());await first;
    const doc=w.document, rows=()=>[...doc.querySelectorAll('#recentEditions li:not([hidden])')];
    assert.deepEqual(rows().map(r=>r.querySelector('a').textContent),['revised','just-in','old-essay']);
    assert.deepEqual(rows().filter(r=>r.classList.contains('recent-publication')).map(r=>r.firstChild.textContent),['just-in']);
    const text=doc.getElementById('recentCheck').textContent;
    assert.match(text,/25 oktober 2026.*03:30:00/);
    const focus=rows()[1].querySelector('a');focus.focus();now++;
    w.dispatchEvent(new w.Event('pageshow'));assert.ok(!focus.parentNode.classList.contains('recent-publication'));
    hidden=true;doc.dispatchEvent(new w.Event('visibilitychange'));
    assert.ok(![...tasks.values()].some(t=>t.fn.name==='check'));
    now+=310000;hidden=false;doc.dispatchEvent(new w.Event('visibilitychange'));
    assert.equal([...tasks.values()].find(t=>t.fn.name==='check').delay,0);
    const err=poll();fulfill({ok:false});await err;
    assert.match(doc.getElementById('recentCheck').textContent,/fördröjd/);
    assert.ok(doc.getElementById('recentCheck').textContent.startsWith(text));assert.equal(doc.activeElement,focus);
    records.unshift(make('new-title',0));const next=poll();fulfill(data());await next;
    assert.equal(rows()[0].firstChild.textContent,'new-title');assert.equal(doc.activeElement,focus);
    assert.ok(!doc.getElementById('recentCheck').textContent.includes('fördröjd'));
  } finally {w.close();}
});

test('a verified refresh updates the third row on the same permanent article link', async () => {
  const dom = new JSDOM(fs.readFileSync('index.html','utf8'), {runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window, doc = w.document;
  try {
    const data = JSON.parse(fs.readFileSync('portal-senaste.json','utf8'));
    const lead = data.latestBriefing;
    const post = data.titles.find(item => item.href === lead.href);
    const row = doc.querySelector('dl.portal-latest > [data-latest="briefing"]');
    const link = row.querySelector('dd a');
    link.focus();
    post.updated = lead.at = '2026-11-25T03:10:00Z';
    lead.kind = 'updated';
    lead.dateLabel = '25 november 2026 kl. 04.10';
    w.fetch = async () => ({ok:true,json:async()=>data});
    w.eval(fs.readFileSync('portal-recent.js','utf8'));
    await new Promise(resolve=>w.setTimeout(resolve,30));
    assert.equal(row.querySelector('small').textContent, 'Uppdaterad 25 november 2026 kl. 04.10');
    assert.equal(row.querySelector('time').dateTime, lead.at);
    assert.equal(doc.activeElement,link);
    assert.equal(doc.querySelectorAll('dl.portal-latest > div').length,3);
  } finally { w.close(); }
});
