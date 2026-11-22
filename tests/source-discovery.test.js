const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {JSDOM}=require('jsdom');
const api=require('../kallor.js');
const root=path.resolve(__dirname,'..'), read=p=>fs.readFileSync(path.join(root,p),'utf8');
const index=()=>JSON.parse(read('kallor-index.json'));
test('actual sources can match full authored title, authors, publishers, DOI and chronicle citations',()=>{
 const d=api.validate(index());
 const paper=d.sources.find(r=>r.doi==='10.1098/rspa.1927.0039');
 assert.ok(paper);
 for(const q of ['Dirac Proceedings','quantum theory absorption','10.1098/rspa.1927.0039','https://doi.org/10.1098/rspa.1927.0039'])assert.ok(api.match(paper,q),q);
 assert.equal(api.match(paper,'Dirac no-such-name-ever'),false);
 const tim=d.sources.find(x=>x.title.includes('PFAS')&&x.uses.some(([id])=>id.startsWith('k:')));
 if(tim){assert.ok(api.match(tim,'PFAS'));assert.match(d.texts[tim.uses.find(([id])=>id.startsWith('k:'))[0]].href,/^timkronikan\//);}
});
test('AND requires every chosen source; false edges and duplicate use do not enlarge hit set',()=>{
 const list=['p','q','s'].map(x=>({uses:[[x,''],['shared',''],['shared','#2']]}));
 assert.deepEqual([...api.intersect(list)],['shared']);
 assert.deepEqual([...api.intersect([list[0],{uses:[['r','']]}])],[]);
});
test('stable source hue and pattern; exact same hue in both palettes',()=>{
 const id='src-fabc001200000000', dark=api.style(id), light=api.style(id,true);
 assert.deepEqual(dark,api.style(id));
 assert.equal(dark.glyph,light.glyph);
 assert.equal(dark.dash,light.dash);
 assert.equal(dark.color.split(' ')[0],light.color.split(' ')[0]);
 assert.notEqual(dark.color,light.color);
});
test('invalid external destinations and false use counts never render',()=>{
 for(const edit of [d=>d.sources[0].uses[0][1]='//evil.example/',d=>d.sources[0].url='javascript:alert(1)',d=>d.sources[0].count++]){
   const d=index();edit(d);assert.throws(()=>api.validate(d));
 }
});
test('real controls find a known work, list exact provenance, make graph edges and dim non-matching texts',async()=>{
 const doc=index(), w=new JSDOM(read('kallor/index.html'),{url:'https://example.test/explorations/kallor/',runScripts:'outside-only',pretendToBeVisual:true}).window;
 const id=n=>w.document.getElementById(n);
 const tick=()=>new Promise(r=>setTimeout(r,35));
 w.fetch=async()=>({ok:true,json:async()=>doc});w.eval(read('kallor.js'));
 try{
  await tick();
  assert.ok(id('sourceList').querySelector('.source-record'));
  const q=id('sourceQuery');q.value='rspa.1927.0039';
  q.dispatchEvent(new w.Event('input',{bubbles:true}));await tick();
  const rec=id('sourceList').querySelector('.source-record');
  assert.ok(rec.querySelector('a[href="https://doi.org/10.1098/rspa.1927.0039"]'));
  rec.querySelector('.pick-source').click();
  q.value='Food on the International Space Station';q.dispatchEvent(new w.Event('input',{bubbles:true}));
  id('sourceList').querySelector('.pick-source').click();
  assert.match(id('conditionAnswer').textContent,/0 texter/);
  id('viewGraph').click();await tick();
  assert.equal(id('sourceNodes').querySelectorAll('button').length,2);
  assert.equal(id('sourceTexts').querySelectorAll('[data-dim=true]').length,2);
  assert.equal(id('sourceEdges').querySelectorAll('path').length,2);
  assert.equal(id('sourceConditions').querySelectorAll('button').length,2);
  id('clearConditions').click();
  assert.equal(id('sourceTexts').querySelectorAll('[data-dim=true]').length,0);
 }finally{w.close();}
});
test('two real DOI records share only the documented essay, with stable distinct source hues',()=>{
 const {sources,texts}=api.validate(index());
 const both=['10.3102/00346543211019105','10.1037/a0019682'].map(doi=>sources.find(s=>s.doi===doi));
 assert.ok(both.every(Boolean));
 assert.ok(both.every(s=>s.count>=2));
 assert.deepEqual([...api.intersect(both)].map(k=>texts[k].title),['The Obedient Student May Already Have Left']);
 assert.notEqual(api.style(both[0].id).color,api.style(both[1].id).color);
});
