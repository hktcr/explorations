import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_chronicle_index import build

TIM = '<article id="inlagg-2026-11-22-2200"><h3>Titel</h3><p class="meta"><time datetime="2026-11-22T22:00">22</time></p><p>Berättelse &amp; mer.</p><aside class="sources"><a href="https://example.test">Källtitel</a></aside><p class="meta">Begrepp: <a href="begrepp.html#ord-test">Redaktionellt begrepp</a></p></article>'
HALF = '<article id="halvtimmen-2026-11-22-0830"><p class="meta"><time datetime="2026-11-22T08:30+01:00">08:30</time> · Vetenskap</p><h3>Händelse</h3><p>Halvtimmesberättelse.</p><aside class="sources"><a href="https://example.test">Vetenskapskälla</a></aside></article>'

class ChronicleBuild(unittest.TestCase):
    def test_verified_public_indexes_from_two_explicit_months_not_grid(self):
        with TemporaryDirectory() as d:
            ro=Path(d)
            a=ro/"timkronikan"
            b=a/"halvtimmen"
            b.mkdir(parents=True)
            for p in (a,b):
                (p/"index.html").touch()
            (a/"2026-11.html").write_text(TIM)
            (b/"2026-11.html").write_text(HALF)
            (a/"skarm.html").write_text(TIM)
            (a/"kr-alla.html").write_text(TIM)
            self.assertEqual(build(ro),2)
            out=ro/"kronikor-index.json"
            old=out.read_bytes()
            self.assertEqual(build(ro),2)
            self.assertEqual(out.read_bytes(),old)
            rows=json.loads(old)["entries"]
            self.assertEqual(["timkronikan","halvtimmen"],[row["series"] for row in rows])
            self.assertEqual(rows[1]["terms"],["Vetenskap"])
            self.assertEqual(rows[0]["terms"],["Redaktionellt begrepp"])
            self.assertEqual(rows[0]["paragraphs"],["Berättelse & mer."])
            self.assertIn("#inlagg-2026-11-22-2200",rows[0]["href"])
            folder=a/"inlagg"
            folder.mkdir()
            detail=folder/"inlagg-2026-11-22-2200.html"
            detail.write_text(TIM)
            build(ro)
            row=json.loads(out.read_text())["entries"][0]
            self.assertEqual(row["href"],"timkronikan/inlagg/inlagg-2026-11-22-2200.html")
            self.assertEqual(row["anchorUrl"],"timkronikan/2026-11.html#inlagg-2026-11-22-2200")
            detail.write_text(HALF)
            with self.assertRaises(ValueError): build(ro)
    def test_reject_mismatched_time_before_writing(self):
        with TemporaryDirectory() as d:
            ro=Path(d)
            a=ro/"timkronikan"; a.mkdir()
            (a/"index.html").touch()
            (a/"2026-11.html").write_text(TIM.replace("T22:00","T21:50"))
            with self.assertRaises(ValueError): build(ro)
            self.assertFalse((ro/"kronikor-index.json").exists())
if __name__=="__main__": unittest.main()
