import json
from pathlib import Path
from tempfile import TemporaryDirectory
import sys
from unittest import TestCase

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from portal_latest import START, END, STATE, project


class PortalEditions(TestCase):
    def setUp(self):
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.put('index.html', START + END)
        self.news = {'href': 'timkronikan/inlagg/heltimme.html', 'title': 'Första', 'date': '2026-11-24T07:00+01:00', 'series': 'timkronikan'}
        self.put(self.news['href'], 'Publik Timmen')
        self.essay = {'id': 'EXP#1', 'title': 'Essä', 'path': 'essa/index.html'}
        self.put(self.essay['path'], 'Publik essä')
        self.put('sok-index.json', {'artiklar':[{'slug':'essa'}]})
        self.put('kronikor-index.json', {'entries': [self.news]})
        self.put('reflections/article-registry.json', {'articles': [self.essay]})
        self.put('timkronikan/reportage/index.html', '<main></main>')
        self.put(STATE, {'known':{'redaktionen':[], 'essa':[]}, 'events':{'redaktionen':[], 'essa':[]}})

    def put(self, name, data):
        dest = self.root/name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(data if isinstance(data, str) else json.dumps(data),encoding='utf-8')

    def render(self, **args):
        project(self.root, **args)
        return (self.root/'index.html').read_text()

    def test_receipt_and_technical_change(self):
        first = self.render()
        self.assertIn('Utgåva <time', first)
        self.assertIn('Publiceringstid verifieras', first)
        commit = 'a'*40
        saved = self.render(receipt=('redaktionen', self.news['href'], '2026-11-24T06:31:49Z', commit))
        self.assertIn('07.31', saved)
        self.assertEqual(saved, self.render())
        self.put(self.news['href'], '<article class="ny-layout">Publik Timmen</article>')
        self.assertEqual(saved, self.render())
        changed = self.render(update=('redaktionen', self.news['href']))
        self.assertIn('Tid för sakuppdatering verifieras', changed)
        self.assertEqual(changed, self.render(update=('redaktionen', self.news['href'])))
        done = self.render(receipt=('redaktionen', self.news['href'], '2026-11-25T06:52:00Z', 'b'*40))
        self.assertIn('Uppdaterad <time', done)
        self.assertEqual(done, self.render(update=('redaktionen', self.news['href'])))
        with self.assertRaises(ValueError):
            self.render(receipt=('redaktionen', self.news['href'], '2026-10-05T06:31:00Z', commit))

    def test_new_report_then_backfilled_half_and_essay(self):
        self.render()
        self.put('timkronikan/reportage/natt.html','Publikt reportage')
        self.put('timkronikan/reportage/index.html','<a class="card" href="natt.html"><h2>Ett reportage</h2><time datetime="2026-11-24">24 november</time></a>')
        self.assertIn('Ett reportage', self.render())
        self.put('timkronikan/inlagg/halvtimme.html','Publik Halvtimmen')
        half = dict(self.news, href='timkronikan/inlagg/halvtimme.html', title='En återhämtad halvtimme',series='halvtimmen',date='2026-11-22T10:30+01:00')
        self.put('kronikor-index.json', {'entries':[self.news,half]})
        self.put('essa2/index.html','Publik essä två')
        self.put('reflections/article-registry.json', {'articles':[self.essay, {'id':'EXP#2','path':'essa2/index.html','title':'Essä två'}]})
        self.assertNotIn('Essä två',self.render())  # A file and a registry row alone are unpublished.
        self.put('sok-index.json', {'artiklar':[{'slug':'essa'}, {'slug':'essa2'}]})
        result = self.render()
        self.assertIn('En återhämtad halvtimme',result)
        self.assertIn('Essä två',result)
        self.assertNotIn('Ett reportage',result)
        self.assertIn('22 november 2026 kl. 10.30',result)
        self.assertEqual(result,self.render())
        self.assertNotIn('Ett reportage',self.render(receipt=('redaktionen','timkronikan/reportage/natt.html','2026-11-23T06:00:00Z','c'*40)))

    def test_publisher_reads_exact_commit_and_deployment(self):
        from unittest.mock import patch
        from portal_publication_receipt import verify_and_project
        self.render()
        commit, parent = 'a'*40, 'b'*40
        href = self.news['href']
        state = (self.root/STATE).read_bytes()
        previous = json.dumps({'events': {'redaktionen': []}}).encode()
        transport = []
        def stored(name, sha):
            if name == href and sha == commit:
                return b'Publik Timmen'
            assert name == STATE and sha in (commit,parent)
            return state if sha == commit else previous
        def fetch(url):
            transport.append(url)
            if url.endswith('/'+href):
                return b'Publik Timmen'
            if '/git/commits/' in url:
                return json.dumps({'sha':commit, 'parents':[{'sha':parent}]}).encode()
            if '/deployments?' in url:
                return json.dumps([{'id':1234, 'environment':'github-pages','sha':commit}]).encode()
            if '/statuses?' in url:
                return json.dumps([{'state':'success','created_at':'2026-11-24T06:31:49Z'}]).encode()
            raise AssertionError(url)
        with patch('portal_publication_receipt.ROOT',self.root), patch('portal_publication_receipt.stored',side_effect=stored), patch('portal_publication_receipt.get',side_effect=fetch):
            verify_and_project('redaktionen',href,commit)
            self.assertIn('07.31',self.render())
            previous = state
            with self.assertRaisesRegex(ValueError,'tillkom inte'):
                verify_and_project('redaktionen',href,commit)
        self.assertTrue(any('github-pages' in url for url in transport))


class LatestBriefing(TestCase):
    def test_home_uses_catalogue_order_and_preserves_other_formats(self):
        from build_landing_search import published_briefings, project_latest_briefing

        with TemporaryDirectory() as directory:
            root = Path(directory)
            catalog = root / 'vetenskaplig-briefing'
            catalog.mkdir()
            home = root / 'index.html'
            head = ('<div data-latest="redaktionen">Nyhet</div><div data-latest="essa">Essä</div>'
                    '<h2><a href="vetenskaplig-briefing/">Vetenskaplig briefing</a></h2>')
            start, end = '<!-- latest-briefing:start -->', '<!-- latest-briefing:end -->'
            home.write_text(head + start + end)
            links = []
            for slug, title in [('alfa','Första'), ('zeta','Volt &amp; ampere')]:
                (catalog/slug).mkdir()
                (catalog/slug/'index.html').write_text(
                    f'<html lang="sv"><article><h1>{title}</h1><p>Brödtext.</p></article></html>')
                links.insert(0, f'<a data-briefing href="{slug}/">{title}</a>')
                (catalog/'index.html').write_text('\n'.join(links))
                briefings = published_briefings(root)
                project_latest_briefing(home, briefings)
                markup = home.read_text()
                self.assertTrue(markup.startswith(head + start))
                self.assertEqual(markup.count('data-latest-briefing'), 1)
                self.assertIn(f'href="vetenskaplig-briefing/{slug}/"', markup)
                self.assertIn(f'{title}</a>', markup)
                project_latest_briefing(home, briefings)
                self.assertEqual(markup, home.read_text())
            (catalog/'index.html').write_text('<h1>Vetenskaplig briefing</h1>')
            project_latest_briefing(home, published_briefings(root))
            self.assertEqual(home.read_text(), head + start + '\n' + end)
