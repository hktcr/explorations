"""Project public content events onto the portal. Release dates come from verified receipts."""
import argparse
from datetime import datetime
from hashlib import sha256
from html import escape
import json
from pathlib import Path
import re
from build_chronicle_index import Read, STOCKHOLM

ROOT = Path(__file__).resolve().parents[1]
STATE = 'portal-publiceringar.json'
START = '<!-- portal-latest:start -->'
END = '<!-- portal-latest:end -->'
MONTHS = 'januari februari mars april maj juni juli augusti september oktober november december'.split()


def source_catalog(root):
    read = lambda name: json.loads((root / name).read_text(encoding='utf-8'))
    editorial = {}
    formats = {'timkronikan': 'Timmen', 'halvtimmen': 'Halvtimmen'}
    index_name = 'kronikor-index-v2.json' if (root / 'kronikor-index-v2.json').is_file() else 'kronikor-index.json'
    for item in read(index_name)['entries']:
        href = item['href']
        name = 'Reportage' if href.startswith('timkronikan/reportage/') else formats[item['series']]
        editorial[href] = {'href': href, 'title': item['title'], 'slot': item['date'], 'format': name}
    reports = Read()
    reports.feed((root / 'timkronikan/reportage/index.html').read_text(encoding='utf-8'))
    reports.close()
    for card in reports.root.traverse('a'):
        if 'card' not in card.attrs.get('class', '').split():
            continue
        filename = card.attrs.get('href', '')
        if not re.fullmatch(r'[A-Za-z0-9_-]+\.html', filename):
            raise ValueError('Ogiltig reportagelänk')
        href = 'timkronikan/reportage/' + filename
        title = next(card.traverse('h2')).text()
        slot = next(card.traverse('time')).attrs['datetime']
        editorial.setdefault(href, {'href': href, 'title': title, 'slot': slot, 'format': 'Reportage'})
    essays = {}
    # The normal search generator indexes exactly the linked essay cards on the landing page.
    published_cards = {card['slug'] + '/index.html' for card in read('sok-index.json')['artiklar']}
    for item in read('reflections/article-registry.json')['articles']:
        href = item['path']
        if href not in published_cards:
            continue
        essays[href] = {'href': href, 'title': item['title'], 'slot': '', 'format': 'Essä', 'number': int(item['id'].split('#')[-1])}
    for item in [*editorial.values(), *essays.values()]:
        path = root / item['href']
        if not re.fullmatch(r'[A-Za-z0-9_/-]+\.html', item['href']) or not item['title'].strip() or not path.is_file():
            raise ValueError('Länk till publicerad text saknas: ' + str(item['href']))
    briefings = {}
    folder = root / 'vetenskaplig-briefing'
    if (folder / 'index.html').is_file():
        listing = Read()
        listing.feed((folder / 'index.html').read_text(encoding='utf-8'))
        listing.close()
        for link in reversed(list(listing.root.traverse('a'))):
            if 'data-briefing' not in link.attrs:
                continue
            slug = link.attrs.get('href', '')
            if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*/', slug) or not (folder / slug / 'index.html').is_file():
                raise ValueError('Ogiltig briefinglänk: ' + slug)
            path = 'vetenskaplig-briefing/' + slug + 'index.html'
            briefings[path] = dict(title=link.text(), href=path, slot='', format='Vetenskaplig briefing', number=len(briefings))
    return {'redaktionen': editorial, 'essa': essays, 'briefing': briefings}


def timestamp(value):
    result = datetime.fromisoformat(value)
    if result.tzinfo is None:
        raise ValueError('Publiceringskvitto kräver tidszon')
    return result


def display_date(value):
    local = datetime.fromisoformat(value)
    if local.tzinfo is not None:
        local = local.astimezone(STOCKHOLM)
    date = f'{local.day} {MONTHS[local.month - 1]} {local.year}'
    return date + (f' kl. {local:%H.%M}' if 'T' in value else '')


def synchronise(state, catalog):
    for section, items in catalog.items():
        known = set(state['known'].setdefault(section, []))
        state['events'].setdefault(section, [])
        new = sorted(set(items) - known, key=lambda path: (items[path]['slot'], items[path].get('number', 0), path))
        for path in new:
            state['events'][section].append({'href': path, 'kind': 'published'})
        state['known'][section] = sorted(known | set(items))


def latest(state, section, items):
    return next((event for event in reversed(state['events'][section]) if event['href'] in items), None)


def rows(state, catalog):
    lines = []
    for section, label in [('redaktionen', 'Senast från Redaktionen'), ('essa', 'Senaste essän')]:
        event = latest(state, section, catalog[section])
        if event is None:
            continue
        item = catalog[section][event['href']]
        stamp = event.get('at')
        action = 'Uppdaterad' if event['kind'] == 'updated' else 'Publicerad'
        fmt = item['format'] + ' · ' if section == 'redaktionen' else ''
        title = escape(item['title'])
        link = escape(item['href'], quote=True)
        if stamp:
            meta = f'{action} <time datetime="{escape(stamp, quote=True)}">{display_date(stamp)}</time>'
            if item['slot'] and 'T' in item['slot']:
                edition = timestamp(item['slot']).astimezone(STOCKHOLM)
                same_day = edition.date() == timestamp(stamp).astimezone(STOCKHOLM).date()
                short_date = f'{edition:%H.%M}' if same_day else display_date(item['slot'])
                meta = f'Utgåva <time datetime="{escape(item["slot"], quote=True)}">{short_date}</time> · ' + meta
        else:
            meta = 'Publiceringstid verifieras' if action == 'Publicerad' else 'Tid för sakuppdatering verifieras'
            if item['slot']:
                slot = escape(item['slot'], quote=True)
                meta = f'Utgåva <time datetime="{slot}">{display_date(item["slot"])}</time> · ' + meta
        lines.append(f'<div class="portal-latest-row" data-latest="{section}"><dt>{label}</dt><dd><a href="{link}">{title}</a><small>{fmt}{meta}</small></dd></div>')
    return '\n'.join(lines)


def recent_records(state, catalog):
    """Only catalogued, published paths can contribute a title. Keep publication and revision separate."""
    rows = []
    for section, items in catalog.items():
        history = {}
        for order, event in enumerate(state['events'][section]):
            if event['href'] in items:
                history.setdefault(event['href'], {})[event['kind']] = (order, event.get('at', ''))
        for path, events in history.items():
            pub_order, published = events.get('published', (-1, ''))
            _, updated = events.get('updated', (-1, ''))
            item = items[path]
            href = path.removesuffix('index.html') if section == 'briefing' else path
            meta = []
            for kind, label in [('published', 'Publicerad'), ('updated', 'Sakuppdaterad')]:
                if kind not in events:
                    continue
                at = events[kind][1]
                if at:
                    meta.append(f'{label} {display_date(at)}')
                else:
                    meta.append(f'{label} · tid verifieras')
            rows.append(dict(href=href, title=item['title'], format=item['format'], order=pub_order,
                             published=published, updated=updated, metadata=' · '.join(meta)))
    return rows


def recent_rows(records):
    return '\n'.join(
        f'<li data-format="{escape(r["format"])}" data-order="{r["order"]}" '
        f'data-published="{escape(r["published"])}" data-updated="{escape(r["updated"])}">'
        f'<a href="{escape(r["href"])}">{escape(r["title"])}</a>'
        f'<small>{escape(r["format"])} · {escape(r["metadata"])}</small></li>'
        for r in records)


def project(root, update=None, receipt=None):
    state_file = root / STATE
    state = json.loads(state_file.read_text(encoding='utf-8'))
    catalog = source_catalog(root)
    synchronise(state, catalog)
    if update:
        section, path = update
        if path not in catalog[section]:
            raise ValueError('Sakuppdateringen finns inte i det publika registret')
        revision = sha256((root / path).read_bytes()).hexdigest()
        previous = next((event for event in reversed(state['events'][section]) if event['href'] == path), None)
        if not previous or previous.get('revision') != revision:
            state['events'][section].append({'href': path, 'kind': 'updated', 'revision': revision})
    if receipt:
        section, path, value, commit = receipt
        normalized = timestamp(value).isoformat(timespec='seconds')
        if not re.fullmatch('[0-9a-f]{40}', commit):
            raise ValueError('Kvitto kräver innehållssläppets fullständiga commit')
        events = state['events'][section]
        event = next((e for e in reversed(events) if e['href'] == path), None)
        if event is None:
            raise ValueError('Ingen registrerad publicering matchar kvittot')
        if 'at' in event and (timestamp(event['at']) != timestamp(normalized) or event['commit'] != commit):
            raise ValueError('En kvitterad händelse får inte ersättas')
        event.update(at=normalized, commit=commit)
    page = root / 'index.html'
    before = page.read_text(encoding='utf-8')
    if before.count(START) != 1 or before.count(END) != 1:
        raise ValueError('Portalens markörer måste finnas exakt en gång')
    prefix, rest = before.split(START)
    _, suffix = rest.split(END)
    html = prefix + START + '\n' + rows(state, catalog) + '\n' + END + suffix
    start, end = '<!-- portal-recent:start -->', '<!-- portal-recent:end -->'
    if start in html:
        prefix, rest = html.split(start)
        _, suffix = rest.split(end)
        records = recent_records(state, catalog)
        feed = root / 'portal-senaste.json'
        payload = json.dumps({'version': 1, 'titles': records}, ensure_ascii=False, separators=(',', ':')) + '\n'
        if not feed.exists() or feed.read_text(encoding='utf-8') != payload:
            feed.write_text(payload, encoding='utf-8')
        html = prefix + start + '\n' + recent_rows(records) + '\n' + end + suffix
    encoded = json.dumps(state, ensure_ascii=False, indent=2) + '\n'
    if encoded != state_file.read_text(encoding='utf-8'):
        state_file.write_text(encoded, encoding='utf-8')
    if html != before:
        page.write_text(html, encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--updated', nargs=2, metavar=('SECTION', 'PUBLIC_PATH'))
    args = parser.parse_args()
    project(ROOT, args.updated)
