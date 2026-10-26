const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const ROOT=path.join(__dirname,'..'),E=require('../search-engine.js'),read=f=>JSON.parse(fs.readFileSync(path.join(ROOT,f))),map=read('docs/reference-title-enrichment.json');
test('title enrichment accounts for exactly25 original rows, only six approved',()=>{
 assert.equal(map.entries.length,25);assert.equal(new Set(map.entries.map(e=>e.originalUrl)).size,15);
 assert.equal(map.entries.filter(e=>e.status==='verified-title').length,6);assert.equal(new Set(map.entries.filter(e=>e.title).map(e=>e.title)).size,4);
 for(const e of map.entries){assert.equal(e.scientificSupportVerified,false);assert.equal('title' in e,e.status==='verified-title');}
 assert.equal(map.entries.filter(e=>e.status==='identity-mismatch').length,2);assert.equal(map.entries.filter(e=>e.status==='insufficient-identity').length,15);
});
test('each enriched title retains exact source anchor/URL and primary metadata attribution',()=>{
 const data=read('landing-search-index.json'),audit=read('docs/search-index-audit.json');
 assert.equal(audit.totalReferenceTitleLines,591);assert.equal(audit.totalAuthoredReferenceTitleLines,585);assert.equal(audit.totalEnrichedReferenceTitleRows,6);assert.equal(audit.articles.reduce((n,a)=>n+a.unresolvedTitles.length,0),19);
 for(const e of map.entries.filter(e=>e.status==='verified-title')){
  const article=data.articles.find(a=>a.slug===e.slug),ref=article.references.find(r=>r.anchor===e.anchor);assert.equal(ref.title,e.title);assert.equal(ref.kind,'metadata-title');assert.equal(ref.provenance.originalUrl,e.originalUrl);assert.deepEqual(ref.provenance.metadataSources,e.metadataSources);assert.equal(ref.provenance.scientificSupportVerified,false);
  const result=E.search(E.prepare(data),'"'+e.title+'"').find(a=>a.slug===e.slug);assert.ok(result,e.slug+'#'+e.anchor);assert.ok(result.hits.some(h=>h.kind==='reference'&&h.titleSource==='metadata'));
 }
});
test('wrong/ambiguous/unavailable/general-portal identities never become reference titles',()=>{
 const data=read('landing-search-index.json'),audit=read('docs/search-index-audit.json');
 for(const e of map.entries.filter(e=>e.status!=='verified-title')){assert.ok(!data.articles.find(a=>a.slug===e.slug).references.some(r=>r.anchor===e.anchor));assert.equal(audit.articles.find(a=>a.slug===e.slug).unresolvedTitles.find(r=>r.anchor===e.anchor).metadataStatus,e.status);}
 assert.ok(!data.articles.find(a=>a.slug==='dark-matter-dark-energy').references.some(r=>/Treason of Isengard|Hate Speech Detection/.test(r.title)));
});
test('metadata loader rejects duplicate, unreviewed, provenance-free and scientific-support claims',()=>{
 const py=`import sys,json,tempfile,pathlib,copy;sys.path.insert(0,'scripts');from build_landing_search import load_title_enrichment
base=json.load(open('docs/reference-title-enrichment.json')); results=[]
for change in ['duplicate','review','support','unapproved-title','provenance','status']:
 d=copy.deepcopy(base)
 if change=='duplicate':d['entries'].append(d['entries'][0])
 if change=='review':d['identityReview']['verdict']='PENDING'
 if change=='support':d['entries'][0]['scientificSupportVerified']=True
 if change=='unapproved-title':next(e for e in d['entries'] if e['status']!='verified-title')['title']='Fake title'
 if change=='provenance':next(e for e in d['entries'] if e['status']=='verified-title')['metadataSources']=[]
 if change=='status':d['entries'][0]['status']='unknown'
 with tempfile.TemporaryDirectory() as t:
  p=pathlib.Path(t)/'map.json';p.write_text(json.dumps(d))
  try:load_title_enrichment(p);results.append(False)
  except ValueError:results.append(True)
print(json.dumps(results))`;
 assert.deepEqual(JSON.parse(cp.execFileSync('python3',['-c',py],{cwd:ROOT,encoding:'utf8'})),Array(6).fill(true));
});
test('generator rejects changed original URLs rather than silently reusing metadata',()=>{
 const py=`import sys,tempfile,pathlib,json;sys.path.insert(0,'scripts');import build_landing_search as m
with tempfile.TemporaryDirectory() as t:
 root=pathlib.Path(t);(root/'docs').mkdir();(root/'test').mkdir();(root/'test/index.html').write_text('<html lang="en"><body><article><p>Narrative</p></article><section class="sources"><ol><li id="src-1"><a href="https://example.org/current">https://example.org/current</a></li></ol></section></body></html>')
 d={'schemaVersion':1,'identityReview':{'verdict':'PASS','proposalSHA256':'a'*64,'reviewSHA256':'b'*64},'entries':[{'slug':'test','anchor':'src-1','originalUrl':'https://example.org/old','status':'verified-title','classification':'DOI','title':'Fixture title','scientificSupportVerified':False,'metadataSources':[{'url':'https://example.org/metadata','httpStatus':200,'retrievedAtUTC':'2026-10-25T00:00:00Z','evidenceSHA256':'c'*64,'metadataBytesSHA256':'d'*64}]}]};(root/'docs/reference-title-enrichment.json').write_text(json.dumps(d));m.ROOT=root;m.parse_cards=lambda:[{'slug':'test','id':'EXP#1','titel':'Title','amne':'Test','excerpt':''}]
 try:m.build();print('NOT_REJECTED')
 except ValueError as e:print(str(e))`;
 assert.match(cp.execFileSync('python3',['-c',py],{cwd:ROOT,encoding:'utf8'}),/Stale or unauthorized title mapping/);
});
test('portable arXiv provenance retains approved and quarantined versions without changing URLs',()=>{
 const approved=map.entries.find(e=>e.originalUrl==='https://arxiv.org/abs/2404.03002'),quarantined=map.entries.find(e=>e.originalUrl==='https://arxiv.org/abs/2410.08053');
 assert.equal(approved.versionedIdentifier,'http://arxiv.org/abs/2404.03002v3');assert.equal(quarantined.versionedIdentifier,'http://arxiv.org/abs/2410.08053v1');
 const ref=read('landing-search-index.json').articles.find(a=>a.slug==='dark-matter-dark-energy').references.find(r=>r.anchor==='src-10');assert.equal(ref.provenance.versionedIdentifier,approved.versionedIdentifier);assert.equal(ref.provenance.originalUrl,approved.originalUrl);
});
test('missing or malformed evidence/review hashes and missing arXiv version fail closed',()=>{
 const py=`import sys,json,tempfile,pathlib,copy;sys.path.insert(0,'scripts');from build_landing_search import load_title_enrichment
base=json.load(open('docs/reference-title-enrichment.json'));results=[]
for change in ['reviewhash','proposalhash','evidencehash','rawhash','version','wrongversion']:
 d=copy.deepcopy(base)
 if change=='reviewhash':d['identityReview'].pop('reviewSHA256')
 if change=='proposalhash':d['identityReview']['proposalSHA256']='bad'
 approved=next(e for e in d['entries'] if e['status']=='verified-title')
 if change=='evidencehash':approved['metadataSources'][0].pop('evidenceSHA256')
 if change=='rawhash':approved['metadataSources'][0]['metadataBytesSHA256']='bad'
 arxiv=next(e for e in d['entries'] if e['classification']=='arXiv-identifier')
 if change=='version':arxiv.pop('versionedIdentifier')
 if change=='wrongversion':arxiv['versionedIdentifier']='https://arxiv.org/abs/0000.00000v3'
 with tempfile.TemporaryDirectory() as t:
  p=pathlib.Path(t)/'map.json';p.write_text(json.dumps(d))
  try:load_title_enrichment(p);results.append(False)
  except ValueError:results.append(True)
print(json.dumps(results))`;
 assert.deepEqual(JSON.parse(cp.execFileSync('python3',['-c',py],{cwd:ROOT,encoding:'utf8'})),Array(6).fill(true));
});
