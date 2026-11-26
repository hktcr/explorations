const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {JSDOM}=require('jsdom');
const read=p=>fs.readFileSync(p,'utf8');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const html=read('noveller/index.html');
const rows=JSON.parse(read('noveller/index.json'));
const code=read('noveller/noveller.js');

test('novellarkivet has real dates, a complete novella and stable publication hashes',()=>{
 const d=new JSDOM(html).window.document;
 assert.equal(new Set(rows.map(r=>r.date)).size,rows.length);
 const row=rows.find(r=>r.slug==='den-tomma-kartan');
 const card=d.getElementById('novell-'+row.date);
 assert.equal(card.dataset.pageSha,sha(fs.readFileSync('noveller/'+row.slug+'.html')));
 assert.equal(card.dataset.imageSha,sha(fs.readFileSync('noveller/'+row.image)));
 assert.ok(row.paragraphs.join(' ').split(/\s+/).length>=700);
 assert.match(read('noveller/'+row.slug+'.html'),/<i>Spodoptera littoralis<\/i>/);
 assert.doesNotMatch(read('noveller/index.json'),/https?:\/\/(?:drive.google.com|chatgpt.com)\//);
});
test('shared themes actually connect stories and combine with search',async()=>{
 const d=new JSDOM(html,{url:'https://site.example/noveller/',runScripts:'outside-only'});
 const row=rows.find(r=>r.slug==='den-tomma-kartan');
 const tag=row.tags[0];
 const original=d.window.document.querySelector('[data-tag]');
 const card=d.window.document.querySelector('[data-story="'+row.slug+'"]');
 const extra=card.cloneNode(true);extra.id='novell-synthetic';extra.dataset.story='syntetiskt-prov';card.after(extra);
 d.window.fetch=async()=>({ok:true,json:async()=>[row,{...row,slug:'syntetiskt-prov',title:'Fiktiv kompass',deck:'Kontroll',tags:[tag],paragraphs:['Magnetism']}]});
 d.window.eval(code);
 await new Promise(r=>setTimeout(r,0));
 assert.equal(d.window.document.querySelector('#tema-nat').querySelectorAll('.wire').length,row.tags.length+1);
 const button=Array.from(d.window.document.querySelectorAll('[data-tag]')).find(b=>b.dataset.tag===tag);
 button.click();
 assert.equal(button.getAttribute('aria-pressed'),'true');
 const input=d.window.document.getElementById('novell-sok');
 input.value='magnetism';input.dispatchEvent(new d.window.Event('input'));
 assert.equal(card.hidden,true);assert.equal(extra.hidden,false);
 assert.equal(d.window.document.querySelectorAll('#tema-nat .wire').length,1);
 original.focus();
 d.window.close();
});

test('novel citations are discoverable by DOI and point back to matching authored relevance',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const root=path.resolve(__dirname,'..');
 const rows=JSON.parse(fs.readFileSync(path.join(root,'noveller/index.json'),'utf8'));
 const index=require('../kallor.js').validate(JSON.parse(fs.readFileSync(path.join(root,'kallor-index-v2.json'),'utf8')));
 for(const r of rows) {
  const id='n:'+r.slug, href='noveller/'+r.slug+'.html#kallor';
  assert.equal(index.texts[id].title,r.title);
  const actual=index.sources.filter(s=>s.uses.some(([x])=>x===id));
  assert.equal(actual.length,r.sources.length);
  for(const item of r.sources) {
   const key=item.url.toLowerCase();
   const row=actual.find(s=>s.url.toLowerCase()===key || (s.doi&&key==='https://doi.org/'+s.doi));
   assert.ok(row,item.url);
   assert.ok(row.uses.some(([x,target])=>x===id&&target===href));
   assert.ok(row.notes.find(n=>n.doc===id&&n.text===item.note.replace(/\*+/g,'')));
  }
 }
});
