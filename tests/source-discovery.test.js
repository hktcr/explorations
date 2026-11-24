const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {JSDOM}=require('jsdom');
const api=require('../kallor.js');
const root=path.resolve(__dirname,'..'), read=p=>fs.readFileSync(path.join(root,p),'utf8');
const index=()=>JSON.parse(read('kallor-index-v2.json'));
test('actual sources can match full authored title, authors, publishers, DOI and chronicle citations',()=>{
 const d=api.validate(index());
 const paper=d.sources.find(r=>r.doi==='10.1098/rspa.1927.0039');
 assert.ok(paper);
 for(const q of ['Dirac Proceedings','quantum theory absorption','10.1098/rspa.1927.0039','https://doi.org/10.1098/rspa.1927.0039'])assert.ok(api.match(paper,q),q);
 assert.equal(api.match(paper,'Dirac no-such-name-ever'),false);
 const tim=d.sources.find(x=>x.title.includes('PFAS')&&x.uses.some(([id])=>id.startsWith('k:')));
 if(tim){assert.ok(api.match(tim,'PFAS'));assert.match(d.texts[tim.uses.find(([id])=>id.startsWith('k:'))[0]].href,/^timkronikan\//);}
});
test('DOI, title and publisher words in one field must all match the same bibliography record',()=>{
 const doi='10.1098/rspa.1927.0039';
 const other='10.1037/a0019682';
 const records=index().sources;
 const hits=q=>records.filter(item=>api.match(item,q)).map(item=>item.doi);
 for(const query of [doi,'https://doi.org/'+doi,'doi: '+doi,'Dirac '+doi,doi+' Proceedings',doi+' '+doi]){
   assert.deepEqual(hits(query),[doi],query);
 }
 for(const query of [doi+' kvantumpotatisnotfound','kvantumpotatisnotfound https://doi.org/'+doi,doi+' '+other,other+' '+doi]){
   assert.deepEqual(hits(query),[],query);
 }
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
 const drawn=[];
 let paint;
 w.matchMedia=()=>({matches:true,addEventListener(){}});
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLCanvasElement.prototype.getContext=()=>paint||=( {
  setTransform(){}, clearRect(){drawn.length=0;}, beginPath(){},moveTo(){},lineTo(){},setLineDash(dash){this.dash=dash;},
  stroke(){drawn.push({color:this.strokeStyle,alpha:this.globalAlpha,dash:this.dash});}
 });
 w.fetch=async()=>({ok:true,json:async()=>doc});w.eval(read('natverk.js'));w.eval(read('kallor.js'));
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
  assert.equal(id('natverkNoder').querySelectorAll('button[data-source]').length,2);
  assert.equal(id('natverkNoder').querySelectorAll('[data-dim=true]').length,2);
  assert.equal(drawn.length,2);
  assert.ok(drawn.every(edge=>edge.alpha<.3));
  const node=[...id('natverkNoder').querySelectorAll('button[data-source]')].at(-1);
  node.click();
  assert.equal(id('relationspanelInnehall').hidden,false);
  assert.ok(id('relationspanelLista').querySelector('button'));
  assert.equal(id('natverkSourceAction').getAttribute('aria-pressed'),'true');
  id('natverkSourceAction').click();
  assert.equal(id('natverkSourceAction').getAttribute('aria-pressed'),'false');
  id('natverkSourceAction').click();
  assert.equal(id('sourceConditions').querySelectorAll('button').length,2);
  id('clearConditions').click();
  assert.equal(id('natverkNoder').querySelectorAll('[data-dim=true]').length,0);
  assert.ok(drawn.every(edge=>edge.alpha>.5));
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
test('source palette distinguishes all simultaneously shown source hues, glyphs and patterns',()=>{
 const close=Array.from({length:8},(_,i)=>({id:'src-abc0000'+i+'22222222'}));
 const paint=[...api.distinguish(close).values()];
 for(const name of ['dark','light','glyph','dash']) assert.equal(new Set(paint.map(p=>p[name])).size,8,name);
});
test('source view keeps curated analysis separate from exact citation edges and uses one painter',async()=>{
 const doc=index(), w=new JSDOM(read('kallor/index.html'),{url:'https://example.test/explorations/kallor/',runScripts:'outside-only',pretendToBeVisual:true}).window;
 const id=n=>w.document.getElementById(n);
 const drawn=[];
 let paint;
 w.matchMedia=()=>({matches:true,addEventListener(){}});
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 const dimension={width:780,height:560};
 Object.defineProperty(w.HTMLElement.prototype,'getBoundingClientRect',{value:()=>dimension});
 w.HTMLCanvasElement.prototype.getContext=()=>paint||=( {
  setTransform(){}, clearRect(){drawn.length=0;}, beginPath(){},moveTo(x,y){this.xy=[x,y];},lineTo(){},setLineDash(dash){this.dash=dash;},
  stroke(){drawn.push({xy:this.xy,color:this.strokeStyle,alpha:this.globalAlpha,dash:Array.from(this.dash)});}
 });
 w.fetch=async u=>({ok:true,json:async()=>String(u).includes('kallor-index')?doc:JSON.parse(read(String(u).includes('relations-curated')?'relations-curated.json':'natverk-index.json'))});
 w.eval(read('natverk.js'));w.eval(read('kallor.js'));
 try{
  await new Promise(r=>setTimeout(r,35));
  for(const doi of ['10.1002/bmb.2005.494033010419','10.1146/annurev.biochem.66.1.717']) {
   id('sourceQuery').value=doi;id('sourceQuery').dispatchEvent(new w.Event('input'));
   id('sourceList').querySelector('.pick-source').click();
  }
  id('viewGraph').click();
  assert.equal(drawn.length,3);assert.deepEqual(drawn.at(-1).dash,[3,3]);
  assert.equal(new Set(drawn.map(e=>e.color)).size,3);
  const coords=[...drawn[0].xy];id('natverkZoomIn').click();assert.notDeepEqual(drawn[0].xy,coords);
  const first=Object.values(doc.texts).find(row=>row.href==='cellular-respiration-demystified/index.html').title;
  [...id('natverkNoder').querySelectorAll('.nod')].find(e=>e.getAttribute('aria-label')===first).click();
  assert.match(id('relationspanelLista').textContent,/Granskat samband · Samma fenomen/);
  assert.match(id('relationspanelLista').textContent,/cellandningens energiflöde/);
  assert.match(id('relationspanelLista').textContent,/Belagd källkoppling/);
  assert.match(id('conditionAnswer').textContent,/0 texter/); // reviewed does not change AND semantics
 }finally{w.close();}
});

test('saved search conditions intersect sets of documents and remain separate from searching a visualized node',async()=>{
 const doc=index(),w=new JSDOM(read('kallor/index.html'),{url:'https://example.test/explorations/kallor/',runScripts:'outside-only',pretendToBeVisual:true}).window;
 w.matchMedia=()=>({matches:true,addEventListener(){}});
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLCanvasElement.prototype.getContext=()=>({setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},setLineDash(){},stroke(){}});
 w.fetch=async u=>({ok:true,json:async()=>String(u).includes('kallor-index')?doc:JSON.parse(read(String(u).includes('relations-curated')?'relations-curated.json':'natverk-index.json'))});
 const id=n=>w.document.getElementById(n);
 function type(field,text){field.value=text;field.dispatchEvent(new w.Event('input'));}
 w.eval(read('natverk.js'));w.eval(read('kallor.js'));
 try {
  await new Promise(r=>setTimeout(r,50));
  assert.ok(id('addSourceTerm').hidden && id('activeConditions').hidden);
  id('viewGraph').click();
  const pageOne=[...id('natverkNoder').querySelectorAll('[data-source]')].map(el=>el.dataset.source);
  assert.equal(pageOne.length,8);
  id('nextSources').click();
  const pageTwo=[...id('natverkNoder').querySelectorAll('[data-source]')].map(el=>el.dataset.source);
  assert.ok(pageTwo.length && pageTwo.every(k=>!pageOne.includes(k)));
  id('viewList').click();
  const terms=['feedback','learning'];
  for (const term of terms){type(id('sourceQuery'),term);assert.equal(id('addSourceTerm').hidden,false);id('addSourceTerm').click();}
  assert.equal(id('sourceConditions').children.length,2);
  const sets=terms.map(term=>new Set(doc.sources.filter(rec=>api.match(rec,term)).flatMap(rec=>rec.uses.map(pair=>pair[0]))));
  const both=[...sets[0]].filter(k=>sets[1].has(k));
  assert.ok(both.length && sets[1].size>both.length);
  assert.deepEqual([...id('conditionAnswer').querySelectorAll('a')].map(a=>a.textContent).sort(),both.map(k=>doc.texts[k].title).sort());
  id('viewGraph').click();type(id('essaSok'),'no-such-node');assert.equal(id('essaAntal').textContent,'0');
  assert.ok(id('natverkNoder').querySelector('[data-dim=true]'));
  type(id('essaSok'),'');assert.ok(id('natverkNoder').querySelector('[aria-description="Uppfyller alla valda villkor"]'));
  id('clearConditions').click();assert.equal(id('activeConditions').hidden,true);
 } finally {w.close();}
});
