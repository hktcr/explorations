"""Build the public gallery or add one approved illustrated chapter in a private checkout."""
import argparse
from datetime import date
from hashlib import sha256
from html import escape
from io import BytesIO
import json
import re
from urllib.parse import urlsplit
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'skogsvaktaren'
MANIFEST = ROOT / 'bilder.json'


def validate_story(story):
    paragraphs = story['paragraphs']
    sources = story['sources']
    if not isinstance(paragraphs, list) or not all(isinstance(p, str) and p.strip() for p in paragraphs):
        raise ValueError('Brödtext ska vara en lista med stycken')
    if sum(len(re.findall(r"[^\W_]+(?:[-’'][^\W_]+)*", p)) for p in paragraphs) < 700:
        raise ValueError('Minst 700 ord krävs i brödtexten')
    if not isinstance(sources, list) or not sources:
        raise ValueError('Källor saknas')
    for source in sources:
        url = urlsplit(source['url'])
        if (url.scheme not in ('https','http') or not url.hostname or url.username
                or url.password or not source['title'].strip()):
            raise ValueError('Källan behöver titel och offentlig webbadress')


def chapter(row, image, previous, following):
    title = escape(row['title'])
    day = row['date']
    body = ''.join(f'<p>{escape(p)}</p>' for p in row['paragraphs'])
    sources = ''.join('<li><a href="{}">{}</a></li>'.format(escape(s['url']), escape(s['title'])) for s in row['sources'])
    links = []
    for rel, label, neighbor in [('prev','Föregående',previous),('next','Nästa',following)]:
        if neighbor:
            links.append(f'<a rel="{rel}" href="{neighbor["date"]}.html">{label}: {escape(neighbor["title"])}</a>')
    return f'''<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · Där kartan tar slut</title><link rel="stylesheet" href="galleri.css"><script src="../explorations-theme.js" defer></script></head>
<body><header><a href="../">Explorations</a><a href="./">Där kartan tar slut</a></header><main><article data-date="{day}">
<h1>{title}</h1><time datetime="{day}">{day}</time><figure><a href="{image}" aria-label="Förstora illustrationen"><img src="{image}" alt="{escape(row['alt'])}"></a><figcaption>AI-illustration</figcaption></figure>
<div class="prosa">{body}<h2>Källor</h2><ul>{sources}</ul></div></article><nav aria-label="Kapitel">{' '.join(links)}</nav></main></body></html>'''


def render(rows):
    figures = []
    seen = set()
    pages = {}
    ordered = sorted(rows, key=lambda r:r['date'])
    for i, row in enumerate(ordered):
        day = date.fromisoformat(row['date']).isoformat()
        digest = row['sha256']
        image = f'bilder/{day}-{digest}.webp'
        if (day != row['date'] or day in seen or len(digest) != 64
                or not all(c in '0123456789abcdef' for c in digest)
                or not row['title'].strip() or not row['alt'].strip()
                or sha256((ROOT / image).read_bytes()).hexdigest() != digest):
            raise ValueError(f'Ogiltig dagspost {day}')
        seen.add(day)
        title, alt = escape(row['title']), escape(row['alt'], quote=True)
        validate_story(row)
        filename = day + '.html'
        pages[filename] = chapter(row, image, ordered[i-1] if i else None, ordered[i+1] if i+1 < len(ordered) else None)
        signature = sha256(pages[filename].encode()).hexdigest()
        figures.insert(0, f'<figure id="bild-{day}" data-chapter-sha="{signature}"><a href="{filename}" aria-label="Läs {title}"><img src="{image}" alt="{alt}" loading="lazy"></a><figcaption><time datetime="{day}">{day}</time><h2>{title}</h2>AI-illustration</figcaption></figure>')
    body = '\n'.join(figures) or '<p>Här samlas de illustrerade kapitlen efter hand som de publiceras.</p>'
    pages['index.html'] = (ROOT / 'mall.html').read_text().replace('<!-- bilder -->', body)
    return pages


def project():
    rows = json.loads(MANIFEST.read_text())
    for path, content in render(rows).items():
        (ROOT / path).write_text(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('date', 'image', 'title', 'alt', 'story'):
        parser.add_argument('--' + key)
    args = parser.parse_args()
    rows = json.loads(MANIFEST.read_text())
    render(rows)
    if any(vars(args).values()):
        if not all(value and value.strip() for value in vars(args).values()):
            parser.error('Ange datum, bild, titel och alt-text tillsammans')
        from PIL import Image, ImageOps
        day = date.fromisoformat(args.date).isoformat()
        story = json.loads(Path(args.story).read_text())
        validate_story(story)
        with Image.open(args.image) as source:
            image = ImageOps.exif_transpose(source).convert('RGB')
            image.thumbnail((1600, 1600))
            image.info.clear()
            buf = BytesIO()
            image.save(buf, 'WEBP', quality=85, method=6)
        data = buf.getvalue()
        digest = sha256(data).hexdigest()
        row = dict(date=day, title=args.title.strip(), alt=args.alt.strip(), sha256=digest, paragraphs=story['paragraphs'], sources=[{k:s[k] for k in ('title','url')} for s in story['sources']])
        existing = next((r for r in rows if r['date'] == day), None)
        if existing and existing != row:
            parser.error('Datumet har redan en annan publiceringspost')
        if not existing:
            folder = ROOT / 'bilder'
            folder.mkdir(exist_ok=True)
            (folder / f'{day}-{digest}.webp').write_bytes(data)
            rows.append(row)
    pages = render(rows)
    MANIFEST.write_text(json.dumps(sorted(rows,key=lambda r:r['date']), ensure_ascii=False, indent=2)+'\n')
    for path, content in pages.items():
        (ROOT / path).write_text(content)


if __name__ == '__main__':
    main()
