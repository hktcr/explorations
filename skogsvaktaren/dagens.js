(() => {
  const link = document.getElementById('dagensBild');
  const gallery = new URL('skogsvaktaren/', document.baseURI);
  const clock = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm',
    year: 'numeric', month: '2-digit', day: '2-digit' });
  let running = false;
  let verified = '';
  let timer;
  async function check() {
    clearTimeout(timer);
    const now = new Date();
    const day = clock.format(now);
    if (verified !== day) link.hidden = true;
    // A date change may fall between two ordinary five-minute checks.
    let delay = 300000;
    if (clock.format(new Date(+now + delay)) !== day) {
      let lo = 0, hi = delay;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (clock.format(new Date(+now + mid)) === day) lo = mid; else hi = mid;
      }
      delay = hi;
    }
    timer = setTimeout(check, delay);
    if (running || document.hidden || (verified === day && !link.hidden)) return;
    running = true;
    try {
      const response = await fetch(gallery, {cache:'no-cache'});
      if (!response.ok) return;
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const figure = doc.getElementById('bild-' + day);
      const src = figure?.querySelector('img[alt]')?.getAttribute('src');
      if (!src || !new RegExp('^bilder/' + day + '-[a-f0-9]{64}\\.webp$').test(src)
          || figure.querySelector('a')?.getAttribute('href') !== src) return;
      const image = new Image();
      image.src = new URL(src, gallery).href;
      await image.decode();
      if (!image.naturalWidth || clock.format(new Date()) !== day) return;
      verified = day;
      link.href = gallery.href + '#bild-' + day;
      link.hidden = false;
    } catch { link.hidden = true; }
    finally { running = false; }
  }
  document.addEventListener('visibilitychange', check);
  window.addEventListener('pageshow', check);
  check();
})();
