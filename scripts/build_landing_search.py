#!/usr/bin/env python3
"""Index local essay prose and bibliographic title lines, never fetched sources."""
from __future__ import annotations
from html.parser import HTMLParser
from pathlib import Path
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from build_search_index import parse_cards

VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
SKIP = {'script','style','nav','button','svg','noscript','template','form'}
META_CLASSES = {'source-note','source-claim','source-access','source-tier','source-verified','source-congruence','source-coi','source-verification','source-status','evidence-note','verification'}
GENERIC = re.compile(r'^(?:pdf|full\s*text|source|link|doi|read\s*more|publisher|original|article|webb|källa|länk|https?://\S+|10\.\d{4,9}/\S+)[\s.↗→]*$', re.I)

class Node:
    def __init__(self, tag='', attrs=(), parent=None):
        self.tag, self.attrs, self.parent, self.children = tag, dict(attrs), parent, []
    @property
    def classes(self): return set(self.attrs.get('class','').split())
    def text(self, skip_meta=False):
        if self.tag in SKIP or (skip_meta and self.classes & META_CLASSES): return ''
        if self.tag=='a' and re.match(r'^#(?:src-?\d+|s\d+)$',self.attrs.get('href','')): return ''
        return re.sub(r'\s+', ' ', ''.join(c if isinstance(c,str) else ' '+c.text(skip_meta)+' ' for c in self.children)).strip()
    def walk(self):
        yield self
        for c in self.children:
            if isinstance(c,Node): yield from c.walk()
    def ancestors(self):
        node=self.parent
        while node:
            yield node; node=node.parent

class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.root=Node('root'); self.stack=[self.root]
    def handle_starttag(self,tag,attrs):
        n=Node(tag,attrs,self.stack[-1]); self.stack[-1].children.append(n)
        if tag not in VOID: self.stack.append(n)
    def handle_startendtag(self,tag,attrs): self.handle_starttag(tag,attrs); self.handle_endtag(tag)
    def handle_endtag(self,tag):
        for i in range(len(self.stack)-1,0,-1):
            if self.stack[i].tag==tag: self.stack=self.stack[:i]; break
    def handle_data(self,data): self.stack[-1].children.append(data)

def source_container(n):
    return bool(n.classes & {'sources','sources-section','sources-list','references','reference-list','bibliography'}) or n.attrs.get('id','').lower() in {'sources','sources-and-verification','sources-and-reference-ledger','sources-further-reading','references','bibliography'}

def extract(source):
    tree=Tree(); tree.feed(source); nodes=list(tree.root.walk())
    references=[]; source_nodes=set(); seen=set(); problems=[]
    # Source lists normally have a semantic section/class. Older Frame has a
    # Sources heading followed by a plain list inside the essay itself.
    roots=[n for n in nodes if source_container(n)]
    root_anchors={}
    for n in nodes:
        if n.tag in {'h2','h3','h4'} and re.match(r'^(sources|references|bibliography)(?:\b|$)',n.text(),re.I):
            siblings=n.parent.children; start=siblings.index(n)+1
            for other in siblings[start:]:
                if isinstance(other,Node) and other.tag in {'h2','h3','h4'}: break
                if isinstance(other,Node):
                    roots.append(other)
                    root_anchors[other]=n.attrs.get('id','')
    for root in roots: source_nodes.update(root.walk())
    items=[n for n in nodes if n in source_nodes and (n.tag=='li' or 'source-item' in n.classes)]
    items=[n for n in items if not any(a in items for a in n.ancestors())]
    for n in items:
        links=[a for a in n.walk() if a.tag=='a' and re.match(r'https?://',a.attrs.get('href',''))]
        # A .sources section can also contain a related-essay list. Those local
        # navigation links are not bibliography; unlinked book titles are.
        if not links and any(a.tag=='a' for a in n.walk()): continue
        primary=links[0] if links else None
        # Take the first authored inline citation run, not arbitrary descendant
        # text: later paragraphs, quotes, badges and notes are not title text.
        prefix=[]
        for child in n.children:
            if child is primary: break
            if isinstance(child,str): prefix.append(child)
            elif child.tag in {'p','div','blockquote','ul','ol','br'} or child.classes & META_CLASSES: break
            elif child.tag in {'em','cite'}:
                prefix.append(child.text(skip_meta=True))
                if not primary: break # Exclude an unlinked book's trailing commentary.
            else: prefix.append(child.text(skip_meta=True))
        authored=re.sub(r'\s+',' ',' '.join(prefix)).strip(' .;:').rstrip(' (')
        label=primary.text() if primary else ''
        # Prefix text can be the actual title while the link names its publisher
        # (the two existing Caesar rows); a generic PDF label is never a title.
        if len(authored)>=5: label=authored+(' — '+label if label and not GENERIC.match(label) else '')
        elif not label or GENERIC.match(label): label=''
        if len(label)<5 or GENERIC.match(label):
            problems.append({'anchor':n.attrs.get('id',''),'url':primary.attrs['href'] if primary else '', 'reason':'No authored bibliographic title line'}); continue
        label=re.sub(r'https?://\S+','',label).strip(' .;:')
        anchor=n.attrs.get('id','') or next((root_anchors[a] for a in n.ancestors() if root_anchors.get(a)), '') or next((a.attrs['id'] for a in n.ancestors() if a.attrs.get('id')), '')
        key=(anchor,label)
        if key not in seen:
            references.append({'title':label,'anchor':anchor,'kind':'bibliographic-title-line'}); seen.add(key)
    blocks=[]; heading=''; anchor=''
    headings={'h1','h2','h3','h4','h5','h6'}
    structural=headings|{'main','article','section','aside','header','div','p','li','ul','ol','blockquote','figure','figcaption','table','thead','tbody','tr','td','th','caption','dl','dt','dd','pre'}
    def excluded(n):
        return n in source_nodes or n.tag in SKIP|{'footer','time'} or 'data-xr-exclude' in n.attrs or 'hidden' in n.attrs or n.attrs.get('aria-hidden')=='true' or bool(n.classes & {'related','related-explorations','toolbar','controls','popup','meta','article-meta','card-meta','toc','contents','table-of-contents','badge','subject','subject-badge','skip','skip-link'})
    def visit(n,inside=False):
        nonlocal heading,anchor
        if excluded(n): return
        inside=inside or n.tag in {'body','main','article'}
        if not inside:
            for c in n.children:
                if isinstance(c,Node): visit(c,False)
            return
        if n.tag in headings:
            heading=n.text();anchor=n.attrs.get('id','')
            if heading: blocks.append({'kind':'heading','text':heading,'heading':heading,'anchor':anchor})
            return
        run=[]
        def flush():
            text=re.sub(r'\s+',' ',' '.join(run)).strip();run.clear()
            if text and text!='{{RELATED}}': blocks.append({'kind':'body','text':text,'heading':heading,'anchor':n.attrs.get('id') or anchor})
        # Inline runs preserve callout divs, definitions and code diagrams too.
        # Structural descendants are visited once, never counted a second time.
        for c in n.children:
            if isinstance(c,str): run.append(c)
            elif excluded(c): continue
            elif c.tag in structural: flush();visit(c,True)
            else: run.append(c.text())
        flush()
    visit(tree.root)
    return blocks,references,problems

def load_title_enrichment(path):
    data=json.loads(path.read_text())
    if data.get('schemaVersion')!=1 or data.get('identityReview',{}).get('verdict')!='PASS': raise ValueError('Title metadata requires independent identity review')
    valid_hash=lambda value:isinstance(value,str) and re.fullmatch(r'[0-9a-f]{64}',value) is not None
    if not all(valid_hash(data['identityReview'].get(k)) for k in ['proposalSHA256','reviewSHA256']): raise ValueError('Title review hash attribution missing')
    records={}
    for row in data['entries']:
        key=(row['slug'],row['anchor'],row['originalUrl'])
        if key in records: raise ValueError('Duplicate title enrichment row')
        if row.get('scientificSupportVerified') is not False: raise ValueError('Title metadata is not scientific support verification')
        if row['status'] not in {'verified-title','identity-mismatch','ambiguous-metadata','unavailable','insufficient-identity'}: raise ValueError('Unknown title metadata status')
        if row['status']=='verified-title':
            if not isinstance(row.get('title'),str) or len(row['title'].strip())<5 or GENERIC.match(row['title']): raise ValueError('Missing real title')
            if not row.get('metadataSources') or any(s.get('httpStatus')!=200 or not s.get('url','').startswith('https://') or not s.get('retrievedAtUTC') for s in row['metadataSources']): raise ValueError('Title metadata provenance missing')
            if any(not valid_hash(s.get(k)) for s in row['metadataSources'] for k in ['evidenceSHA256','metadataBytesSHA256']): raise ValueError('Title metadata evidence hash missing')
        if row['classification']=='arXiv-identifier':
            identifier=row.get('versionedIdentifier','')
            original_id=row['originalUrl'].rsplit('/',1)[-1]
            if not re.fullmatch(r'https?://arxiv\.org/abs/'+re.escape(original_id)+r'v[1-9]\d*',identifier): raise ValueError('Exact arXiv version attribution missing')
        if row['status']!='verified-title' and 'title' in row: raise ValueError('Unapproved metadata cannot supply a title')
        records[key]=row
    return records

def apply_title_enrichment(slug,refs,problems,records,matched):
    unresolved=[];enriched=[]
    for problem in problems:
        key=(slug,problem['anchor'],problem['url']);row=records.get(key)
        if row is None:
            unresolved.append(problem);continue
        matched.add(key)
        if row['status']=='verified-title':
            provenance={'originalUrl':row['originalUrl'],'metadataSources':row['metadataSources'],'scientificSupportVerified':False}
            if row.get('versionedIdentifier'): provenance['versionedIdentifier']=row['versionedIdentifier']
            refs.append({'title':row['title'],'anchor':problem['anchor'],'kind':'metadata-title','provenance':provenance})
            enriched.append({'anchor':problem['anchor'],'title':row['title'],**provenance})
        else: unresolved.append({**problem,'metadataStatus':row['status'],'metadataReason':row['reason']})
    return unresolved,enriched

def build():
    articles=[]; audit=[]
    records=load_title_enrichment(ROOT/'docs/reference-title-enrichment.json');matched=set()
    for card in parse_cards():
        path=ROOT/card['slug']/'index.html'; text=path.read_text()
        if card['slug']=='ai-environmental-impact':
            text+='\n'+''.join(p.read_text() for p in sorted(path.parent.glob('content-*.html')))
        blocks,refs,problems=extract(text)
        authored_count=len(refs)
        problems,enriched=apply_title_enrichment(card['slug'],refs,problems,records,matched)
        blocks=[b for b in blocks if not (b['kind']=='heading' and b['text'].casefold()==card['titel'].casefold())]
        if not blocks: raise ValueError('No essay prose: '+card['slug'])
        declared=re.search(r'<html\b[^>]*\blang\s*=\s*["\']([^"\']+)',text,re.I)
        language=declared.group(1) if declared and re.fullmatch(r'[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*',declared.group(1)) else ''
        articles.append({'slug':card['slug'],'id':card['id'],'title':card['titel'],'subject':card['amne'],'excerpt':card['excerpt'],'language':language,'blocks':blocks,'references':refs})
        audit.append({'slug':card['slug'],'bodyBlocks':sum(b['kind']=='body' for b in blocks),'headings':sum(b['kind']=='heading' for b in blocks),'referenceTitleLines':len(refs),'authoredReferenceTitleLines':authored_count,'enrichedReferenceTitles':enriched,'unresolvedTitles':problems})
    if matched!=set(records): raise ValueError('Stale or unauthorized title mapping: original URL/anchor must still match an unresolved source row')
    payload={'schemaVersion':1,'releaseId':'20261025-search-first-5','generatorVersion':'1.3.1','scope':'Local essay prose, headings, authored bibliographic title lines and independently identity-reviewed title metadata. No source annotations or external fulltext. Metadata title identity is not scientific support verification.','articles':articles}
    payload['contentHash']=hashlib.sha256(json.dumps(articles,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    (ROOT/'landing-search-index.json').write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n')
    (ROOT/'docs/search-index-audit.json').write_text(json.dumps({'articles':audit,'totalArticles':len(articles),'totalReferenceTitleLines':sum(len(a['references']) for a in articles),'totalAuthoredReferenceTitleLines':sum(a['authoredReferenceTitleLines'] for a in audit),'totalEnrichedReferenceTitleRows':sum(len(a['enrichedReferenceTitles']) for a in audit),'externalRequests':0,'externalRequestsScope':'Offline index generation only; prior metadata lookups are attributed in reference-title-enrichment.json.'},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'articles':len(articles),'referenceTitleLines':sum(len(a['references']) for a in articles),'unresolvedTitles':[a for a in audit if a['unresolvedTitles']],'bytes':(ROOT/'landing-search-index.json').stat().st_size,'contentHash':payload['contentHash']}))

if __name__=='__main__': build()
