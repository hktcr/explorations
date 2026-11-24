"""Build the public gallery or add one approved daily image in a private checkout."""
import argparse
from datetime import date
from hashlib import sha256
from html import escape
from io import BytesIO
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'skogsvaktaren'
MANIFEST = ROOT / 'bilder.json'


def render(rows):
    figures = []
    seen = set()
    for row in sorted(rows, key=lambda r: r['date'], reverse=True):
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
        figures.append(f'<figure id="bild-{day}"><a href="{image}" aria-label="Förstora: {title}"><img src="{image}" alt="{alt}" loading="lazy"></a><figcaption><time datetime="{day}">{day}</time><h2>{title}</h2>AI-illustration</figcaption></figure>')
    body = '\n'.join(figures) or '<p>Här visas Skogsväktarens bilder när de har publicerats.</p>'
    return (ROOT / 'mall.html').read_text().replace('<!-- bilder -->', body)


def project():
    rows = json.loads(MANIFEST.read_text())
    (ROOT / 'index.html').write_text(render(rows))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('date', 'image', 'title', 'alt'):
        parser.add_argument('--' + key)
    args = parser.parse_args()
    rows = json.loads(MANIFEST.read_text())
    render(rows)
    if any(vars(args).values()):
        if not all(value and value.strip() for value in vars(args).values()):
            parser.error('Ange datum, bild, titel och alt-text tillsammans')
        from PIL import Image, ImageOps
        day = date.fromisoformat(args.date).isoformat()
        with Image.open(args.image) as source:
            image = ImageOps.exif_transpose(source).convert('RGB')
            image.thumbnail((1600, 1600))
            image.info.clear()
            buf = BytesIO()
            image.save(buf, 'WEBP', quality=85, method=6)
        data = buf.getvalue()
        digest = sha256(data).hexdigest()
        row = dict(date=day, title=args.title.strip(), alt=args.alt.strip(), sha256=digest)
        existing = next((r for r in rows if r['date'] == day), None)
        if existing and existing != row:
            parser.error('Datumet har redan en annan publiceringspost')
        if not existing:
            folder = ROOT / 'bilder'
            folder.mkdir(exist_ok=True)
            (folder / f'{day}-{digest}.webp').write_bytes(data)
            rows.append(row)
    page = render(rows)
    MANIFEST.write_text(json.dumps(sorted(rows,key=lambda r:r['date']), ensure_ascii=False, indent=2)+'\n')
    (ROOT / 'index.html').write_text(page)


if __name__ == '__main__':
    main()
