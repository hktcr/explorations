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
    previous = json.loads(stored(STATE, obj['parents'][0]['sha']))['events'].get(section, [])
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


def verify_release(commit):
    """Receipt all new content events in a single release, including backfilled editions."""
    if not re.fullmatch('[0-9a-f]{40}', commit):
        raise ValueError('Ange släppets fullständiga commit')
    obj = json.loads(get(f'{API}/git/commits/{commit}'))
    if len(obj['parents']) != 1:
        raise ValueError('Innehållssläppet måste ha exakt en bas')
    before = json.loads(stored(STATE, obj['parents'][0]['sha']))['events']
    after = json.loads(stored(STATE, commit))['events']
    for section, events in after.items():
        previous = before.get(section, [])
        if events[:len(previous)] != previous:
            raise ValueError('Registerhistoriken har ändrats')
        for event in events[len(previous):]:
            verify_and_project(section, event['href'], commit)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('args', nargs='+', metavar='ARG')
    args = parser.parse_args().args
    if len(args) == 1:
        verify_release(args[0])
    elif len(args) == 3 and args[0] in ('redaktionen', 'essa', 'briefing'):
        verify_and_project(*args)
    else:
        parser.error('Ange COMMIT eller SECTION PUBLIC_PATH COMMIT')
