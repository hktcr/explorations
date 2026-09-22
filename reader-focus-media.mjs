import { analyseDocument, ReadingOrchestra, MODE_LABELS, BLOCK_SKIP, readingFraction, blendProfiles } from './reader-soundscape.mjs?v=20260922-focus-ipad-1';

const STORAGE = 'explorationsFocusMediaV1';
const SIZES = ['small', 'medium', 'large'];
const POSITIONS = ['top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const defaults = () => ({ visible: true, size: 'small', position: 'bottom', volume: 25 });

export function installReadingMedia({ article, panel, progress }, {
  engine = new ReadingOrchestra(), analyse = analyseDocument, now = () => performance.now()
} = {}) {
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
  let score = null, analysis = null, active = false, busy = false, disposed = false;
  let frame = 0, ranges = [], geometryDirty = true, currentIndex = -1, abort = null;
  let readingStart = 0, readingEnd = 0;
  let operation = 0, readingTimer = null, movingQuickly = false, resting = false;
  const readingViewport = () => ({ top: scrollY + (window.visualViewport?.offsetTop || 0),
    height: window.visualViewport?.height || innerHeight });
  let previousScroll = { y: readingViewport().top, at: now() }, latestScroll = previousScroll;
  let lastMotionAt = latestScroll.at;

  const clearReadingTimer = () => { clearTimeout(readingTimer); readingTimer = null; };
  // Settle and reading-rest share one replaceable timer; no scroll history is retained.
  const waitForReadingRest = () => {
    clearReadingTimer();
    if (!active || disposed) return;
    readingTimer = setTimeout(() => {
      readingTimer = null;
      if (!active || disposed) return;
      resting = true; schedule();
    }, Math.max(0, 8000 - (now() - lastMotionAt)));
  };

  const save = () => { try { localStorage.setItem(STORAGE, JSON.stringify(preferences)); } catch {} };
  const sync = () => {
    visible.checked = preferences.visible; size.value = preferences.size; position.value = preferences.position;
    volume.value = preferences.volume; volumeValue.value = `${preferences.volume} %`;
    progress.dataset.focusSize = preferences.size; progress.dataset.focusPosition = preferences.position;
    progress.hidden = document.documentElement.dataset.readerFocus === 'true' && !preferences.visible;
    size.disabled = position.disabled = !preferences.visible;
    toggle.disabled = busy || !score || Boolean(engine.stats().closeFailed);
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
    // A list/quote introduction may enclose child blocks. Its reading region
    // ends when the next anchor begins, rather than swallowing those children.
    ranges.forEach((range, i) => {
      if (ranges[i + 1]) range.bottom = Math.max(range.top, Math.min(range.bottom, ranges[i + 1].top));
    });
    const rect = article.getBoundingClientRect();
    readingStart = ranges[0]?.top ?? rect.top + scrollY;
    // Progress must still reach the actual text end when the audio analysis is capped.
    const tailWalker = document.createTreeWalker(article, NodeFilter.SHOW_ELEMENT);
    while (tailWalker.lastChild()) { /* descend to the final element */ }
    let tail = tailWalker.currentNode;
    while (tail !== article) {
      if (tail.matches('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,tr') && !tail.closest(BLOCK_SKIP) && tail.textContent.trim().length) break;
      tail = tailWalker.previousNode();
      if (!tail) break;
    }
    readingEnd = tail && tail !== article ? tail.getBoundingClientRect().bottom + scrollY : rect.bottom + scrollY;
    geometryDirty = false;
  };
  const profileAt = () => {
    if (!score?.blocks.length) return score?.global;
    const viewport = readingViewport();
    const line = viewport.top + viewport.height * .38;
    let low = 0, high = ranges.length;
    // Choose the last anchor already reached. Whitespace and an unanalysed
    // region belong to the preceding text, never a future section.
    while (low < high) { const mid = Math.floor((low + high) / 2); if (ranges[mid].top <= line) low = mid + 1; else high = mid; }
    const index = Math.max(0, low - 1);
    currentIndex = index;
    const block = score.blocks[index], next = score.blocks[Math.min(index + 1, score.blocks.length - 1)];
    const inside = line >= ranges[index].top && line <= ranges[index].bottom;
    const blend = inside && block.sectionId === next.sectionId
      ? Math.max(0, Math.min(.35, (line - ranges[index].top) / Math.max(1, ranges[index].bottom - ranges[index].top) * .35)) : 0;
    const mixed = blendProfiles(block, next, blend);
    // Keep document nodes in the reading map, not in the audio engine's targets.
    return {
      valence: mixed.valence, energy: mixed.energy, space: mixed.space, thought: mixed.thought,
      mode: mixed.mode, seed: block.seed, motifSeed: score.global.seed,
      words: block.words, heading: block.heading, role: block.role, sectionId: block.sectionId,
      sectionSeed: block.sectionSeed, sectionProgress: block.sectionProgress, cadence: block.cadence, confidence: block.confidence,
      phraseSpace: Math.min(1, (block.phraseSpace || 0) + (resting ? .12 : 0)), tonic: score.global.tonic
    };
  };
  const update = () => {
    frame = 0;
    if (disposed) return;
    if (geometryDirty) measure();
    const viewport = readingViewport();
    const fraction = readingFraction(readingStart, readingEnd, viewport.height, viewport.top);
    progress.value = String(Math.round(fraction * 1000));
    progress.style.setProperty('--reader-progress', `${fraction * 100}%`);
    progress.setAttribute('aria-valuetext', `${Math.round(fraction * 100)} procent av lästexten`);
    const profile = profileAt();
    if (active && !movingQuickly && profile) engine.setTarget(profile);
  };
  const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(update); };
  const invalidate = () => { geometryDirty = true; schedule(); };
  const onScroll = () => {
    if (disposed) return;
    previousScroll = latestScroll;
    latestScroll = { y: readingViewport().top, at: now() };
    const distance = Math.abs(latestScroll.y - previousScroll.y);
    if (distance) {
      const elapsed = Math.max(16, latestScroll.at - previousScroll.at);
      movingQuickly = movingQuickly || distance / elapsed > .7 || distance > readingViewport().height * .2;
      resting = false; lastMotionAt = latestScroll.at;
      clearReadingTimer();
      if (active) readingTimer = setTimeout(() => {
        readingTimer = null;
        if (!active || disposed) return;
        movingQuickly = false; schedule(); waitForReadingRest();
      }, 220);
    }
    schedule();
  };
  const resize = new ResizeObserver(invalidate);
  resize.observe(article);

  const stop = async (immediate = false, message = 'Musiken är avstängd.') => {
    const owner = ++operation;
    clearReadingTimer(); movingQuickly = false; resting = false;
    active = false; busy = true; sync();
    try { await engine.stop(immediate); }
    catch { message = 'Ljudet kunde inte stängas som väntat. Ladda om sidan innan du försöker igen.'; }
    if (owner !== operation) return;
    if (engine.stats().closeFailed) message = 'Ljudet är tyst, men ljudmotorn kunde inte stängas. Ladda om sidan innan du startar igen.';
    busy = false; status.textContent = message; sync();
  };
  const prepare = () => {
    abort?.abort();
    const request = abort = new AbortController();
    analysis = analyse(article, document.querySelector('h1')?.textContent || document.title, request.signal)
      .then(result => {
        if (disposed || request.signal.aborted || abort !== request) return;
        score = result; geometryDirty = true;
        if (!busy && !active) status.textContent = `Förberedd i ${MODE_LABELS[score.global.mode]}.${score.limited ? ' Ett mycket långt dokument analyseras i begränsat omfång.' : ''}`;
        sync(); schedule();
      }).catch(error => {
        if (disposed || request.signal.aborted || abort !== request || error.name === 'AbortError') return;
        status.textContent = 'Musiken kunde inte förberedas. Ladda om sidan för att försöka igen.';
      });
  };

  toggle.addEventListener('click', async () => {
    if (busy || !score || engine.stats().closeFailed) return;
    if (active) { await stop(); return; }
    if (!preferences.volume) { preferences.volume = 25; save(); }
    const owner = ++operation;
    busy = true; resting = false; sync();
    try {
      if (geometryDirty) measure();
      engine.volume = preferences.volume / 100;
      const started = await engine.start({ ...score.global, ...profileAt(), motifSeed: score.global.seed,
        documentProfile: { valence: score.global.valence, energy: score.global.energy, space: score.global.space,
          thought: score.global.thought, confidence: score.global.confidence, phraseSpace: score.global.phraseSpace,
          words: score.global.words } });
      if (owner !== operation) return;
      if (!started || disposed || document.hidden) { await stop(true); return; }
      active = true;
      movingQuickly = false; lastMotionAt = now();
      previousScroll = latestScroll = { y: readingViewport().top, at: lastMotionAt };
      waitForReadingRest(); schedule();
      engine.duck([...document.querySelectorAll('audio')].some(audio => !audio.paused));
      status.textContent = `Musiken följer läsningen. Grundkaraktär: ${MODE_LABELS[score.global.mode]}.`;
    } catch {
      if (owner !== operation) return;
      await stop(true, 'Ljudet kunde inte starta. Försök med Starta läsmusik igen.');
    } finally { if (owner === operation) { busy = false; sync(); } }
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
    const end = Math.max(start, readingEnd - readingViewport().height + 28);
    window.scrollTo({ top: start + (end - start) * Number(progress.value) / 1000 - (window.visualViewport?.offsetTop || 0), behavior: 'instant' });
    onScroll();
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
    disposed = false; resize.observe(article);
    // Own the previous close even if its promise settles after BFCache return.
    void stop(true, 'Starta läsmusik för att fortsätta.');
    previousScroll = latestScroll = { y: readingViewport().top, at: now() };
    prepare(); invalidate();
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', invalidate, { passive: true });
  window.visualViewport?.addEventListener('resize', invalidate, { passive: true });
  window.visualViewport?.addEventListener('scroll', onScroll, { passive: true });
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
    // Diagnostics only; no DOM, text, graph nodes or document snapshots escape the controller.
    stats() { return { ...engine.stats(), blocks: score?.blocks.length || 0, currentIndex, ranges: ranges.length, readingTimers: Number(readingTimer !== null), active, busy }; }
  };
}
