"""Merge reviewed public bibliography into the citation graph, without inventing uses."""
from hashlib import sha256
import json
import re
import unicodedata
from urllib.parse import unquote, urlsplit

TAG_ID = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*")
DOI_PATH = re.compile(r"/10\.\d{4,9}/[-._;()/:a-z0-9+]+", re.I)

# Additional public publisher paths are reviewed when a new collection needs them.
PUBLISHER_PATHS = {
    "arxiv.org": ("/abs/",),
    "ascd.org": ("/ASCD/pdf/siteASCD/publications/",),
    "assets.publishing.service.gov.uk": ("/media/",),
    "d2tic4wvo1iusb.cloudfront.net": ("/production/eef-guidance-reports/",),
    "edworkingpapers.com": ("/sites/default/files/",),
    "educationendowmentfoundation.org.uk": ("/education-evidence/",),
    "discovery.ucl.ac.uk": ("/id/eprint/",),
    "elevernasriksforbund.se": ("/wp-content/uploads/",),
    "lucris.lub.lu.se": ("/ws/portalfiles/portal/",),
    "skolforskningsportalen.se": ("/digital-publikation/",),
    "mediemyndigheten.se": ("/globalassets/rapporter-och-analyser/",),
    "svenskarnaochinternet.se": ("/rapporter/",),
    "eprints.hud.ac.uk": ("/id/eprint/",),
    "files.eric.ed.gov": ("/fulltext/",),
    "pure.ulster.ac.uk": ("/en/publications/",),
    "www.bostonfed.org": ("/publications/research-department-working-paper/",),
    "www.stir.ac.uk": ("/research/hub/publication/",),
    "www.ifau.se": ("/globalassets/pdf/",),
    "www.imy.se": ("/globalassets/dokument/rapporter/", "/verksamhet/dataskydd/"),
    "www.oecd.org": ("/en/publications/",),
    "www.riksdagen.se": ("/sv/dokument-och-lagar/",),
    "www.skolverket.se": ("/download/", "/sok-publikationer/", "/prov-och-bedomning/",
                          "/larande-och-trygghet/", "/kompetensutveckling/"),
    "www.spsm.se": ("/laromedel/",),
    "www.unicef.org": ("/innocenti/media/",),
    "www.upphandlingsmyndigheten.se": ("/om-hallbar-upphandling/",),
}


def read_manifest(path):
    def distinct(pairs):
        fields = {}
        for key, value in pairs:
            if key in fields:
                raise ValueError("Dubblerat fält i källbiblioteket")
            fields[key] = value
        return fields

    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=distinct)


def strict_fields(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError("Oväntade eller saknade fält i källbiblioteket")


def public_label(value, limit):
    if (not isinstance(value, str) or not 1 <= len(value) <= limit or value != value.strip()
            or any(unicodedata.category(ch).startswith("C") for ch in value)
            or re.search(r"https?:|file:|www\.|[<>@\\]", value, re.I)):
        raise ValueError("Ogiltig publik bibliografisk text")
    return value


def load_taxonomy(raw):
    strict_fields(raw, {"version", "tags"})
    if type(raw["version"]) is not int or raw["version"] != 1 or not isinstance(raw["tags"], list):
        raise ValueError("Okänd taxonomi")
    ids, vocabulary = set(), {}
    for tag in raw["tags"]:
        strict_fields(tag, {"id", "sv", "en", "aliases"})
        key = tag["id"]
        if not isinstance(key, str) or not TAG_ID.fullmatch(key) or key in ids:
            raise ValueError("Ogiltigt eller dubblerat tagg-ID")
        ids.add(key)
        if not isinstance(tag["aliases"], list):
            raise ValueError("Ogiltig lista med taggalias")
        for label in [tag["sv"], tag["en"], *tag["aliases"]]:
            term = unicodedata.normalize("NFKC", public_label(label, 80)).casefold()
            if vocabulary.setdefault(term, key) != key:
                raise ValueError("Ett taggnamn tillhör flera taggar")
    return ids


def public_address(url):
    if (not isinstance(url, str) or not 1 <= len(url) <= 1600
            or re.search(r"[\s<>@\\?#]", url)):
        raise ValueError("Ogiltig eller icke-kanonisk publik källadress")
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.netloc != parts.hostname or not parts.path.startswith("/"):
        raise ValueError("Källan behöver en kanonisk HTTPS-adress")
    path = unquote(parts.path)
    if (any(p in (".", "..") for p in path.split("/")) or "//" in path or "%" in path
            or re.search(r"[\x00-\x20\x7f<>@\\?#]", path)):
        raise ValueError("Ogiltig publicerad källsökväg")
    if parts.hostname == "doi.org" and DOI_PATH.fullmatch(path):
        return path[1:].casefold()
    if not any(path.startswith(p) and len(path) > len(p)
               for p in PUBLISHER_PATHS.get(parts.hostname, ())):
        raise ValueError("Utgivardomän eller sökväg är inte godkänd")
    return ""


def merge_library(groups, library, taxonomy, identity):
    allowed = load_taxonomy(taxonomy)
    strict_fields(library, {"version", "sources"})
    if type(library["version"]) is not int or library["version"] != 1 or not isinstance(library["sources"], list):
        raise ValueError("Okänt format på den publika bibliografin")
    seen = set()
    for rec in library["sources"]:
        strict_fields(rec, {"title", "url", "tags", "summary"} if "summary" in rec else {"title", "url", "tags"})
        title = public_label(rec["title"], 600)
        url = rec["url"]
        doi = public_address(url)
        key = identity(title, url, doi)
        if key in seen:
            raise ValueError("Dubblett i den publika bibliografin")
        seen.add(key)
        tags = rec["tags"]
        if (not isinstance(tags, list) or not all(isinstance(t, str) and t in allowed for t in tags)
                or len(tags) != len(set(tags))):
            raise ValueError("Okänd eller dubblerad tagg")
        group = groups.setdefault(key, dict(id="src-"+sha256(key.encode()).hexdigest()[:16],
                                            labels=set(), urls=set(), doi=doi, uses=[]))
        group["labels"].add(title)
        group["urls"].add(url)
        if "summary" in rec:
            group["summary"] = public_label(rec["summary"], 600)
        group["library"] = True
        group["tags"] = sorted(tags)
