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

    def test_third_row_follows_verified_briefing_events(self):
        self.put('index.html', '<dl class="portal-latest">' + START + END +
                 '</dl><!-- portal-recent:start --><!-- portal-recent:end -->')
        folder = 'vetenskaplig-briefing/'
        self.put(folder + 'index.html', '')
        self.assertNotIn('data-latest="briefing"', self.render())
        cards = []
        for slug, title in [('alfa', 'Första'), ('zeta', 'Volt &amp; ampere')]:
            path = folder + slug + '/index.html'
            self.put(path, '<article>Prov</article>')
            cards.insert(0, f'<a data-briefing href="{slug}/">{title}</a>')
            self.put(folder + 'index.html', ''.join(cards))
            html = self.render()
            row = html.split('data-latest="briefing">')[1].split('</div>')[0]
            self.assertIn(f'<dt>Senaste briefingen</dt><dd><a href="{folder}{slug}/">{title}</a>', row)
            self.assertIn('Publiceringstid verifieras', row)
            self.assertEqual(html.count('data-latest="briefing"'), 1)
            self.assertLess(html.index('data-latest="essa"'), html.index('data-latest="briefing"'))
        self.render(receipt=('briefing', path, '2026-11-24T20:26:36Z', 'a'*40))
        self.assertIn('24 november 2026 kl. 21.26', self.render())
        first = folder + 'alfa/index.html'
        self.put(first, '<article>Sakligt reviderad</article>')
        self.render(update=('briefing', first))
        html = self.render(receipt=('briefing', first, '2026-11-25T03:10:00Z', 'b'*40))
        self.assertIn('Uppdaterad <time', html)
        self.assertEqual(html, self.render())
        feed = json.loads((self.root/'portal-senaste.json').read_text())
        self.assertEqual(feed['latestBriefing']['dateLabel'], '25 november 2026 kl. 04.10')
        self.assertEqual(feed['latestBriefing']['href'], folder + 'alfa/')
