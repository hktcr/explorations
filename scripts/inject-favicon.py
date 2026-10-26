#!/usr/bin/env python3
"""Add the same local favicon assets to the existing public page set."""
from pathlib import Path
from build_search_index import parse_cards
ROOT=Path(__file__).resolve().parents[1]
paths=[ROOT/'index.html',ROOT/'natverk/index.html']+[ROOT/c['slug']/'index.html' for c in parse_cards()]
for path in paths:
    source=path.read_text();prefix='' if path.parent==ROOT else '../'
    lines='\n'.join([
        f'<link rel="icon" type="image/svg+xml" href="{prefix}favicon.svg?v=20261025-1" data-explorations-favicon="svg">',
        f'<link rel="icon" type="image/png" sizes="32x32" href="{prefix}favicon-32.png?v=20261025-1" data-explorations-favicon="png">',
        f'<link rel="shortcut icon" href="{prefix}favicon.ico?v=20261025-1" data-explorations-favicon="ico">'])
    if 'data-explorations-favicon' not in source:
        marker='<link rel="stylesheet" href="'+prefix+'reader-settings.css'
        position=source.find(marker)
        source=source[:position]+lines+'\n'+source[position:] if position>=0 else source.replace('</head>',lines+'\n</head>',1)
        path.write_text(source)
print(f'{len(paths)} existing public pages have local favicon links.')
