#!/usr/bin/env python3
"""Build deterministic search and reviewed relationship indexes."""

from __future__ import annotations

import argparse
import hashlib
from html.parser import HTMLParser
import html
import json
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RELEASE = "20260811-network-2"
ALLOWED_TYPES = {"same-phenomenon", "mechanism", "prerequisite", "method-evidence", "application", "contrast", "analogy"}
STOPWORDS = set("a an and are as at be been by can could did do does for from had has have how i if in into is it its may more most no not of on one or our should so some than that the their them then there these they this those through to two under up was we were what when where which while who why will with would you your alla allt att av de den denna det detta en ett efter eller från för genom har här i ingen inte kan man med men mer mot när och om på som så till under ur vad var vara vi vid vilka vilken vilket vår våra är även över http https www doi org com source sources references read min exploration explorations".split())


def norm(value: str) -> str:
    return unicodedata.normalize("NFKC", html.unescape(value)).casefold()


def words(value: str) -> list[str]:
    value = re.sub(r"https?://\S+|www\.\S+", " ", norm(value))
    result, current = [], []
    for char in value:
        category = unicodedata.category(char)
        if category.startswith("L") or (current and category.startswith("M")):
            current.append(char)
        elif current:
            token = "".join(current)
            if len(token) > 2 and token not in STOPWORDS:
                result.append(token)
            current = []
    if current:
        token = "".join(current)
        if len(token) > 2 and token not in STOPWORDS:
            result.append(token)
    return result


class Cards(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.cards, self.card, self.depth, self.capture = [], None, 0, None

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        classes = set((data.get("class") or "").split())
        if tag == "a" and "article-card" in classes:
            self.card = {
                "slug": (data.get("href") or "").split("/")[0],
                "id": data.get("data-exploration-id") or "",
                "titel": data.get("data-title") or "",
                "amne": data.get("data-subject") or "",
                "excerpt": data.get("data-excerpt") or "",
                "datum": "", "lastid": ""
            }
            self.depth = 1
        elif self.card:
            self.depth += 1
            if "card-title" in classes: self.capture = "visible_title"
            elif "card-meta" in classes: self.capture = "meta"

    def handle_endtag(self, tag):
        if not self.card: return
        self.depth -= 1
        if self.depth == 0:
            self.card["titel"] = self.card.get("visible_title", "").strip() or self.card["titel"]
            meta = re.sub(r"\s+", " ", self.card.get("meta", "")).strip()
            parts = [part.strip() for part in meta.split("·", 1)]
            if parts: self.card["datum"] = parts[0]
            if len(parts) > 1: self.card["lastid"] = parts[1]
            self.card.pop("visible_title", None); self.card.pop("meta", None)
            self.cards.append(self.card); self.card = None; self.capture = None
        elif self.capture and tag in {"h2", "div"}: self.capture = None

    def handle_data(self, data):
        if self.card and self.capture:
            self.card[self.capture] = self.card.get(self.capture, "") + data


class Article(HTMLParser):
    SKIP = {"script", "style", "nav", "button", "svg", "noscript"}
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.inside = self.skip = 0
        self.heading = None
        self.heading_id = ""
        self.heading_text = []
        self.current = {"ankare":"", "rubrik":"Ingress", "parts":[]}
        self.sections, self.all_text = [], []

    def handle_starttag(self, tag, attrs):
        if tag == "article": self.inside += 1; return
        if not self.inside: return
        if tag in self.SKIP: self.skip += 1; return
        if self.skip: return
        if tag in {"h2", "h3"}:
            self.flush(); self.heading = tag; self.heading_id = dict(attrs).get("id") or ""; self.heading_text = []

    def handle_endtag(self, tag):
        if tag == "article": self.flush(); self.inside = max(0, self.inside - 1); return
        if not self.inside: return
        if tag in self.SKIP and self.skip: self.skip -= 1; return
        if self.skip: return
        if tag == self.heading:
            title = re.sub(r"\s+", " ", " ".join(self.heading_text)).strip()
            self.current = {"ankare":self.heading_id, "rubrik":title, "parts":[]}
            self.heading = None

    def handle_data(self, data):
        if not self.inside or self.skip: return
        clean = re.sub(r"\s+", " ", data).strip()
        if not clean: return
        if self.heading: self.heading_text.append(clean)
        else: self.current["parts"].append(clean); self.all_text.append(clean)

    def flush(self):
        text = re.sub(r"\s+", " ", " ".join(self.current["parts"])).strip()
        if text:
            self.sections.append({"ankare":self.current["ankare"], "rubrik":self.current["rubrik"], "text":text})
        self.current = {"ankare":"", "rubrik":"Ingress", "parts":[]}


def parse_cards():
    parser = Cards(); parser.feed((ROOT / "index.html").read_text(encoding="utf-8")); return parser.cards


def parse_article(slug):
    path = ROOT / slug / "index.html"
    source = path.read_text(encoding="utf-8")
    if slug == "ai-environmental-impact":
        source += "\n" + "\n".join(p.read_text(encoding="utf-8") for p in sorted(path.parent.glob("content-*.html")))
    parser = Article(); parser.feed(source); parser.flush()
    return parser.sections, " ".join(parser.all_text)


def load_relations(slugs):
    data = json.loads((ROOT / "relations-curated.json").read_text(encoding="utf-8"))
    seen, degrees, relations = set(), {}, []
    for relation in data.get("relations", []):
        key = tuple(sorted((relation.get("a"), relation.get("b"))))
        if relation.get("status") != "reviewed": raise ValueError(f"Unreviewed relation: {key}")
        if relation.get("type") not in ALLOWED_TYPES: raise ValueError(f"Invalid relation type: {key}")
        if not relation.get("reason") or not relation.get("terms"): raise ValueError(f"Missing explanation: {key}")
        if not all(key) or key[0] not in slugs or key[1] not in slugs or key in seen: raise ValueError(f"Invalid relation endpoints: {key}")
        seen.add(key)
        for slug in key: degrees[slug] = degrees.get(slug, 0) + 1
        relation = {**relation, "reviewer":data["reviewer"], "reviewedAt":data["reviewedAt"], "vikt":1}
        relations.append(relation)
    if any(value > 5 for value in degrees.values()): raise ValueError("More than five reviewed relations for a node")
    return data, relations


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build(release):
    cards = parse_cards(); slugs = {card["slug"] for card in cards}
    curated, relations = load_relations(slugs)
    search, network = [], []
    for card in cards:
        sections, full = parse_article(card["slug"])
        frequencies = {}
        for token in words(card["amne"] + " " + card["titel"] + " " + full): frequencies[token] = frequencies.get(token, 0) + 1
        network.append({**card, "ord":len(words(full)), "avsnitt":len(sections), "nyckelord":[item[0] for item in sorted(frequencies.items(), key=lambda item:(-item[1], item[0]))[:6]]})
        search.append({"slug":card["slug"], "titel":card["titel"], "amne":card["amne"], "avsnitt":sections})
    digest = hashlib.sha256(json.dumps([network, search, relations], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]
    common = {"schemaVersion":2, "releaseId":release, "generatorVersion":"2.1.0", "contentHash":digest}
    write(ROOT / "natverk-index.json", {**common, "artiklar":network, "kanter":relations})
    write(ROOT / "sok-index.json", {**common, "artiklar":search})
    print(json.dumps({"articles":len(network), "reviewedRelations":len(relations), "contentHash":digest}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--release", default=DEFAULT_RELEASE)
    build(parser.parse_args().release)
