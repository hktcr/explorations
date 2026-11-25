"""Project the contents page from the published format catalogues."""
import json
from html import escape
from build_landing_search import published_briefings


def project(root):
    def data(path):
        return json.loads((root / path).read_text())

    essays = data('natverk-index.json')['artiklar']
    groups = [('Essäer', [(r['titel'], r['slug'] + '/index.html') for r in essays])]
    groups.append(('Vetenskapliga briefingar', [(r['title'], 'vetenskaplig-briefing/' + r['slug'] + '/') for r in published_briefings(root)]))
    editorial = data('kronikor-index-v2.json')
    for series in editorial['collections']:
        groups.append((series['title'], [(r['title'], r['href']) for r in editorial['entries'] if r['series'] == series['id']]))
    chapters = data('skogsvaktaren/bilder.json')
    groups.append(('Där kartan tar slut', [(r['title'], 'skogsvaktaren/' + r['date'] + '.html') for r in reversed(chapters)]))
    options = []
    sections = []
    for i, (label, entries) in enumerate(groups):
        if not entries:
            continue
        items = []
        for title, href in entries:
            path = root / href
            if not (path / 'index.html' if path.is_dir() else path).is_file():
                raise ValueError('Missing contents target: ' + href)
            items.append(f'<li><a href="../{escape(href)}">{escape(title)}</a></li>')
        options.append(f'<option value="g{i}">{escape(label)} ({len(items)})</option>')
        sections.append(f'<section id="g{i}"><h2>{escape(label)}</h2><ul>{"".join(items)}</ul></section>')
    template = (root / 'innehall/mall.html').read_text()
    (root / 'innehall/index.html').write_text(template.replace('<!-- options -->',''.join(options)).replace('<!-- sections -->','\n'.join(sections)))
