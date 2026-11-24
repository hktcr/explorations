"""Publisher-side check of one content release. Nothing is sent by site visitors."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
import re
from urllib.parse import quote
from urllib.request import Request, urlopen
from portal_latest import ROOT, STATE, project, source_catalog

API = 'https://api.github.com/repos/hktcr/explorations'
PAGES = 'https://hktcr.github.io/explorations/'


def get(url):
    request = Request(url, headers={'User-Agent': 'Explorations publiceringskontroll', 'Cache-Control': 'no-cache'})
    with urlopen(request, timeout=25) as response:
        if response.status != 200:
            raise ValueError('Läsningen misslyckades')
        return response.read()


def stored(path, commit):
    info = json.loads(get(f'{API}/contents/{quote(path)}?ref={commit}'))
    if info.get('encoding') != 'base64':
        raise ValueError('GitHub levererade inte filens innehåll')
    return base64.b64decode(info['content'])


def verify_and_project(section, path, commit):
    if not re.fullmatch('[0-9a-f]{40}', commit) or path not in source_catalog(ROOT)[section]:
        raise ValueError('Ange ett känt publikt inlägg och en fullständig commit')
    current = json.loads((ROOT / STATE).read_text(encoding='utf-8'))['events'][section]
    position = max((i for i, event in enumerate(current) if event['href'] == path), default=-1)
    if position < 0:
        raise ValueError('Publiceringshändelsen saknas lokalt')
    with ThreadPoolExecutor(max_workers=4) as pool:
        git = pool.submit(get, f'{API}/git/commits/{commit}')
        registry = pool.submit(stored, STATE, commit)
        article = pool.submit(stored, path, commit)
        live = pool.submit(get, PAGES + path)
        obj = json.loads(git.result())
        registers = json.loads(registry.result())['events'][section]
        public_bytes = live.result()
        if obj['sha'] != commit or len(obj['parents']) != 1 or public_bytes != article.result():
            raise ValueError('Den publika texten eller släppets identitet avviker')
    previous = json.loads(stored(STATE, obj['parents'][0]['sha']))['events'][section]
    if position >= len(registers) or position < len(previous):
        raise ValueError('Händelsen tillkom inte i denna commit')
    event = registers[position]
    if any(event.get(key) != current[position].get(key) for key in ('href', 'kind', 'revision')):
        raise ValueError('Den verifierade publiceringshändelsen gäller en annan text')
    deployments = json.loads(get(f'{API}/deployments?sha={commit}&environment=github-pages&per_page=100'))
    successful = []
    for deployment in deployments:
        if deployment['environment'] != 'github-pages' or deployment['sha'] != commit:
            continue
        statuses = json.loads(get(f"{API}/deployments/{int(deployment['id'])}/statuses?per_page=100"))
        successful.extend(v['created_at'] for v in statuses if v['state'] == 'success')
    if not successful:
        raise ValueError('Pages har ännu inte kvitterat detta innehållssläpp')
    first_success = min(successful)
    project(ROOT, receipt=(section, path, first_success, commit))
    print(json.dumps({'path': path, 'commit': commit, 'pages_success_utc': first_success,
                      'public_sha256': sha256(public_bytes).hexdigest()}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('section', choices=('redaktionen', 'essa'))
    parser.add_argument('public_path')
    parser.add_argument('content_commit')
    args = parser.parse_args()
    verify_and_project(args.section, args.public_path, args.content_commit)
