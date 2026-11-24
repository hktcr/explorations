const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const base='https://example.test/explorations/timkronikan/';
const load=path=>fs.readFileSync('timkronikan/'+path,'utf8');
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('first click opens dialog and shows progress until matching rendered message; retry supported',()=>{
 const {window:w}=new JSDOM(load('index.html'),{runScripts:'outside-only',url:base});const d=w.document;
 try{
 const box=d.getElementById('kr-cloud'), trigger=d.querySelector('[data-kr-wordcloud]'), frame=d.getElementById('kr-frame');
 box.showModal=()=>box.setAttribute('open','');box.close=()=>{box.removeAttribute('open');box.dispatchEvent(new w.Event('close'));};
 let timers=new Map(), n=0;
 w.setTimeout=fn=>{timers.set(++n,fn);return n;};w.clearTimeout=i=>{timers.delete(i);};
 w.eval(load('kr-grid.js'));trigger.click();
 assert(box.open);assert(!d.getElementById('kr-loading').hidden);assert(frame.hasAttribute('data-loading'));
 w.dispatchEvent(new w.MessageEvent('message',{origin:'https://other.test',source:frame.contentWindow,data:{type:'explorations:wordcloud-ready'}}));
 assert(!d.getElementById('kr-loading').hidden);
 [...timers.values()][0]();
 assert(!d.getElementById('kr-cloud-error').hidden);
 d.getElementById('kr-retry').click();
 assert(!d.getElementById('kr-loading').hidden);
 w.dispatchEvent(new w.MessageEvent('message',{origin:w.location.origin,source:frame.contentWindow,data:{type:'explorations:wordcloud-ready'}}));
 assert(d.getElementById('kr-loading').hidden);assert(!frame.hasAttribute('data-loading'));
 box.close();assert.equal(d.activeElement,trigger);
 }finally{w.close();}
});
test('word sizes are native text level; visible words contain no numeric badges; results and slider stay intact',()=>{
 const {window:w}=new JSDOM(load('begrepp.html'));const d=w.document;
 for(const a of d.querySelectorAll('.begrepp-chip a')){
  assert(!a.querySelector('.begrepp-count'));assert(a.querySelector('.begrepp-sr'));assert(a.parentElement.getAttribute('style').includes('--cloud-size:'));
 }
 assert(d.querySelector('meter'));assert(d.querySelector('#begrepp-min'));w.close();
});
test('manual article preference survives newer record detection and offers exactly one discreet recall',async()=>{
 const latest=JSON.parse(load('senaste.json'));
 const id=latest.entry.id;
 const {window:w}=new JSDOM(load('inlagg/'+id+'.html'),{runScripts:'outside-only',url:base+'inlagg/'+id+'.html'});const d=w.document;
 Object.defineProperty(d,'currentScript',{value:{src:base+'editorial-reader.js'}});
 let offered=latest, time=0, n=0;const timers=new Map();
 w.Date.now=()=>time;
 w.setTimeout=(f,delay)=>{timers.set(++n,{f,delay});return n;};w.clearTimeout=i=>timers.delete(i);
 w.fetch=async u=>({ok:true,headers:{get:()=> 'application/json'},text:async()=>u.pathname.endsWith('senaste.json')?JSON.stringify(offered):load(u.pathname.split('/timkronikan/')[1])});
 try{
 w.eval(load('editorial-reader.js'));await settle();
 const current=d.querySelector('.kr-detail-story'), note=d.querySelector('[data-editor-notice]');
 assert(!d.querySelector('[data-editor-reader]').hidden);assert.equal(current.id,id);
 assert(d.querySelector('[data-editor-older]').hasAttribute('href'));assert(note.hidden);
 offered={...latest,entry:{...latest.entry,id:'inlagg-2099-01-01-0700',title:'Nytt ämne'}};
 await [...timers.values()].at(-1).f();await settle();assert(!note.hidden);assert.match(note.textContent,/Nytt ämne/);
 assert.equal(d.querySelector('.kr-detail-story').id,id);
 d.querySelector('[data-editor-snooze]').click();assert(note.hidden);assert.equal([...timers.values()].at(-1).delay,600000);
 time=600000;await [...timers.values()].at(-1).f();await settle();assert(!note.hidden);
 }finally{w.close();}
});
test('screen selects a historical article without changing fullscreen document or auto-returning',async()=>{
 const id='inlagg-2026-11-22-2200';
 const historical=JSON.parse(load('visning/'+id+'.json'));
 const {window:w}=new JSDOM(load('skarm.html'),{runScripts:'outside-only',url:base+'skarm.html?las='+id});
 const d=w.document;let count=0,n=0;const timers=new Map();
 w.matchMedia=()=>({matches:true});
 w.setTimeout=(f,delay)=>{timers.set(++n,{f,delay});return n;};w.clearTimeout=i=>timers.delete(i);
 w.HTMLImageElement.prototype.decode=()=>Promise.resolve();
 w.fetch=async u=>{count++;return {ok:true,headers:{get:()=> 'application/json'},text:async()=>load(u.pathname.split('/timkronikan/')[1])};};
 try{
 w.eval(load('skarm.js'));await settle();
 assert.equal(count,1);
 assert.equal(d.getElementById('skarm-post').dataset.id,id);
 assert(d.querySelector('h1').textContent.includes(historical.entry.title));
 const status=d.getElementById('skarm-status');
 assert.match(status.textContent,/Läsläge/);
 assert.equal(timers.size,0);
 d.getElementById('skarm-paus').click();
 assert(!new URL(w.location.href).searchParams.has('las'));
 await [...timers.values()].at(-1).f();await settle();
 assert.equal(d.getElementById('skarm-post').dataset.id,JSON.parse(load('senaste.json')).entry.id);
 }finally{w.close();}
});
