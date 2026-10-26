const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../search-engine.js');
const article=(slug,title,text,refs=[])=>({slug,title,id:slug,subject:'Test',excerpt:'',blocks:[{kind:'body',text,anchor:'section',heading:'Heading'}],references:refs});
const run=(articles,q)=>E.search(E.prepare({schemaVersion:1,articles}),q);
test('ranking: title outweighs body, and equal ties use stable slug order',()=>{
 const a=[article('z','Other','protein'),article('a','Other','protein'),article('t','Protein','other')];
 assert.deepEqual(run(a,'protein').map(x=>x.slug),['t','a','z']);assert.deepEqual(run(a.reverse(),'protein').map(x=>x.slug),['t','a','z']);
});
test('ranking: repeated occurrences increase relevance with saturation',()=>{
 const r=run([article('one','Other','protein filler filler filler'),article('four','Other','protein protein protein protein')],'protein');
 assert.equal(r[0].slug,'four');assert.equal(r[0].occurrences,4);assert.ok(r[0].score>r[1].score);
});
test('ranking: equal-frequency long essay does not automatically beat concise essay',()=>{
 const r=run([article('long','Other','protein '+ 'filler '.repeat(1000)),article('short','Other','protein filler')],'protein');
 assert.equal(r[0].slug,'short');
});
test('exact quoted phrases need adjacent whole words within one field',()=>{
 const a=[article('yes','Other','red fox jumps'),article('no','Other','red fast fox'),article('prefix','Other','reddish fox')];
 assert.deepEqual(run(a,'"red fox"').map(x=>x.slug),['yes']);assert.deepEqual(run(a,'”red fox”').map(x=>x.slug),['yes']);
 assert.equal(run(a,'red fox').length,3);
});
test('unquoted adjacent phrase receives bonus; all clauses must match',()=>{
 const a=[article('far','Other','red fast fox'),article('near','Other','red fox fast')];
 assert.equal(run(a,'red fox')[0].slug,'near');assert.equal(run(a,'red unicorn').length,0);
});
test('Swedish diacritics, composed text, Unicode digits and exact short words survive',()=>{
 const a=[article('s','Ångström och AI','bedömning a\u0308mne 2026')];
 for(const q of ['ÅNGSTRÖM','ämne','AI','2026','bedöm'])assert.equal(run(a,q).length,1,q);
 assert.equal(run(a,'amne').length,0);assert.equal(run(a,'bedomning').length,0);
});
test('prefix counts are real occurrences, repeated query tokens do not inflate them',()=>{
 const a=[article('s','Other','proteins proteinase proteome')];
 assert.equal(run(a,'prot')[0].occurrences,3);assert.equal(run(a,'prot prot')[0].occurrences,3);
});
test('reference title lines are searchable and distinguished from body hits',()=>{
 const r=run([article('s','Other','narrative',[{title:'Recalibrating Global Data Center Energy',anchor:'src-3'}])],'"global data center"');
 assert.equal(r.length,1);assert.equal(r[0].hits[0].kind,'reference');assert.equal(r[0].hits[0].anchor,'src-3');
});
test('snippets preserve original Unicode and return text segments, not HTML',()=>{
 const q=E.parseQuery('ämne');const s=E.snippet('<img src=x> Ett a\u0308mne finns här',q);
 assert.equal(s.filter(x=>x.match)[0].text,'a\u0308mne');assert.equal(s.map(x=>x.text).join(''),'<img src=x> Ett a\u0308mne finns här');
});
test('empty, punctuation and unfinished quotes are safe and query length is bounded',()=>{
 assert.deepEqual(run([article('s','Other','text')],'...'),[]);assert.equal(E.parseQuery('a'.repeat(1000)).raw.length,240);
 assert.equal(run([article('s','Other','red fox')],'"red fo').length,1);
});
test('invalid, duplicate or unsafe slugs are rejected',()=>{
 assert.throws(()=>E.prepare({schemaVersion:1,articles:[article('../x','x','x')]}));
 assert.throws(()=>E.prepare({schemaVersion:1,articles:[article('a','x','x'),article('a','x','x')]}));
});
test('repeated unquoted words cannot change scores, phrase bonuses or tie order',()=>{
 const a=[article('a','Other','protein filler protein'),article('z','Other','protein protein filler')];
 assert.deepEqual(run(a,'protein protein').map(({slug,score,occurrences})=>({slug,score,occurrences})),run(a,'protein').map(({slug,score,occurrences})=>({slug,score,occurrences})));
});
test('quoted snippets center and highlight the exact phrase, never isolated prefix words',()=>{
 const text='and and analysis '+ 'filler '.repeat(45)+'this remains an argument about teaching';
 const segments=E.snippet(text,E.parseQuery('"remains an argument"'));
 assert.ok(segments.map(s=>s.text).join('').includes('remains an argument'));
 assert.deepEqual(segments.filter(s=>s.match).map(s=>s.text),['remains an argument']);
 const campaign=E.snippet('continued '+ 'filler '.repeat(45)+'campaign continued afterwards',E.parseQuery('"campaign continued"'));
 assert.ok(campaign.map(s=>s.text).join('').includes('campaign continued'));
 const long='a'.repeat(115)+' '+'b'.repeat(115);assert.ok(E.snippet('prefix '+long+' suffix',E.parseQuery('"'+long+'"')).map(s=>s.text).join('').includes(long));
});
test('NFKC compatibility symbols use identical retrieval/highlighting tokens and original glyphs',()=>{
 for(const text of ['ψ ‾ γ','a\u0308mne','ﬃ ½ ² ℝ','ΟΣ'])assert.deepEqual(E.wordSpans(text).map(s=>s.word),E.words(text));
 const segments=E.snippet('ℒ i n t = − e ψ ‾ γ μ A μ ψ .',E.parseQuery('"ψ ‾ γ"'));assert.deepEqual(segments.filter(s=>s.match).map(s=>s.text),['ψ ‾ γ']);
});
