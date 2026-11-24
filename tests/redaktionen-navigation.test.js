const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const base='https://example.test/explorations/timkronikan/';
const load=path=>fs.readFileSync('timkronikan/'+path,'utf8');
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('retired word cloud forwards to the network and remains absent from generated editions',()=>{
 const redirect=new JSDOM(load('begrepp.html'),{url:base+'begrepp.html'}).window.document;
 const target=new URL('../natverk/#kronikor',base).href;
 assert.equal(redirect.querySelector('a').href,target);
 assert.equal(redirect.querySelector('meta[http-equiv="refresh"]').content,'0; url=../natverk/#kronikor');
 assert.equal(redirect.querySelector('script,iframe,.begrepp-cloud'),null);
 const {readdirSync,readFileSync}=fs, path=require('node:path');
 function check(folder){
   for(const entry of readdirSync(folder,{withFileTypes:true})){
     const name=path.join(folder,entry.name);
     if(entry.isDirectory())check(name);
     else if(entry.name.endsWith('.html')){
       const html=readFileSync(name,'utf8');
       assert.doesNotMatch(html,/data-kr-wordcloud|id="kr-cloud"|(?:src|href)="[^"]*(?:begrepp\.(?:html|js|css)|kr-grid\.js)/,name);
     }
   }
 }
 check('timkronikan');
 const index=JSON.parse(fs.readFileSync('kronikor-index.json','utf8'));
 const monthFiles=fs.readdirSync('timkronikan').filter(name=>/^20\d{2}-\d{2}\.html$/.test(name));
 for(const name of monthFiles){
   const month=new JSDOM(load(name),{url:base+name}).window.document;
   for(const article of month.querySelectorAll('article[id^="inlagg-"]')){
     const row=index.entries.find(entry=>entry.anchor===article.id);
     assert.ok(row,article.id);
     const links=[...article.querySelectorAll('[data-editorial-topic]')];
     assert.deepEqual(links.map(a=>a.textContent).sort(),[...row.terms].sort(),article.id);
     for(const a of links){
       const href=new URL(a.href);
       assert.equal(href.searchParams.get('rt'),a.textContent);
       assert.equal(href.hash,'#kronikor');
       assert.equal(href.pathname,'/explorations/natverk/');
     }
   }
 }
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
