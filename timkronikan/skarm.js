(() => {
  'use strict';
  const story = document.getElementById('skarm-post');
  if (!story) return;
  const status = document.getElementById('skarm-status');
  const pause = document.getElementById('skarm-paus');
  const full = document.getElementById('skarm-full');
  const period = 75_000, maxDelay = 5 * 60_000;
  let delay = period, timer, key = story.dataset.id || '';
  let active = true, started = false, paused = false, didCheck = false, stageEpoch = 0;
  let cancelPhase = null;
  const timings = { out: 360, between: 560, in: 420 };
  const statusLive = 'Liveläge. Kontrollerar nya inlägg automatiskt.';
  const statusBusy = 'Uppdateras …';
  const canMove = () => typeof matchMedia !== 'function' || !matchMedia('(prefers-reduced-motion: reduce)').matches;
  function waitPhase(ms) {
    return new Promise(resolve => {
      const timeout = setTimeout(() => { cancelPhase = null; resolve(true); }, ms);
      cancelPhase = () => { clearTimeout(timeout); cancelPhase = null; resolve(false); };
    });
  }
  function endTransition() {
    stageEpoch += 1;
    if (cancelPhase) cancelPhase();
    story.removeAttribute('data-phase');
    story.removeAttribute('aria-busy');
  }
  const trimText = (v, n) => typeof v === 'string' && v.trim() && v.length <= n;
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const media = /^media\/[a-z0-9]+(?:[-_][a-z0-9]+)*\.(?:jpg|png|webp)$/;
  const el = (tag, value, className) => {
    const n = document.createElement(tag);
    if (typeof value === 'string') n.textContent = value;
    if (className) n.className = className;
    return n;
  };
  function sameSite(href) {
    const u = new URL(href, location.href);
    const root = new URL('./', location.href);
    if (u.origin !== root.origin || !u.pathname.startsWith(root.pathname) || !/^https?:$/.test(u.protocol)) throw new Error('Invalid destination');
    return u;
  }
  function verify(payload) {
    if (!payload || payload.schema !== 1 || !payload.entry) throw new Error('No public entry');
    const x = payload.entry;
    if (!isoDate.test(x.date) || typeof x.date !== 'string' || typeof x.time !== 'string' || (x.time && !time.test(x.time))) throw new Error('Invalid slot');
    const expected = 'inlagg-' + x.date + (x.time ? '-' + x.time.replace(':','') : '');
    if (x.id !== expected || x.href !== x.date.slice(0,7) + '.html#' + expected || typeof x.revision !== 'string' || !/^[a-f0-9]{64}$/.test(x.revision) ||
        !trimText(x.title, 240) || !trimText(x.displayDate, 40) || !Array.isArray(x.paragraphs) || x.paragraphs.length < 1 ||
        x.paragraphs.length > 100 || x.paragraphs.some(p => !trimText(p, 12_000))) throw new Error('Invalid entry');
    sameSite(x.href);
    if (x.image !== null && (!x.image || !media.test(x.image.path) || !trimText(x.image.alt,360) || !trimText(x.image.caption,650))) throw new Error('Invalid image');
    if (x.image) sameSite(x.image.path);
    return x;
  }
  async function show(x, animate, epoch) {
    const contents = document.createDocumentFragment();
    const copy = el('div', null, 'skarm-copy');
    const meta = el('p', null, 'meta');
    const when = el('time', x.displayDate + (x.time ? ' · kl. ' + x.time + ', svensk tid' : ''));
    when.dateTime = x.date + (x.time ? 'T' + x.time : '');
    meta.append(when);
    copy.append(meta, el('h1', x.title), ...x.paragraphs.map(p => el('p', p)));
    const source = el('p',null,'skarm-source');
    const link = el('a','Öppna inlägget och dess källor →');
    link.href = x.href;
    source.append(link);
    copy.append(source);
    contents.append(copy);
    if (x.image) {
      const figure = el('figure');
      const img = el('img');
      img.alt = x.image.alt;
      img.decoding = 'async';
      img.src = x.image.path;
      if (img.decode) {
        let timeout;
        try {
          await Promise.race([img.decode(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Image timeout')), 9_000); })]);
        } finally { clearTimeout(timeout); }
      }
      const caption = el('figcaption');
      caption.append(el('strong','AI-genererad redaktionell illustration.'), ' ' + x.image.caption);
      figure.append(img,caption);
      contents.append(figure);
    }
    const current = () => !paused && active && epoch === stageEpoch;
    if (!current()) return;
    const commit = () => {
      story.replaceChildren(contents);
      key = story.dataset.id = x.id;
      story.dataset.revision = x.revision;
    };
    // Leave the incoming image fully decoded before altering the current view.
    // Avoid detaching a link that someone is currently using via keyboard.
    if (story.contains(document.activeElement)) return;
    if (!animate || !canMove()) { commit(); return; }
    try {
      story.setAttribute('aria-busy','true');
      story.dataset.phase = 'out';
      if (!await waitPhase(timings.out) || !current()) return;
      status.textContent = statusBusy;
      if (!await waitPhase(timings.between) || !current()) return;
      commit();
      story.dataset.phase = 'in';
      if (!await waitPhase(timings.in) || !current()) return;
    } finally {
      story.removeAttribute('data-phase');
      story.removeAttribute('aria-busy');
    }
  }
  function plan(ms) {
    clearTimeout(timer);
    if (!paused && active) timer = setTimeout(check, ms);
  }
  async function check() {
    if (started || paused || !active) return;
    started = true;
    const epoch = stageEpoch;
    const ctl = new AbortController();
    const max = setTimeout(() => ctl.abort(), 15_000);
    try {
      const u = sameSite('senaste.json');
      u.searchParams.set('_', String(Date.now()));
      const resp = await fetch(u, { cache:'no-store', redirect:'error', signal:ctl.signal });
      if (!resp.ok || !/^application\/json\b/i.test(resp.headers.get('content-type') || '')) throw new Error('Published record unavailable');
      if ((Number(resp.headers.get('content-length')) || 0) > 2_000_000) throw new Error('Response too large');
      const body = await resp.text();
      if (body.length > 1_300_000) throw new Error('Response too large');
      const x = verify(JSON.parse(body));
      if (x.id > key && epoch === stageEpoch) await show(x, didCheck, epoch);
      delay = period;
      if (!paused && active && status.textContent !== statusLive) status.textContent = statusLive;
    } catch (_) {
      delay = Math.min(maxDelay, delay * 2);
      if (!paused && active && status.textContent !== 'Tillfälligt avbrott. Senaste kända inlägget ligger kvar.') status.textContent = 'Tillfälligt avbrott. Senaste kända inlägget ligger kvar.';
    } finally {
      clearTimeout(max);
      didCheck = true;
      started = false;
      plan(delay);
    }
  }
  pause.hidden = false;
  pause.addEventListener('click', () => {
    paused = !paused;
    pause.textContent = paused ? 'Fortsätt uppdatera' : 'Pausa uppdatering';
    status.textContent = paused ? 'Automatisk uppdatering är pausad.' : 'Kontrollerar om ett nytt inlägg har publicerats.';
    if (paused) { endTransition(); clearTimeout(timer); }
    else plan(0);
  });
  if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
    full.hidden = false;
    function fullLabel() { full.textContent = document.fullscreenElement ? 'Lämna helskärm' : 'Helskärm'; }
    document.addEventListener('fullscreenchange', fullLabel);
    full.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch (_) {
        status.textContent = 'Webbläsaren kunde inte öppna helskärm. Skärmläget fungerar ändå.';
      }
    });
  }
  addEventListener('pagehide', () => { active = false; endTransition(); clearTimeout(timer); });
  addEventListener('pageshow', event => { if (event.persisted) { active = true; plan(0); } });
  addEventListener('online', () => { delay = period; plan(0); });
  plan(0);
})();
