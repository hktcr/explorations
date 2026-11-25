"""Offline checks for the deliberately small public bibliography format."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_sources_index import identity
from source_library import load_taxonomy, merge_library, public_address, read_manifest

TAG = {"id":"education", "sv":"Utbildning", "en":"Education", "aliases":["undervisning"]}
TAXONOMY = {"version":1, "tags":[TAG]}
RECORD = {"title":"A public research title", "url":"https://doi.org/10.1234/EXAMPLE", "tags":["education"]}


def merge(records, groups=None):
    groups = {} if groups is None else groups
    merge_library(groups, {"version":1,"sources":records}, TAXONOMY, identity)
    return groups


class SourceLibraryTest(unittest.TestCase):
    def test_standalone_preserves_empty_uses(self):
        group, = merge([RECORD]).values()
        self.assertTrue(group["library"])
        self.assertEqual(group["uses"], [])
        self.assertEqual(group["doi"], "10.1234/example")
        self.assertEqual(group["tags"], ["education"])

    def test_known_identity_preserves_published_edges(self):
        group = dict(id="existing", labels={"Existing citation"}, urls=set(),
                     doi="10.1234/example", uses=[["known","example/"]])
        groups = {"doi:10.1234/example":group}
        self.assertEqual(len(merge([RECORD],groups)), 1)
        self.assertEqual(group["uses"], [["known","example/"]])
        self.assertEqual(group["id"], "existing")

    def test_reject_unreviewed_keys_duplicates_and_bad_tags(self):
        for records in ([dict(RECORD,extra="field")],[dict(RECORD,tags=["absent"])],
                        [dict(RECORD,tags=["education","education"])],
                        [RECORD,dict(RECORD,url=RECORD["url"].lower())]):
            with self.subTest(records=records), self.assertRaises(ValueError):
                merge(records)

    def test_require_known_publisher_path(self):
        for url in ("http://doi.org/10.1234/example", "https://doi.org/10.1234/test#extra",
                    "https://example.org/articles/1", "https://www.skolverket.se/account/123",
                    "https://www.imy.se/verksamhet/dataskydd/%2e%2e/account",
                    "https://www.skolverket.se/download/file?token=x"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                public_address(url)

    def test_reject_shared_alias_and_duplicate_key(self):
        with self.assertRaises(ValueError):
            load_taxonomy(dict(TAXONOMY,tags=[TAG,dict(TAG,id="another")]))
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"input.json"
            path.write_text('{"version":1,"version":1}')
            with self.assertRaises(ValueError):
                read_manifest(path)
