#!/usr/bin/env python3
"""Check local fragments and duplicate IDs; report known source debt explicitly.

Default mode fails on every issue. --check-baseline permits only the two documented
pre-existing EXP8 missing targets, not a claim that its bibliography is repaired.
"""
import argparse
from collections import Counter
from html.parser import HTMLParser
import json
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
KNOWN_MISSING = [
    {"path": "egg-coagulation-lab/index.html", "target": "src-14"},
    {"path": "egg-coagulation-lab/index.html", "target": "src-15"},
]


class Links(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids, self.fragments, self.articles = [], [], []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.append(attrs["id"])
        if tag == "a":
            href = attrs.get("href", "")
            if href.startswith("#") and len(href) > 1:
                self.fragments.append(unquote(href[1:]))
            if "article-card" in attrs.get("class", "").split():
                self.articles.append(href)


def inspect_html(source, path):
    parser = Links()
    parser.feed(source)
    ids = Counter(parser.ids)
    missing = [{"path": path, "target": target} for target in sorted(set(parser.fragments) - ids.keys())]
    duplicates = [{"path": path, "id": target, "count": count} for target, count in sorted(ids.items()) if count > 1]
    return missing, duplicates


def audit(root=ROOT):
    index = Links()
    index.feed((root / "index.html").read_text(encoding="utf-8"))
    missing, duplicates = [], []
    for article in sorted(index.articles):
        file = root / article
        source = file.read_text(encoding="utf-8")
        if article == "ai-environmental-impact/index.html":
            source += "\n" + "\n".join(part.read_text(encoding="utf-8") for part in sorted(file.parent.glob("content-*.html")))
        broken, repeated = inspect_html(source, article)
        missing.extend(broken)
        duplicates.extend(repeated)
    return {"articles": len(index.articles), "missingFragments": missing, "duplicateIds": duplicates}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-baseline", action="store_true")
    args = parser.parse_args()
    result = audit()
    result["knownUnresolved"] = KNOWN_MISSING
    result["sourceSupportVerified"] = False
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if args.check_baseline:
        if result["missingFragments"] == KNOWN_MISSING and not result["duplicateIds"]:
            print("WARNING: two known EXP8 source targets remain unresolved; no new fragment/ID defects.")
        else:
            raise SystemExit("Fragment debt changed: review the findings and update the documented baseline explicitly.")
    elif result["missingFragments"] or result["duplicateIds"]:
        raise SystemExit("Unresolved article fragments or duplicate IDs.")
