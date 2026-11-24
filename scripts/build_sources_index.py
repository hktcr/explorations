"""Build the public citation index from authored source lines, never guessed references."""
from collections import defaultdict
from hashlib import sha256
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit, quote

from build_chronicle_index import Read
from build_landing_search import extract

DOI = re.compile(r"10\.\d{4,9}/[\-._;()/:A-Z0-9+%]+", re.I)
def clean(s):
    return " ".join(s.split())

def norm(s):
    return clean(unicodedata.normalize("NFKC", s)).casefold()

def safe_url(s):
    try:
        p=urlsplit(s or "")
        if not p.hostname or p.scheme not in {"https","http"} or p.username or p.password:
            return ""
        if p.hostname in {"localhost","127.0.0.1","0.0.0.0","::1"}:
            return ""
        return urlunsplit(p)
    except ValueError:
        return ""

def identified_doi(url, citation):
    p=urlsplit(url)
    text=unquote(p.path) if p.hostname in {"doi.org","dx.doi.org"} else citation
    found={x.casefold().rstrip(".,;:") for x in DOI.findall(text)}
    return next(iter(found)) if len(found)==1 else ""

def identity(citation,url,doi):
    if doi: return "doi:"+doi
    p=urlsplit(url)
    if url and (p.path.strip("/") or p.query) and p.hostname not in {"doi.org","dx.doi.org"}:
        query=urlencode([(k,v) for k,v in parse_qsl(p.query,keep_blank_values=True) if not (k.startswith("utm_") or k in {"fbclid","gclid"})])
        return "url:"+urlunsplit(("https",p.netloc.casefold(),p.path.rstrip("/"),query,""))
    return "citation:"+norm(citation)

def build_projection(root, version):
    suffix = '' if version == 1 else '-v2'
    essay=json.loads((root/"landing-search-index.json").read_text(encoding="utf-8"))
    chrono=json.loads((root/f"kronikor-index{suffix}.json").read_text(encoding="utf-8"))
    use_by_text={}
    groups={}
    texts={}
    def add(doc,href,citation,url):
        citation=clean(citation)
        if not citation:return
        url=safe_url(url); doi=identified_doi(url,citation)
        if doi: url="https://doi.org/"+quote(doi,safe="/-._;():+")
        key=identity(citation,url,doi)
        group=groups.setdefault(key,dict(id="src-"+sha256(key.encode()).hexdigest()[:16],labels=set(),urls=set(),doi=doi,uses=[]))
        group["labels"].add(citation)
        if url:group["urls"].add(url)
        rec=[doc,href]
        if rec not in group["uses"]:group["uses"].append(rec)
    for row in essay["articles"]:
        slug=row["slug"]
        if not re.fullmatch(r"[a-z0-9-]+",slug):
            raise ValueError("Felaktig essäidentitet")
        p=root/slug/"index.html"
        source=p.read_text(encoding="utf-8")
        if slug=="ai-environmental-impact":
            source+="\n"+"\n".join(x.read_text(encoding="utf-8") for x in sorted(p.parent.glob("content-*.html")))
        _,authored,_=extract(source,include_urls=True)
        raw={(x["anchor"],x["title"]):x.get("originalUrl","") for x in authored}
        doc="e:"+slug
        texts[doc]=dict(title=row["title"],href=f"{slug}/index.html",series="Essä")
        for ref in row["references"]:
            if ref["kind"] not in {"metadata-title","bibliographic-title-line"}:continue
            title,anchor=ref["title"],ref["anchor"]
            href=texts[doc]["href"]+("#"+quote(anchor,safe="-_.:") if anchor else "")
            add(doc,href,title,ref.get("provenance",{}).get("originalUrl") or raw.get((anchor,title),""))
    chron_paths=defaultdict(list)
    for row in chrono["entries"]:
        rel,anchor=row["anchorUrl"].split("#",1)
        report_ok = row.get("series") == "reportage" and re.fullmatch(r"timkronikan/reportage/20\d\d-\d\d-\d\d-(?:lunch|world|varlden)\.html", rel) and anchor == "reportage-" + Path(rel).stem
        chron_ok = row.get("series") in {"timkronikan","halvtimmen"} and re.fullmatch(r"timkronikan/(?:halvtimmen/)?20\d\d-\d\d\.html", rel) and re.fullmatch(r"(?:inlagg|halvtimmen)-20\d\d-\d\d-\d\d-\d{4}", anchor)
        if not (report_ok or chron_ok):
            raise ValueError("Felaktig publik redaktionsidentitet")
        chron_paths[rel].append(row)
    for rel,rows in chron_paths.items():
        tree=Read();tree.feed((root/rel).read_text(encoding="utf-8"));tree.close()
        lookup={n.attrs.get("id",""):n for n in tree.root.traverse("article")}
        for row in rows:
            doc="k:"+row["slug"]
            texts[doc]=dict(title=row["title"],href=row["href"],series={"timkronikan":"Timkrönikan" if version == 1 else "Timmen","halvtimmen":"Halvtimmen","reportage":"Reportage"}[row["series"]])
            entry=lookup.get(row["anchor"])
            if entry is None: raise ValueError("Publikt krönikeankare saknas")
            for n in entry.traverse("aside"):
                if "sources" in n.attrs.get("class","").split():
                    for l in n.traverse("a"):add(doc,row["anchorUrl"],l.text(),l.attrs.get("href",""))
    sources=[]
    for data in groups.values():
        labels=sorted(data["labels"],key=lambda x:(-len(x),norm(x),x))
        urls=sorted(data["urls"],key=lambda u:(not u.startswith("https://"),len(u),u))
        sources.append(dict(id=data["id"],title=labels[0],aliases=labels[1:],doi=data["doi"],
            url=urls[0] if urls else "",uses=sorted(data["uses"]),count=len({x[0] for x in data["uses"]})))
    sources.sort(key=lambda x:(-x["count"],norm(x["title"]),x["id"]))
    output=dict(schemaVersion=version,sources=sources,texts=texts)
    (root/f"kallor-index{suffix}.json").write_text(json.dumps(output,ensure_ascii=False,sort_keys=True,separators=(",",":"))+"\n",encoding="utf-8")
    return len(sources)


def build(root):
    build_projection(root,1)
    return build_projection(root,2)
