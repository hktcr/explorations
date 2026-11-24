/* Compare absolute instants. The generated <time> labels use Europe/Stockholm. */
(() => {
  const shelf = document.getElementById('recentEditions');
  if (!shelf || shelf.dataset.ready) return;
  shelf.dataset.ready = 'true';
  const day = 24 * 60 * 60 * 1000;
  const list = shelf.querySelector('ul');
  const status = document.getElementById('recentCheck');
  const interval = 5 * 60 * 1000;
  const clock = new Intl.DateTimeFormat('sv-SE', { timeZone:'Europe/Stockholm', dateStyle:'long', timeStyle:'medium' });
  const byPath = new Map(Array.from(list.children, row => [row.querySelector('a').getAttribute('href'), row]));
  const seen = new Set();
  let lastGood = 0;
  let lastAttempt = 0;
  let polling;
  let running = false;
  function readItems() {
    return Array.from(byPath.values(), row => ({
      row, format:row.dataset.format, order:Number(row.dataset.order),
      published:Date.parse(row.dataset.published), updated:Date.parse(row.dataset.updated)
    }));
  }
  function apply(data) {
    if (data?.version !== 1 || !Array.isArray(data.titles) || !data.titles.length) throw Error('Ogiltig titellista');
    const paths = new Set();
    for (const item of data.titles) {
      if (!item || typeof item.href !== 'string' || !/^(?:[a-zA-Z0-9_-]+\/)+(?:[a-zA-Z0-9_-]+\.html)?$/.test(item.href) ||
          paths.has(item.href) || !Number.isInteger(item.order) ||
          !['Timmen','Halvtimmen','Reportage','Essä','Vetenskaplig briefing'].includes(item.format) ||
          typeof item.title !== 'string' || !item.title.trim() || typeof item.metadata !== 'string' ||
          ![item.published,item.updated].every(t => t === '' || (typeof t === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(t) && Number.isFinite(Date.parse(t))))) throw Error('Ogiltig titel');
      paths.add(item.href);
    }
    for (const item of data.titles) {
      let row = byPath.get(item.href);
      if (!row) {
        row = document.createElement('li');
        const link = document.createElement('a');
        link.setAttribute('href', item.href);
        row.append(link, document.createElement('small'));
        byPath.set(item.href, row);
        list.append(row);
      }
      for (const field of ['published','updated','order','format']) row.dataset[field] = item[field];
      const link = row.querySelector('a'), meta = row.querySelector('small');
      if (link.textContent !== item.title) link.textContent = item.title;
      const label = item.format + ' · ' + item.metadata;
      if (meta.textContent !== label) meta.textContent = label;
    }
    for (const [path,row] of byPath) {
      if (paths.has(path)) continue;
      if (row.contains(document.activeElement)) document.getElementById('recentHeading').focus({preventScroll:true});
      row.remove(); byPath.delete(path);
    }
    refresh();
  }
  function schedule() {
    clearTimeout(polling);
    if (!document.hidden && !running) polling = setTimeout(check, Math.max(0, lastAttempt + interval - Date.now()));
  }
  async function check() {
    if (document.hidden || running) return;
    running = true;
    lastAttempt = Date.now();
    try {
      const response = await fetch('portal-senaste.json', {cache:'no-cache', signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw Error('Hämtningen misslyckades');
      apply(await response.json());
      lastGood = Date.now();
      status.textContent = 'Senast kontrollerad ' + clock.format(lastGood) + '.';
    } catch {
      status.textContent = (lastGood ? 'Senast kontrollerad ' + clock.format(lastGood) + '. ' : '') + 'Kontrollen är fördröjd.';
    } finally {
      running = false;
      schedule();
    }
  }
  let timer;
  function refresh() {
    const now = Date.now();
    const items = readItems();
    const focused = document.activeElement;
    clearTimeout(timer);
    // A pending receipt can identify the latest edition, but cannot qualify it for colour.
    const latest = new Map();
    const score = item => Number.isFinite(item.published) ? item.published : Infinity;
    const eligible = items.filter(item => !(item.published > now));
    for (const item of eligible) {
      if (item.order < 0) continue;
      const prev = latest.get(item.format);
      if (!prev || score(item) > score(prev) || (score(item) === score(prev) && item.order > prev.order)) {
        latest.set(item.format, item);
      }
    }
    let next = Infinity;
    const recent = time => time <= now && now - time < day;
    const visible = [];
    for (const item of items) {
      for (const time of [item.published, item.updated]) {
        if (time > now) next = Math.min(next, time);
        if (recent(time)) next = Math.min(next, time + day);
      }
      const fresh = recent(item.published);
      const revised = recent(item.updated);
      const show = fresh || revised || latest.get(item.format) === item || (!Number.isFinite(item.published) && item.order >= 0) || item.row.contains(focused);
      item.row.hidden = !show;
      item.row.classList.toggle('recent-publication', fresh);
      const path = item.row.querySelector('a').getAttribute('href');
      if (fresh && !seen.has(path)) {
        seen.add(path);
        item.row.classList.add('recent-enter');
        item.row.addEventListener('animationend', () => item.row.classList.remove('recent-enter'), {once:true});
      }
      if (show) visible.push(item);
    }
    const activity = item => Math.max(item.published <= now ? item.published : 0, item.updated <= now ? item.updated : 0);
    visible.sort((a, b) => activity(b) - activity(a) || b.order - a.order);
    // Preserve focus and avoid replaying the entrance animation on visibility changes.
    const list = shelf.querySelector('ul');
    let cursor = list.firstElementChild;
    for (const item of visible) {
      if (cursor !== item.row) list.insertBefore(item.row, cursor);
      cursor = item.row.nextElementSibling;
    }
    if (focused && focused !== document.activeElement && list.contains(focused)) focused.focus({preventScroll:true});
    shelf.hidden = !visible.length;
    document.documentElement.classList.toggle('has-recent-editions', visible.length > 0);
    if (Number.isFinite(next)) timer = setTimeout(refresh, Math.min(next - now, 2147483647));
  }
  refresh();
  schedule();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
    schedule();
  });
  window.addEventListener('pageshow', () => { refresh(); schedule(); });
  list.addEventListener('focusout', () => queueMicrotask(refresh));
})();
