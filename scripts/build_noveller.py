#!/usr/bin/env python3
"""Build the illustrated short-story collection, or add one approved dated manuscript."""
from argparse import ArgumentParser
from collections import Counter
from datetime import date
from hashlib import sha256
from html import escape
from io import BytesIO
import json
from pathlib import Path
import re
from urllib.parse import quote, urlsplit

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO / "noveller"
CATALOG = ROOT / "index.json"
WORDS = re.compile(r"[^\W_]+(?:[-’'][^\W_]+)*")
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")

def inline(value):
    return re.sub(r"\*\*([^*]+)\*\*|\*([^*]+)\*", lambda m: f"<strong>{m[1]}</strong>" if m[1] else f"<i>{m[2]}</i>", escape(value))

def url(value):
    p = urlsplit(value)
    if p.scheme != "https" or not p.hostname or p.username or p.password or p.hostname in {"chatgpt.com", "drive.google.com", "docs.google.com"}:
        raise ValueError("Källorna måste ha verifierade, offentliga HTTPS-länkar")
    return escape(value, quote=True)

def validate(r):
    assert date.fromisoformat(r["date"]).isoformat() == r["date"]
    assert SLUG.fullmatch(r["slug"]) and len(r["slug"]) <= 75
    for k in ("title","deck","alt","caption","research"):
        assert isinstance(r[k],str) and r[k].strip()
    assert isinstance(r["paragraphs"],list) and all(isinstance(s,str) and s.strip() for s in r["paragraphs"])
    assert sum(len(WORDS.findall(p)) for p in r["paragraphs"]) >= 700
    assert 2 <= len(r["tags"]) <= 8 and len(set(t.casefold() for t in r["tags"])) == len(r["tags"])
    assert all(isinstance(t,str) and t == t.strip() and 2 <= len(t) <= 40 for t in r["tags"])
    assert len(r["sources"]) >= 2
    assert len({s["url"].casefold() for s in r["sources"]}) == len(r["sources"])
    for s in r["sources"]:
        assert s["title"].strip() and s["note"].strip()
        url(s["url"])

def page(title, inner, attrs="", extra=""):
    return f'''<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>{escape(title)}</title>
<link rel="icon" href="../favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="../explorations-theme.css"><link rel="stylesheet" href="noveller.css"><script src="../explorations-theme.js" defer></script>{extra}</head>
<body {attrs}><a class="skip" href="#main">Till innehållet</a><header class="mast"><a href="../">Explorations</a><a href="./">Där kartan tar slut</a><span data-xr-theme-slot></span></header><main id="main">{inner}</main></body></html>
'''

def article(r):
    tags=''.join(f'<li><a href="./?tag={escape(quote(t),quote=True)}">{escape(t)}</a></li>' for t in r['tags'])
    src=''.join(f'<li><a href="{url(s["url"])}">{inline(s["title"])}</a><p>{inline(s["note"])}</p></li>' for s in r['sources'])
    body="\n".join(f"<p>{inline(p)}</p>" for p in r["paragraphs"])
    pic=escape(r['image'],quote=True)
    return page(r['title'] + " · Där kartan tar slut",f'''
<article><header class="intro"><p class="eyebrow">Novell · <time datetime="{r['date']}">{r['date']}</time></p><h1>{escape(r['title'])}</h1><p class="deck">{escape(r['deck'])}</p></header>
<figure class="hero"><img src="{pic}" width="{r['width']}" height="{r['height']}" alt="{escape(r['alt'],quote=True)}"><figcaption>{inline(r['caption'])} · AI-illustration</figcaption></figure>
<div class="prose">{body}</div>
<section class="research sources"><p class="eyebrow">Efter berättelsen</p><h2>Vad vet vi?</h2><p>{inline(r['research'])}</p><h2 id="kallor">Källor och deras relevans</h2><ul>{src}</ul><p><a href="../kallor/portal/?q={quote(r['title'])}">Hitta novellens källor i Explorations källdel</a></p></section>
<ul class="tags" aria-label="Teman">{tags}</ul><p class="back"><a href="./">Till alla noveller</a></p></article>''')

def render(rows):
    ordered=sorted(rows,key=lambda r:r['date'],reverse=True)
    seen=set(); dates=set(); pages={}
    for r in ordered:
        validate(r)
        if r['slug'] in seen or r['date'] in dates: raise ValueError("Dubblett i novellsamlingen")
        seen.add(r['slug']);dates.add(r['date'])
        if r['image'] != f"bilder/{r['slug']}-{r['imageSha256']}.webp": raise ValueError("Fel bildadress")
        if sha256((ROOT/r['image']).read_bytes()).hexdigest()!=r['imageSha256']: raise ValueError("Bild stämmer inte")
        pages[r['slug']+'.html']=article(r)
    cards=[]
    for r in ordered:
        href=r['slug']+'.html'; sha=sha256(pages[href].encode()).hexdigest()
        cards.append(f'''<article class="card" id="novell-{r['date']}" data-story="{r['slug']}" data-page-sha="{sha}" data-image-sha="{r['imageSha256']}"><a class="card-image" href="{href}"><img width="{r['width']}" height="{r['height']}" loading="lazy" src="{r['image']}" alt="{escape(r['alt'],quote=True)}"></a><div><p class="eyebrow"><time datetime="{r['date']}">{r['date']}</time></p><h2><a href="{href}">{escape(r['title'])}</a></h2><p>{escape(r['deck'])}</p></div></article>''')
    count=Counter(t for r in ordered for t in r['tags'])
    cloud=''.join(f'<button type="button" data-tag="{escape(t,quote=True)}" data-count="{n}" style="--weight:{min(5,n)}" aria-pressed="false">{escape(t)}</button>' for t,n in sorted(count.items(),key=lambda z:(-z[1],z[0].casefold())))
    pages["index.html"]=page("Där kartan tar slut · Explorations",f'''
<section class="intro"><p class="eyebrow">Explorations / Noveller</p><h1>Där kartan tar slut</h1><p class="deck">Illustrerade noveller från vetenskapens utmarker. Varje historia står för sig. Efter sista scenen finns spåren tillbaka till forskningen.</p></section>
<section class="tools" aria-label="Hitta en novell"><label for="novell-sok">Sök bland noveller</label><input id="novell-sok" type="search" placeholder="Titel, ämne eller ord i berättelsen"><div class="cloud" aria-label="Taggmoln">{cloud}</div><p id="count" role="status"></p><details><summary>Se hur novellerna hänger ihop</summary><p class="graph-intro">Linjerna visar delade teman. Välj ett tema i kartan för att filtrera novellerna.</p><div class="graph-frame"><svg id="tema-nat" role="group" aria-label="Nätverk över noveller och deras teman" viewBox="0 0 600 260"></svg></div></details></section>
<section id="stories" aria-label="Noveller">{''.join(cards)}</section>
<footer><a href="../skogsvaktaren/">Arkiv: de två ursprungliga kapitlen</a></footer>''',extra='<script src="noveller.js" defer></script>')
    return pages

def main():
    parser=ArgumentParser(description=__doc__);parser.add_argument("--story",type=Path);parser.add_argument("--image",type=Path);parser.add_argument("--replace-sha256", help="Revision: SHA-256 för föregående publicerad HTML med samma datum och slug");a=parser.parse_args()
    if a.replace_sha256 and (not a.story or not a.image or not re.fullmatch(r"[0-9a-f]{64}",a.replace_sha256)):
        parser.error("Revision kräver --story, --image och tidigare HTML:s SHA-256")
    rows=json.loads(CATALOG.read_text()) if CATALOG.exists() else []
    if a.story or a.image:
        if not a.story or not a.image: parser.error("Både --story och --image krävs")
        from PIL import Image,ImageOps
        story=json.loads(a.story.read_text()); validate(story)
        with Image.open(a.image) as src:
            im=ImageOps.exif_transpose(src).convert("RGB");im.thumbnail((1600,1600));im.info.clear()
        buf=BytesIO(); im.save(buf,"WEBP",quality=85,method=6); data=buf.getvalue()
        digest=sha256(data).hexdigest(); image=f"bilder/{story['slug']}-{digest}.webp"
        story.update(image=image,imageSha256=digest,width=im.width,height=im.height)
        old=next((r for r in rows if r["date"]==story["date"] or r["slug"]==story["slug"]), None)
        if a.replace_sha256:
            if old is None or (old["date"],old["slug"]) != (story["date"],story["slug"]):
                parser.error("Revision kräver samma datum och slug")
            previous=(ROOT/(old["slug"]+".html")).read_bytes()
            if sha256(previous).hexdigest() != a.replace_sha256:
                parser.error("Tidigare HTML matchar inte revisionskvittot")
            rows.remove(old)
        elif old is not None and old!=story:
            parser.error("Datum eller slug är redan upptaget")
        if not old or a.replace_sha256:
            (ROOT/"bilder").mkdir(exist_ok=True);(ROOT/image).write_bytes(data);rows.append(story)
    pages=render(rows)
    for name,p in pages.items(): (ROOT/name).write_text(p)
    CATALOG.write_text(json.dumps(sorted(rows,key=lambda r:r['date'],reverse=True),ensure_ascii=False,indent=2)+"\n")

if __name__=="__main__":main()
