import { analyseDocument, ReadingOrchestra, MODE_LABELS, BLOCK_SKIP, readingFraction, blendProfiles } from './reader-soundscape.mjs?v=20260922-focus-score-1';

const STORAGE = 'explorationsFocusMediaV1';
const SIZES = ['small', 'medium', 'large'];
const POSITIONS = ['top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const defaults = () => ({ visible: true, size: 'small', position: 'bottom', volume: 25 });

export function installReadingMedia({ article, panel, progress }) {
  let preferences = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null');
    preferences = {
      visible: saved?.visible !== false,
      size: SIZES.includes(saved?.size) ? saved.size : 'small',
      position: POSITIONS.includes(saved?.position) ? saved.position : 'bottom',
      volume: Number.isFinite(saved?.volume) ? Math.min(100, Math.max(0, saved.volume)) : 25
    };
  } catch { /* Private browsing keeps session preferences. */ }
  const group = document.createElement('div');
  group.className = 'reader-media-settings';
  group.innerHTML = `
    <fieldset class="reader-settings__row"><legend>Läsprogress i fokus</legend>
      <label class="reader-media-check"><input type="checkbox" data-progress-visible> Visa läsprogress</label>
      <div class="reader-media-fields">
        <label>Storlek<select data-progress-size><option value="small">Liten</option><option value="medium">Mellan</option><option value="large">Stor</option></select></label>
        <label>Placering<select data-progress-position><option value="top">Överkant, mitten</option><option value="bottom">Nederkant, mitten</option><option value="top-left">Uppe till vänster</option><option value="top-right">Uppe till höger</option><option value="bottom-left">Nere till vänster</option><option value="bottom-right">Nere till höger</option></select></label>
      </div>
    </fieldset>
    <fieldset class="reader-settings__row"><legend>Läsmusik</legend>
      <button type="button" data-music-toggle aria-pressed="false" disabled>Förbereder läsmusik…</button>
      <label class="reader-media-volume">Volym <input type="range" min="0" max="100" step="1" data-music-volume aria-label="Musikvolym"><output data-music-volume-value></output></label>
      <p class="reader-media-status" data-music-status role="status">Läser dokumentets karaktär…</p>
      <p class="reader-media-hint">Musiken följer texten där du läser. Starta med knappen; vid sidbyte eller dold flik stannar den.</p>
    </fieldset>`;
  panel.insertBefore(group, panel.querySelector('.reader-settings__actions'));
  const toggle = group.querySelector('[data-music-toggle]');
  const status = group.querySelector('[data-music-status]');
  const visible = group.querySelector('[data-progress-visible]');
  const size = group.querySelector('[data-progress-size]');
  const position = group.querySelector('[data-progress-position]');
  const volume = group.querySelector('[data-music-volume]');
  const volumeValue = group.querySelector('[data-music-volume-value]');
  const engine = new ReadingOrchestra();
  let score = null, analysis = null, active = false, busy = false, disposed = false;
  let frame = 0, ranges = [], geometryDirty = true, currentIndex = -1, abort = null;
  let readingStart = 0, readingEnd = 0;

  const save = () => { try { localStorage.setItem(STORAGE, JSON.stringify(preferences)); } catch {} };
  const sync = () => {
    visible.checked = preferences.visible; size.value = preferences.size; position.value = preferences.position;
    volume.value = preferences.volume; volumeValue.value = `${preferences.volume} %`;
    progress.dataset.focusSize = preferences.size; progress.dataset.focusPosition = preferences.position;
    progress.hidden = document.documentElement.dataset.readerFocus === 'true' && !preferences.visible;
    size.disabled = position.disabled = !preferences.visible;
    toggle.disabled = busy || !score;
    toggle.textContent = busy ? 'Ett ögonblick…' : active ? 'Stäng av läsmusik' : 'Starta läsmusik';
    toggle.setAttribute('aria-pressed', String(active));
    group.dataset.musicState = busy ? 'changing' : active ? 'playing' : 'off';
  };
  const measure = () => {
    const blocks = score?.blocks || [];
    ranges = blocks.map(block => {
      const rect = block.element.getBoundingClientRect();
      return { top: rect.top + scrollY, bottom: rect.bottom + scrollY };
    });
    const rect = article.getBoundingClientRect();
    readingStart = ranges[0]?.top ?? rect.top + scrollY;
    // Progress must still reach the actual text end when the audio analysis is capped.
    const tailWalker = document.createTreeWalker(article, NodeFilter.SHOW_ELEMENT);
    while (tailWalker.lastChild()) { /* descend to the final element */ }
    let tail = tailWalker.currentNode;
    while (tail !== article) {
      if (tail.matches('h1,h2,h3,h4,p,li,blockquote,pre') && !tail.closest(BLOCK_SKIP) && tail.textContent.trim().length >= 15) break;
      tail = tailWalker.previousNode();
      if (!tail) break;
    }
    readingEnd = tail && tail !== article ? tail.getBoundingClientRect().bottom + scrollY : rect.bottom + scrollY;
    geometryDirty = false;
  };
  const profileAt = () => {
    if (!score?.blocks.length) return score?.global;
    const line = scrollY + innerHeight * .38;
    let low = 0, high = ranges.length - 1;
    while (low < high) { const mid = Math.floor((low + high) / 2); if (ranges[mid].bottom < line) low = mid + 1; else high = mid; }
    const index = low;
    currentIndex = index;
    const block = score.blocks[index], next = score.blocks[Math.min(index + 1, score.blocks.length - 1)];
    const blend = Math.max(0, Math.min(.35, (line - ranges[index].top) / Math.max(1, ranges[index].bottom - ranges[index].top) * .35));
    return { ...blendProfiles(block, next, blend), seed: block.seed, words: block.words, heading: block.heading, tonic: score.global.tonic };
  };
  const update = () => {
    frame = 0;
    if (disposed) return;
    if (geometryDirty) measure();
    const fraction = readingFraction(readingStart, readingEnd, innerHeight, scrollY);
    progress.value = String(Math.round(fraction * 1000));
    progress.style.setProperty('--reader-progress', `${fraction * 100}%`);
    progress.setAttribute('aria-valuetext', `${Math.round(fraction * 100)} procent av lästexten`);
    const profile = profileAt();
    if (active && profile) engine.setTarget(profile);
  };
  const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(update); };
  const invalidate = () => { geometryDirty = true; schedule(); };
  const resize = new ResizeObserver(invalidate);
  resize.observe(article);

  const stop = async (immediate = false, message = 'Musiken är avstängd.') => {
    active = false; busy = true; sync();
    await engine.stop(immediate);
    busy = false; status.textContent = message; sync();
  };
  const prepare = () => {
    abort?.abort();
    const request = abort = new AbortController();
    analysis = analyseDocument(article, document.querySelector('h1')?.textContent || document.title, request.signal)
      .then(result => {
        if (disposed || request.signal.aborted) return;
        score = result; geometryDirty = true;
        status.textContent = `Förberedd i ${MODE_LABELS[score.global.mode]}.${score.limited ? ' Ett mycket långt dokument analyseras i begränsat omfång.' : ''}`;
        sync(); schedule();
      }).catch(error => {
        if (error.name === 'AbortError') return;
        status.textContent = 'Musiken kunde inte förberedas. Ladda om sidan för att försöka igen.';
      });
  };

  toggle.addEventListener('click', async () => {
    if (busy || !score) return;
    if (active) { await stop(); return; }
    if (!preferences.volume) { preferences.volume = 25; save(); }
    busy = true; sync();
    try {
      if (geometryDirty) measure();
      engine.volume = preferences.volume / 100;
      const started = await engine.start({ ...score.global, ...profileAt() });
      if (!started || disposed || document.hidden) { await stop(true); return; }
      active = true;
      engine.duck([...document.querySelectorAll('audio')].some(audio => !audio.paused));
      status.textContent = `Musiken följer läsningen. Grundkaraktär: ${MODE_LABELS[score.global.mode]}.`;
    } catch {
      await engine.stop(true);
      active = false;
      status.textContent = 'Ljudet kunde inte starta. Försök med Starta läsmusik igen.';
    } finally { busy = false; sync(); }
  });
  for (const input of [visible, size, position]) input.addEventListener('change', () => {
    preferences.visible = visible.checked; preferences.size = size.value; preferences.position = position.value;
    save(); sync();
  });
  volume.addEventListener('input', () => {
    preferences.volume = Number(volume.value); save(); sync();
    engine.setVolume(preferences.volume / 100);
    if (!preferences.volume) void stop(false, 'Volymen är noll. Starta läsmusik för att lyssna igen.');
  });
  progress.addEventListener('input', () => {
    if (geometryDirty) measure();
    const start = Math.max(0, readingStart - 80);
    const end = Math.max(start, readingEnd - innerHeight + 28);
    window.scrollTo({ top: start + (end - start) * Number(progress.value) / 1000, behavior: 'instant' });
    schedule();
  });
  const onFocus = event => {
    sync(); invalidate();
    if (!event.detail) void stop();
  };
  const onVisibility = () => { if (document.hidden) void stop(true, 'Pausad när fliken doldes. Starta läsmusik för att fortsätta.'); };
  const onNarration = event => { if (event.target.tagName === 'AUDIO') engine.duck([...document.querySelectorAll('audio')].some(audio => !audio.paused)); };
  const onPageHide = () => {
    disposed = true; abort?.abort(); cancelAnimationFrame(frame); frame = 0; resize.disconnect();
    score = null; ranges = []; analysis = null;
    void stop(true, 'Starta läsmusik för att fortsätta.');
  };
  const onPageShow = event => {
    if (!event.persisted) return;
    disposed = false; resize.observe(article); prepare(); invalidate();
  };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', invalidate, { passive: true });
  addEventListener('pagehide', onPageHide);
  addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('xr-focus-change', onFocus);
  document.addEventListener('play', onNarration, true);
  document.addEventListener('pause', onNarration, true);
  document.addEventListener('ended', onNarration, true);
  document.fonts?.ready.then(invalidate);
  sync(); prepare(); schedule();
  return {
    reset() { preferences = defaults(); save(); sync(); void stop(); },
    // Numbers only; no DOM, text, graph nodes or document snapshots escape the controller.
    stats() { return { ...engine.stats(), blocks: score?.blocks.length || 0, currentIndex, ranges: ranges.length }; }
  };
}
