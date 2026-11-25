"""Project the contents page from public catalogues and receipted publication events."""
import json
import re
from html import escape

from build_landing_search import Tree, published_briefings
from portal_latest import display_date, timestamp


def catalogue_cards(path):
    page = Tree()
    page.feed(path.read_text(encoding='utf-8'))
    return page.root.walk()


def topics_by_path(root):
    topics = {}
    for card in catalogue_cards(root / 'index.html'):
        if 'article-card' in card.classes:
            label = next((n for n in card.walk() if 'card-subject' in n.classes), None)
            if label:
                topics[card.attrs['href']] = [
                    term.strip() for term in re.split('[·•]', label.text())
                    if term.strip() and term.strip() != card.attrs.get('data-exploration-id')]
    for card in catalogue_cards(root / 'vetenskaplig-briefing/index.html'):
        if 'brief-entry' in card.classes:
            link = next((n for n in card.walk() if 'data-briefing' in n.attrs), None)
            subject = next((n for n in card.walk() if 'kicker' in n.classes), None)
            if link and subject:
                topics['vetenskaplig-briefing/' + link.attrs['href']] = [subject.text()]
    return topics


def receipted_dates(state):
    dates = {}
    for events in state['events'].values():
        for event in events:
            kind = event['kind']
            if kind not in ('published', 'updated', 'added') or not event.get('at'):
                continue
            if not re.fullmatch('[0-9a-f]{40}', event.get('commit', '')):
                continue
            when = timestamp(event['at'])
            row = dates.setdefault(event['href'], {})
            choose = max if kind == 'updated' else min
            row[kind] = choose(when, row.get(kind, when))
    return dates


def project(root):
    def data(path):
        return json.loads((root / path).read_text(encoding='utf-8'))

    essays = data('natverk-index.json')['artiklar']
    topics = topics_by_path(root)
    essay_keywords = {r['slug'] + '/index.html': ' '.join([r['amne'], *r['nyckelord']]) for r in essays}
    groups = [('Essäer', [(r['titel'], r['slug'] + '/index.html') for r in essays])]
    groups.append(('Vetenskapliga briefingar', [(r['title'], 'vetenskaplig-briefing/' + r['slug'] + '/') for r in published_briefings(root)]))
    editorial = data('kronikor-index-v2.json')
    for row in editorial['entries']:
        topics[row['href']] = row['terms']
    for series in editorial['collections']:
        groups.append((series['title'], [(r['title'], r['href']) for r in editorial['entries'] if r['series'] == series['id']]))
    chapters = data('skogsvaktaren/bilder.json')
    groups.append(('Där kartan tar slut', [(r['title'], 'skogsvaktaren/' + r['date'] + '.html') for r in reversed(chapters)]))
    dates = receipted_dates(data('portal-publiceringar.json'))
    formats, items, all_topics = [], [], {}
    for i, (label, entries) in enumerate(groups):
        if not entries:
            continue
        formats.append(f'<option value="g{i}">{escape(label)} ({len(entries)})</option>')
        for title, href in entries:
            target = href + 'index.html' if href.endswith('/') else href
            if not (root / target).is_file():
                raise ValueError('Missing contents target: ' + href)
            stamps = dates.get(target, {})
            details = [escape(label)]
            for kind, name in [('published', 'Publicerad'), ('updated', 'Uppdaterad'), ('added', 'Tillagd')]:
                if kind == 'published' and kind not in stamps:
                    details.append('Publiceringsdatum saknas')
                if kind in stamps:
                    value = stamps[kind].isoformat()
                    details.append(f'{name} <time data-kind="{kind}" datetime="{value}">{display_date(value)}</time>')
            terms = sorted(set(filter(None, topics.get(href, []))))
            for term in terms:
                all_topics.setdefault(term.casefold(), term)
            terms = [all_topics[term.casefold()] for term in terms]
            if terms:
                details.append(escape(' · '.join(terms)))
            pub = stamps.get('published')
            order = int(pub.timestamp()) if pub else None
            topic_attr = escape(json.dumps(terms, ensure_ascii=False), quote=True)
            keywords = escape(essay_keywords.get(href, ''), quote=True)
            item = (f'<li data-keywords="{keywords}" data-format="g{i}" data-topics="{topic_attr}"><a href="../{escape(href)}">'
                    f'{escape(title)}</a><small>{" · ".join(details)}</small></li>')
            items.append((order, title, item))
    items.sort(key=lambda entry: (entry[0] is None, -(entry[0] or 0), entry[1].casefold()))
    subject_options = ''.join(f'<option>{escape(term)}</option>' for term in sorted(all_topics.values(), key=str.casefold))
    template = (root / 'innehall/mall.html').read_text()
    page = template.replace('<!-- formats -->', ''.join(formats)).replace('<!-- topics -->', subject_options)
    (root / 'innehall/index.html').write_text(page.replace('<!-- entries -->', '\n'.join(item for _, _, item in items)))
