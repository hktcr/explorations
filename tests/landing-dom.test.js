// DOM state/interaction tests; jsdom is not rendered browser or screen-reader QA.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),ROOT=path.join(__dirname,'..');
const json=f=>JSON.parse(fs.readFileSync(path.join(ROOT,f),'utf8'));
const tick=()=>new Promise(r=>setImmediate(r));
const delay=()=>new Promise(r=>setTimeout(r,155));
const response=data=>({ok:true,json:async()=>data});
async function harness(options={}){
 const dom=new JSDOM(fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),{url:'https://example.org/explorations/',runScripts:'outside-only',pretendToBeVisual:true});
 await tick();const w=dom.window;w.fetch=url=>url.startsWith('natverk-index')?Promise.resolve(response(json('natverk-index.json'))):(options.fetch?options.fetch():Promise.resolve(response(json('landing-search-index.json'))));
 w.localStorage.setItem('private-comment-sentinel','do-not-touch');
 for(const script of w.document.querySelectorAll('script:not([src])'))w.eval(script.textContent);
 for(const file of ['search-engine.js','landing.js','bibliotek.js'])w.eval(fs.readFileSync(path.join(ROOT,file),'utf8'));
 w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();
 const el=id=>w.document.getElementById(id);
 return{dom,w,el,async type(q){el('searchInput').value=q;el('searchInput').dispatchEvent(new w.Event('input'));await delay();await tick();},click(id){el(id).click();},close(){assert.equal(w.localStorage.getItem('private-comment-sentinel'),'do-not-touch');dom.window.close();}};
}
test('landing starts with search; all original card nodes survive repeated overview transitions',async()=>{
 const h=await harness();try{const cards=[...h.el('articlesGrid').querySelectorAll('.article-card')];assert.equal(cards.length,33);assert.equal(h.w.document.body.dataset.view,'home');assert.ok(h.el('articlesGrid').hidden);
 for(let i=0;i<3;i++){h.click('showAll');assert.equal(h.w.document.body.dataset.view,'all');assert.ok(!h.el('articlesGrid').hidden);assert.equal(h.w.document.activeElement.id,'overviewHeading');h.click('showSearch');}
 assert.deepEqual([...h.el('articlesGrid').querySelectorAll('.article-card')],cards);assert.equal(h.w.document.activeElement.id,'searchInput');}finally{h.close();}
});
test('live search produces relevance results and body/reference snippets without private storage mutation',async()=>{
 const h=await harness();try{await h.type('protein');assert.equal(h.w.document.body.dataset.view,'results');assert.match(h.el('traffar').querySelector('h2 a').href,/egg-coagulation/);assert.ok(h.el('traffar').querySelector('mark'));assert.match(h.el('natverkStatus').textContent,/Sorterade efter relevans/);
 await h.type('"recalibrating global data center"');assert.match(h.el('traffar').textContent,/Källtitelrad/);assert.match(h.el('traffar').querySelector('h2 a').href,/ai-environmental-impact/);}finally{h.close();}
});
test('late index response cannot reopen results after Alla essäer or Escape',async()=>{
 let resolve;const p=new Promise(r=>resolve=r);const h=await harness({fetch:()=>p});try{await h.type('protein');h.click('showAll');resolve(response(json('landing-search-index.json')));await tick();await tick();assert.equal(h.w.document.body.dataset.view,'all');assert.ok(h.el('traffar').hidden);assert.match(h.el('natverkStatus').textContent,/33 essäer/);
 await h.type('protein');h.el('searchInput').dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(h.w.document.body.dataset.view,'home');assert.equal(h.el('searchInput').value,'');assert.equal(h.w.document.activeElement.id,'searchInput');}finally{h.close();}
});
test('failed index gives honest title fallback, keeps all essays accessible, and can retry',async()=>{
 let failed=true;const h=await harness({fetch:()=>failed?Promise.reject(new Error('offline')):Promise.resolve(response(json('landing-search-index.json')))});try{await h.type('thermal');assert.match(h.el('natverkStatus').textContent,/endast essätitlar/);assert.ok(!h.el('retrySearch').hidden);assert.ok(h.el('traffar').querySelector('a'));
 failed=false;h.click('retrySearch');await tick();await tick();assert.match(h.el('natverkStatus').textContent,/Sorterade efter relevans/);assert.ok(h.el('retrySearch').hidden);h.click('showAll');assert.equal(h.el('articlesGrid').querySelectorAll('.article-card').length,33);}finally{h.close();}
});
test('newer queries win races, punctuation/no-results is explicit, and clear restores home',async()=>{
 let resolve;const p=new Promise(r=>resolve=r);const h=await harness({fetch:()=>p});try{await h.type('protein');await h.type('unfindablexyz');resolve(response(json('landing-search-index.json')));await tick();await tick();assert.match(h.el('traffar').textContent,/Ingen träff/);assert.ok(!h.el('traffar').querySelector('h2'));
 h.click('clearSearch');assert.equal(h.w.document.body.dataset.view,'home');assert.equal(h.el('searchInput').value,'');}finally{h.close();}
});
test('restoring URL state preserves query/overview and read-filter behavior',async()=>{
 const h=await harness();try{h.w.history.pushState({},'','?q=protein');h.w.dispatchEvent(new h.w.PopStateEvent('popstate'));await tick();await tick();assert.equal(h.el('searchInput').value,'protein');assert.equal(h.w.document.body.dataset.view,'results');
 h.w.history.pushState({},'','#alla-essaer');h.w.history.replaceState({},'','/explorations/#alla-essaer');h.w.dispatchEvent(new h.w.PopStateEvent('popstate'));assert.equal(h.w.document.body.dataset.view,'all');
 const card=h.el('articlesGrid').querySelector('.article-card');card.dataset.read='true';h.w.explorationsReadFilter.refresh();h.click('readFilter');assert.ok(card.hidden);assert.match(h.el('natverkStatus').textContent,/32 av 33/);h.click('readFilter');assert.ok(!card.hidden);
 assert.equal(h.el('natverkStatus').getAttribute('aria-live'),'polite');assert.equal(h.el('natverkStatus').getAttribute('aria-atomic'),'true');}finally{h.close();}
});
test('actual back/forward history clears failure-only retry when restoring queryless home',async()=>{
 const h=await harness({fetch:()=>Promise.reject(new Error('offline'))});try{
  h.click('showAll');await h.type('thermal');assert.equal(h.el('retrySearch').hidden,false);
  h.w.history.back();await new Promise(r=>setTimeout(r,30));assert.equal(h.w.document.body.dataset.view,'home');assert.equal(h.el('retrySearch').hidden,true);assert.equal(h.el('searchInput').value,'');
  h.w.history.forward();await new Promise(r=>setTimeout(r,30));await tick();assert.equal(h.w.document.body.dataset.view,'results');assert.equal(h.el('retrySearch').hidden,false);
 }finally{h.close();}
});
test('skip target and contextual snippet link labels exist without taking typing focus',async()=>{
 const h=await harness();try{assert.equal(h.w.document.querySelector('.skip-link').getAttribute('href'),'#mainContent');assert.equal(h.el('mainContent').getAttribute('tabindex'),'-1');h.el('searchInput').focus();await h.type('"recalibrating global data center"');const jump=h.el('traffar').querySelector('.snippet-jump');assert.match(jump.getAttribute('aria-label'),/Till källreferensen i sökträff EXP#17, utdrag 1/);assert.equal(h.w.document.activeElement.id,'searchInput');}finally{h.close();}
});
test('Swedish retry and no-JS fallback notices declare their language',async()=>{
 const h=await harness();try{assert.equal(h.el('retrySearch').lang,'sv');assert.match(h.w.document.querySelector('noscript').innerHTML,/lang="sv"/);}finally{h.close();}
});
test('result text uses declared essay language, Swedish UI and unknown bibliography language',async()=>{
 const h=await harness();try{
  await h.type('protein');assert.equal(h.el('traffar').lang,'sv');assert.equal(h.el('traffar').querySelector('h2 a').lang,'en');assert.equal(h.el('traffar').querySelector('.result-kicker').lang,'en');assert.equal(h.el('traffar').querySelector('.snippet-evidence').lang,'en');assert.equal(h.el('traffar').querySelector('.snippet-heading').lang,'en');
  await h.type('"recalibrating global data center"');const evidence=h.el('traffar').querySelector('.snippet-evidence');assert.equal(evidence.getAttribute('lang'),'');assert.match(h.el('traffar').querySelector('.snippet-jump').getAttribute('aria-label'),/^Till källreferensen i sökträff EXP#17, utdrag \d$/);
 }finally{h.close();}
});
test('metadata-enriched title search is labelled as metadata, not verified scientific support',async()=>{
 const h=await harness();try{await h.type('"Radiocarbon dates of two musk ox vertebrae"');assert.match(h.el('traffar').textContent,/Källtitel från bibliografiska metadata/);assert.match(h.el('traffar').querySelector('h2 a').href,/muskoxen-norway/);assert.ok(!h.el('traffar').textContent.includes('Verified'));assert.equal(h.el('traffar').querySelector('.snippet-evidence').getAttribute('lang'),'');}finally{h.close();}
});
