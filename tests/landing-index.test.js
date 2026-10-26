const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const ROOT=path.join(__dirname,'..'), E=require('../search-engine.js');
test('index regenerates deterministically and contains all current 33 essays including dynamic fragments',()=>{
 const before=fs.readFileSync(path.join(ROOT,'landing-search-index.json'));cp.execFileSync('python3',['scripts/build_landing_search.py'],{cwd:ROOT});
 assert.deepEqual(fs.readFileSync(path.join(ROOT,'landing-search-index.json')),before);
 const d=JSON.parse(before);assert.equal(d.articles.length,33);assert.ok(d.articles.find(a=>a.slug==='ai-environmental-impact').blocks.length>30);
 const r=E.search(E.prepare(d),'"recalibrating global data center"');assert.ok(r.some(x=>x.slug==='ai-environmental-impact'&&x.hits.some(h=>h.kind==='reference')));
});
test('extractor includes narrative outside article and excludes source notes, quotes, UI and script',()=>{
 const py=`import sys,json;sys.path.insert(0,'scripts');from build_landing_search import extract
s='<main><p>Outside narrative.</p><article><h2 id="x">Heading</h2><p>Inside narrative.</p></article><section class="sources"><ol><li id="src-1"><a href="https://example.org">Actual Book Title</a><span class="source-note">ANNOTATION_ONLY</span><blockquote>SOURCE_QUOTE_ONLY</blockquote></li></ol></section><button>BUTTON_ONLY</button><script>SCRIPT_ONLY</script></main>'
print(json.dumps(extract(s)))`;
 const [blocks,refs,problems]=JSON.parse(cp.execFileSync('python3',['-c',py],{cwd:ROOT,encoding:'utf8'}));
 assert.match(JSON.stringify(blocks),/Outside narrative/);assert.match(JSON.stringify(blocks),/Inside narrative/);
 for(const bad of ['ANNOTATION_ONLY','SOURCE_QUOTE_ONLY','BUTTON_ONLY','SCRIPT_ONLY','Actual Book Title'])assert.ok(!JSON.stringify(blocks).includes(bad));
 assert.deepEqual(refs,[{title:'Actual Book Title',anchor:'src-1',kind:'bibliographic-title-line'}]);assert.deepEqual(problems,[]);
});
test('generic PDF label is not mistaken for a title; explicit authored title outside link is retained',()=>{
 const py=`import sys,json;sys.path.insert(0,'scripts');from build_landing_search import extract
print(json.dumps(extract('<main><article><p>Body</p></article><section class="sources"><ol><li id="s1">Real book title. <a href="https://example.org">PDF</a><span class="source-note">NOTE</span></li><li id="s2"><a href="https://x.org">https://x.org</a></li></ol></section></main>')))`;
 const [,refs,problems]=JSON.parse(cp.execFileSync('python3',['-c',py],{cwd:ROOT,encoding:'utf8'}));assert.equal(refs[0].title,'Real book title');assert.equal(problems.length,1);assert.equal(problems[0].anchor,'s2');
});
test('narrative callouts, definitions and code diagrams are included exactly once',()=>{
 const py=`import sys,json;sys.path.insert(0,'scripts');from build_landing_search import extract
print(json.dumps(extract('<main><article><h2 id="x">Topic</h2><div><strong>Callout:</strong> RAW_NARRATIVE <span>INLINE_DETAIL</span><p>NESTED_PARAGRAPH</p> AFTER_PARAGRAPH</div><dl><dt>DEFINITION_LABEL</dt><dd>DEFINITION_TEXT</dd></dl><pre>DIAGRAM_TEXT</pre></article></main>')))`;
 const [blocks]=JSON.parse(cp.execFileSync('python3',['-c',py],{cwd:ROOT,encoding:'utf8'}));const text=blocks.map(b=>b.text).join(' ');
 for(const token of ['RAW_NARRATIVE','INLINE_DETAIL','NESTED_PARAGRAPH','AFTER_PARAGRAPH','DEFINITION_LABEL','DEFINITION_TEXT','DIAGRAM_TEXT'])assert.equal(text.split(token).length-1,1,token);
});
test('standfirst before main/article is searchable while navigation and TOC are not duplicated',()=>{
 const d=JSON.parse(fs.readFileSync(path.join(ROOT,'landing-search-index.json'))),index=E.prepare(d);
 assert.ok(E.search(index,'"A quiet student waits"').some(a=>a.slug==='support-without-passivity'));
 assert.ok(E.search(index,'"Video has a timeline"').some(a=>a.slug==='the-frame-that-gives-time-back'));
 const py=`import sys,json;sys.path.insert(0,'scripts');from build_landing_search import extract
print(json.dumps(extract('<body><nav>NAV_ONLY</nav><header><h1>Title</h1><p>SUBTITLE_ONLY</p><div class="meta">META_ONLY</div></header><p class="standfirst">STANDFIRST_ONLY</p><main><details class="toc"><ol><li>TOC_ONLY</li></ol></details><article><p>BODY_ONLY</p></article></main><footer>FOOTER_ONLY</footer></body>')))`;
 const [blocks]=JSON.parse(cp.execFileSync('python3',['-c',py],{cwd:ROOT,encoding:'utf8'}));const text=blocks.map(b=>b.text).join(' ');
 for(const yes of ['SUBTITLE_ONLY','STANDFIRST_ONLY','BODY_ONLY'])assert.match(text,new RegExp(yes));for(const no of ['META_ONLY','NAV_ONLY','TOC_ONLY','FOOTER_ONLY'])assert.ok(!text.includes(no));
});
test('clean CI installs pinned test dependencies and checks new deterministic index outputs',()=>{
 const y=fs.readFileSync(path.join(ROOT,'.github/workflows/validate-network.yml'),'utf8');assert.ok(y.indexOf('npm ci --ignore-scripts')<y.indexOf('node --test'));assert.match(y,/git diff --exit-code -- landing-search-index.json docs\/search-index-audit.json/);
});
test('remaining URL-only title debt is counted explicitly, not indexed as invented titles',()=>{
 const audit=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/search-index-audit.json')));
 assert.equal(audit.totalArticles,33);assert.equal(audit.articles.reduce((n,a)=>n+a.unresolvedTitles.length,0),19);assert.equal(audit.externalRequests,0);
 const d=JSON.parse(fs.readFileSync(path.join(ROOT,'landing-search-index.json')));
 for(const a of d.articles)for(const r of a.references){assert.ok(!/^https?:|^(PDF|Full text)$/i.test(r.title));assert.ok(!/✓ Verified|Supports:|Access:/.test(r.title));}
});
test('favicon is linked exactly once per format on all existing pages with valid local assets',()=>{
 const d=JSON.parse(fs.readFileSync(path.join(ROOT,'landing-search-index.json')));
 for(const f of ['index.html','natverk/index.html',...d.articles.map(a=>a.slug+'/index.html')]){
  const s=fs.readFileSync(path.join(ROOT,f),'utf8');for(const kind of ['svg','png','ico'])assert.equal(s.split('data-explorations-favicon="'+kind+'"').length-1,1,f);
 }
 assert.equal(fs.readFileSync(path.join(ROOT,'favicon-16.png')).readUInt32BE(16),16);assert.equal(fs.readFileSync(path.join(ROOT,'favicon-32.png')).readUInt32BE(16),32);
});
test('all five unlinked book/thesis title lines and both Caesar titles are indexed',()=>{
 const data=JSON.parse(fs.readFileSync(path.join(ROOT,'landing-search-index.json')));
 for(const [slug,anchor,title] of [
 ['assessment-validity-reliability','src-4','The Mismeasure of Man'],
 ['nordkalotten-flyttfaglar-radar','src-7','Speeds, Altitudes and Directions of Avian Migration Flight'],
 ['digital-biome','src-8','An Introduction to Cybernetics'],
 ['digital-biome','src-11','Technopoly: The Surrender of Culture to Technology'],
 ['krebs-cycle','src-1','Power, Sex, Suicide: Mitochondria and the Meaning of Life'],
 ['caesar-sallad','src-1','The Disputable History of the Caesar Salad'],
 ['caesar-sallad','src-2','Caesar Cardini & The Origin of the Caesar Salad']])assert.ok(data.articles.find(a=>a.slug===slug).references.find(r=>r.anchor===anchor)?.title.includes(title),slug+' '+anchor);
});
test('generic PDF fallback excludes unclassed annotation paragraphs and source quotations',()=>{
 const py=`import sys,json;sys.path.insert(0,'scripts');from build_landing_search import extract
print(json.dumps(extract('<main><p>Body</p><section class="sources"><ol><li id="s1">Real book title. <a href="https://example.org">PDF</a><blockquote>SOURCE_QUOTE_ONLY</blockquote><p>ANNOTATION_ONLY</p></li></ol></section></main>')))`;
 const [,refs]=JSON.parse(cp.execFileSync('python3',['-c',py],{cwd:ROOT,encoding:'utf8'}));assert.equal(refs[0].title,'Real book title');
});
test('actual exact-phrase results display the matching phrase in the chosen snippet',()=>{
 const index=E.prepare(JSON.parse(fs.readFileSync(path.join(ROOT,'landing-search-index.json'))));
 for(const query of ['"remains an argument"','"campaign continued"']){
  const found=E.search(index,query);assert.ok(found.length);for(const result of found){const snippets=result.hits.filter(h=>h.kind!=='title').slice(0,2).map(h=>E.snippet(h.text,result.query).map(s=>s.text).join(''));assert.ok(snippets.some(s=>s.toLowerCase().includes(query.slice(1,-1))),query+' '+result.slug);}
 }
});
test('reference lists without row IDs jump to the existing Sources heading, not article start',()=>{
 const d=JSON.parse(fs.readFileSync(path.join(ROOT,'landing-search-index.json')));const refs=d.articles.find(a=>a.slug==='the-frame-that-gives-time-back').references;assert.equal(refs.length,19);assert.ok(refs.every(r=>r.anchor==='sources'));
});
test('bibliography prefix and linked title are both retained while navigation prose is excluded',()=>{
 const py=`import sys,json;sys.path.insert(0,'scripts');from build_landing_search import extract
print(json.dumps(extract('<body><a class="skip">SKIP_ONLY</a><span class="subject-badge">BADGE_ONLY</span><article><p>BODY_ONLY</p></article><section class="related-explorations"><p>RELATED_ONLY</p></section><section class="sources"><ol><li>Author (2026). <a href="https://x.org">Actual Title</a><p>ANNOTATION_ONLY</p></li></ol></section></body>')))`;
 const [blocks,refs]=JSON.parse(cp.execFileSync('python3',['-c',py],{cwd:ROOT,encoding:'utf8'}));assert.ok(refs[0].title.includes('Author (2026)'));assert.ok(refs[0].title.includes('Actual Title'));for(const no of ['SKIP_ONLY','BADGE_ONLY','RELATED_ONLY','ANNOTATION_ONLY'])assert.ok(!JSON.stringify(blocks).includes(no));
});
test('forced-dark status uses body metadata, and pressed controls retain readable contrast',()=>{
 const css=fs.readFileSync(path.join(ROOT,'landing.css'),'utf8');assert.match(css,/body\[data-search-ready=true\] \.natverk-rad\{color:var\(--meta\)\}/);
 const lum=hex=>{const c=hex.match(/../g).map(n=>parseInt(n,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
 const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
 assert.ok(contrast('ffffff','b23326')>=4.5);assert.ok(contrast('b7afaa','0f0e10')>=4.5);assert.match(css,/\.read-filter\[aria-pressed="true"\]\{background:#b23326;border-color:#b23326;color:#fff\}/);
});
test('all current article language declarations are preserved in the index',()=>{
 const d=JSON.parse(fs.readFileSync(path.join(ROOT,'landing-search-index.json')));
 for(const a of d.articles){const source=fs.readFileSync(path.join(ROOT,a.slug,'index.html'),'utf8');const declared=source.match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)/i)?.[1];assert.equal(a.language,declared);assert.equal(a.language,'en');}
});
test('AI fragment boundaries preserve runtime empty-separator concatenation and whole words',()=>{
 const dir=path.join(ROOT,'ai-environmental-impact');const source=fs.readFileSync(path.join(dir,'index.html'),'utf8');assert.match(source,/chunks\.join\(''\)/);
 const runtime=fs.readdirSync(dir).filter(n=>/^content-\d+\.html$/.test(n)).sort().map(n=>fs.readFileSync(path.join(dir,n),'utf8')).join('');assert.ok(runtime.includes('AI can support climate'));
 const d=JSON.parse(fs.readFileSync(path.join(ROOT,'landing-search-index.json')));assert.ok(E.search(E.prepare(d),'"AI can support climate"').some(a=>a.slug==='ai-environmental-impact'));
 assert.ok(!d.articles.find(a=>a.slug==='ai-environmental-impact').blocks.some(b=>b.text.includes('AI can supp ort')));
});
test('every current text field tokenizes consistently for retrieval and original-glyph highlighting',()=>{
 const d=JSON.parse(fs.readFileSync(path.join(ROOT,'landing-search-index.json')));
 for(const a of d.articles)for(const text of [a.title,...a.blocks.map(b=>b.text),...a.references.map(r=>r.title)])assert.deepEqual(E.wordSpans(text).map(s=>s.word),E.words(text),a.slug+' '+text.slice(0,45));
});
