#!/usr/bin/env python3
"""Index only public chronicle article sections in the generated archive."""
from dataclasses import dataclass, field
from datetime import datetime
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from collections import Counter
from zoneinfo import ZoneInfo

SERIES = (
    ("timkronikan", "Timmen", "timkronikan", "inlagg-"),
    ("halvtimmen", "Halvtimmen", "timkronikan/halvtimmen", "halvtimmen-"),
)
MONTH = re.compile(r"20\d\d-(0[1-9]|1[0-2])\.html$")
VOID = set("area base br col embed hr img input link meta param source track wbr".split())
DROP = set("script style nav".split())
STOCKHOLM = ZoneInfo("Europe/Stockholm")

@dataclass
class Node:
    tag: str
    attrs: dict
    children: list = field(default_factory=list)

    def text(self):
        if self.tag in DROP:
            return ""
        return "".join(x.text() if isinstance(x, Node) else x for x in self.children)

    def traverse(self, tag):
        for child in self.children:
            if isinstance(child, Node):
                if child.tag == tag:
                    yield child
                yield from child.traverse(tag)

class Read(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = [Node("root", {})]
        self.root = self.stack[0]

    def handle_starttag(self, tag, attrs):
        n = Node(tag, dict(attrs))
        self.stack[-1].children.append(n)
        if tag not in VOID:
            self.stack.append(n)

    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1,0,-1):
            if self.stack[i].tag == tag:
                self.stack = self.stack[:i]
                break

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_data(self, data):
        if self.stack[-1].tag not in DROP:
            self.stack[-1].children.append(data)

def clean(s):
    return " ".join(s.split())

def entries(path, month, key, name, prefix):
    parsed = Read()
    parsed.feed(path.read_text(encoding="utf-8"))
    parsed.close()
    for node in parsed.root.traverse("article"):
        ident = node.attrs.get("id", "")
        if not re.fullmatch(re.escape(prefix) + r"20\d\d-\d\d-\d\d-\d{4}", ident):
            continue
        ts = next((x.attrs.get("datetime") for x in node.traverse("time") if x.attrs.get("datetime")), None)
        title = next((clean(x.text()) for x in node.children if isinstance(x, Node) and x.tag in {"h2","h3"}), None)
        body, terms, refs = [], [], []
        for item in node.children:
            if not isinstance(item, Node):
                continue
            cs = item.attrs.get("class", "").split()
            if item.tag == "p" and "meta" not in cs:
                body.append(clean(item.text()))
            elif item.tag == "p" and item.text().lstrip().startswith("Begrepp:"):
                terms += [clean(a.text()) for a in item.traverse("a")
                          if "data-editorial-topic" in a.attrs or a.attrs.get("href", "").startswith("begrepp.html#ord-")]
            elif item.tag == "p" and key == "halvtimmen" and "meta" in cs and "·" in item.text():
                terms.append(clean(item.text().split("·")[-1]))
            elif item.tag == "aside" and "sources" in cs:
                refs += [clean(a.text()) for a in item.traverse("a")]
        if not ts or not title or not any(body) or not refs:
            raise ValueError(f"Ofullständig publik krönika: {path.name}#{ident}")
        dt = datetime.fromisoformat(ts)
        dt = dt.replace(tzinfo=STOCKHOLM) if dt.tzinfo is None else dt.astimezone(STOCKHOLM)
        if dt.strftime("%Y-%m-%d-%H%M") != ident[len(prefix):] or dt.strftime("%Y-%m") != month:
            raise ValueError(f"Tid eller ankare stämmer inte: {path.name}#{ident}")
        yield dict(slug=f"{key}-{ident.removeprefix(prefix)}", title=title, date=dt.isoformat(timespec="minutes"),
                   series=key, excerpt=next(p for p in body if p), terms=sorted(set(filter(None,terms)),key=str.casefold),
                   paragraphs=list(filter(None,body)), references=list(filter(None,refs)), anchor=ident)

def reports(root, collections, rows, seen):
    rel = "timkronikan/reportage"
    parent = root / rel
    if not (parent / "index.html").is_file():
        return
    picked = []
    for path in sorted(parent.glob("20??-??-??-*.html")):
        m = re.fullmatch(r"(20\d\d-\d\d-\d\d)-(lunch|world|varlden)\.html", path.name)
        if not m:
            continue
        day, kind = m.groups()
        datetime.fromisoformat(day)  # Valid calendar date; don't invent a clock time.
        ident = "reportage-" + m[0].removesuffix(".html")
        parsed = Read()
        parsed.feed(path.read_text(encoding="utf-8"))
        parsed.close()
        candidates = [a for a in parsed.root.traverse("article") if a.attrs.get("id") == ident]
        if len(candidates) != 1 or ident in seen:
            raise ValueError(f"Fel identitet i reportage: {path}")
        node = candidates[0]
        title = next((clean(x.text()) for x in node.traverse("h1")), "")
        declared = next((x.attrs.get("datetime") for x in node.traverse("time")), "")
        lead = next((clean(x.text()) for x in node.traverse("p") if x.attrs.get("class") == "deck"), "")
        theme = next((clean(x.text()) for x in node.traverse("p") if x.attrs.get("class") == "kicker"), "")
        body = [clean(p.text()) for div in node.traverse("div") if div.attrs.get("class") == "story-body"
                for p in div.children if isinstance(p, Node) and p.tag == "p"]
        refs = [clean(a.text()) for n in node.traverse("aside") if "sources" in n.attrs.get("class","").split()
                for a in n.traverse("a")]
        if not all((title, lead, body, refs)) or declared != day:
            raise ValueError(f"Ofullständigt publikt reportage: {path}")
        seen.add(ident)
        href = f"{rel}/{path.name}"
        terms = [theme.split("·",1)[-1].strip()] if theme else []
        picked.append(dict(slug=ident,title=title,date=day,series="reportage",excerpt=lead,terms=terms,
                           paragraphs=body,references=refs,anchor=ident,href=href,anchorUrl=f"{href}#{ident}"))
    tags = Counter(tag for item in picked for tag in item["terms"])
    collections.append(dict(id="reportage",title="Reportage",href=rel+"/",count=len(picked),
                            topics=[dict(label=k,count=v) for k,v in sorted(tags.items(),key=lambda x:(-x[1],x[0].casefold()))]))
    rows.extend(picked)

def build(root):
    collections, rows, seen = [], [], set()
    for key, name, rel, prefix in SERIES:
        parent = root / rel
        if not (parent / "index.html").is_file():
            continue
        picked = []
        for path in sorted(parent.glob("20??-??.html")):
            if not MONTH.fullmatch(path.name):
                raise ValueError(f"Felaktigt månadskapitel: {path}")
            for item in entries(path,path.stem,key,name,prefix):
                if item["slug"] in seen:
                    raise ValueError(f"Dubbel post: {item['slug']}")
                seen.add(item["slug"])
                anchor_url = f"{rel}/{path.name}#{item['anchor']}"
                details = f"timkronikan/inlagg/{item['anchor']}.html"
                candidate = root / details
                if candidate.is_file():
                    detail_parser=Read()
                    detail_parser.feed(candidate.read_text(encoding="utf-8"))
                    detail_parser.close()
                    if not any(n.attrs.get("id")==item["anchor"] for n in detail_parser.root.traverse("article")):
                        raise ValueError(f"Fel identitet i detaljvy: {details}")
                    preferred = details
                else:
                    preferred = anchor_url
                picked.append({**item, "href":preferred, "anchorUrl":anchor_url})
        tags = Counter(tag for item in picked for tag in item["terms"])
        collections.append(dict(id=key,title=name,href=rel+"/",count=len(picked),topics=[
            dict(label=k,count=v) for k,v in sorted(tags.items(),key=lambda x:(-x[1],x[0].casefold()))
        ]))
        rows += picked
    def save(name, version, catalogs, entries):
        payload=dict(schemaVersion=version,collections=catalogs,entries=entries)
        (root/name).write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    rows.sort(key=lambda x:(-datetime.fromisoformat(x["date"]).timestamp(),x["slug"]))
    legacy=[{**c,"title":"Timkrönikan"} if c["id"]=="timkronikan" else c for c in collections]
    save("kronikor-index.json",1,legacy,rows)
    reports(root, collections, rows, seen)
    def timestamp(value):
        d = datetime.fromisoformat(value)
        return (d.replace(tzinfo=STOCKHOLM) if d.tzinfo is None else d).timestamp()
    rows.sort(key=lambda x:(-timestamp(x["date"]), x["slug"]))
    save("kronikor-index-v2.json",2,collections,rows)
    return len(rows)
