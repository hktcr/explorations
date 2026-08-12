(() => {
  "use strict";

  const VERSION = "20260812-ultimate-1";
  const SEARCH_HIGHLIGHT = "explorations-reader-search";
  const STORAGE = {
    theme: "explorationsReadingTheme",
    lineLength: "explorationsLineLength",
    textScale: "explorationsTextScale",
    font: "explorationsArticleFont"
  };
  const LIMITS = {
    textMin: 0.8,
    textMax: 1.5,
    textStep: 0.1,
    lineMin: 48,
    lineMax: 110,
    lineDefault: 70
  };
  const ROOT_SELECTORS = [
    "article.content",
    "article#article",
    "main article",
    "#articleRoot article",
    "main .content",
    "#articleRoot",
    "article",
    "main"
  ];
  const LEGACY_SELECTORS = [
    "#search", "#font", "#smaller", "#reset", "#larger", "#theme", "#print",
    ".font-controls", ".width", ".text-size-controls", ".search-container",
    ".audio-player"
  ].join(",");
  const SEARCH_SKIP = "script,style,noscript,nav,button,input,textarea,select,[data-xr-reader-ui],[data-engagement-asset]";

  const root = document.documentElement;
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const darkMediaRules = [];
  const fallbackMarks = [];
  let controls = null;
  let contentRoots = [];
  let baseContentSizes = [];
  let currentScale = 1;
  let currentLineLength = null;
  let currentTheme = "auto";
  let currentFont = "serif";
  let userThemePreference = false;
  let resizeObserver = null;

  const readStorage = key => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const writeStorage = (key, value) => {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      // Preferences remain active for the current page when storage is unavailable.
    }
  };

  const collectDarkMediaRules = ruleList => {
    Array.from(ruleList || []).forEach(rule => {
      const mediaText = rule.media?.mediaText || "";
      if (/prefers-color-scheme\s*:\s*dark/i.test(mediaText)) {
        darkMediaRules.push({ rule, original: mediaText });
        return;
      }
      if (rule.cssRules) collectDarkMediaRules(rule.cssRules);
    });
  };

  const collectThemeRules = () => {
    darkMediaRules.length = 0;
    Array.from(document.styleSheets).forEach(sheet => {
      try {
        collectDarkMediaRules(sheet.cssRules);
      } catch {
        // Cross-origin font stylesheets are intentionally inaccessible.
      }
    });
  };

  const articleRoot = () => {
    for (const selector of ROOT_SELECTORS) {
      const candidate = document.querySelector(selector);
      if (candidate && candidate.textContent.trim().length > 80) return candidate;
    }
    return null;
  };

  const identifyContentRoots = () => {
    const primary = articleRoot();
    const roots = [primary, ...document.querySelectorAll(".standfirst")].filter(Boolean);
    contentRoots = [...new Set(roots)];
    root.style.setProperty("font-size", "16px", "important");
    baseContentSizes = contentRoots.map(element => {
      element.style.removeProperty("font-size");
      const size = Number.parseFloat(getComputedStyle(element).fontSize);
      return Number.isFinite(size) && size > 0 ? size : 16;
    });
  };

  const syncTextControls = () => {
    if (!controls) return;
    controls.textValue.textContent = `${Math.round(currentScale * 100)} %`;
    controls.smaller.disabled = currentScale <= LIMITS.textMin + 0.001;
    controls.larger.disabled = currentScale >= LIMITS.textMax - 0.001;
  };

  const applyTextScale = (value, persist = false) => {
    const numeric = Number(value);
    currentScale = Number.isFinite(numeric)
      ? Math.min(LIMITS.textMax, Math.max(LIMITS.textMin, Math.round(numeric * 10) / 10))
      : 1;
    root.style.setProperty("font-size", `${16 * currentScale}px`, "important");
    root.style.setProperty("--reader-text-scale", String(currentScale));
    contentRoots.forEach((element, index) => {
      element.style.setProperty("font-size", `${baseContentSizes[index] * currentScale}px`, "important");
    });
    if (persist) writeStorage(STORAGE.textScale, String(currentScale));
    syncTextControls();
  };

  const syncLineControls = () => {
    if (!controls) return;
    controls.lineRange.value = String(currentLineLength ?? LIMITS.lineDefault);
    controls.lineValue.textContent = currentLineLength === null ? "Standard" : `${currentLineLength} tecken`;
    controls.lineReset.disabled = currentLineLength === null;
  };

  const applyLineLength = (value, persist = false) => {
    const numeric = value === null || value === "" ? NaN : Number(value);
    currentLineLength = Number.isFinite(numeric)
      ? Math.min(LIMITS.lineMax, Math.max(LIMITS.lineMin, Math.round(numeric)))
      : null;
    if (currentLineLength === null) {
      root.removeAttribute("data-reading-width");
      root.style.removeProperty("--reader-line-length");
    } else {
      root.dataset.readingWidth = String(currentLineLength);
      root.style.setProperty("--reader-line-length", `${currentLineLength}ch`);
    }
    if (persist) writeStorage(STORAGE.lineLength, currentLineLength === null ? null : String(currentLineLength));
    syncLineControls();
  };

  const syncFontControls = () => {
    if (!controls) return;
    controls.fontButtons.forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.readerFont === currentFont));
    });
  };

  const applyFont = (font, persist = false) => {
    currentFont = font === "sans" ? "sans" : "serif";
    const family = currentFont === "sans"
      ? "Inter, system-ui, -apple-system, sans-serif"
      : "Merriweather, Georgia, 'Times New Roman', serif";
    root.style.setProperty("--body", family);
    root.style.setProperty("--font-body", family);
    contentRoots.forEach(element => element.style.setProperty("font-family", family, "important"));
    if (persist) writeStorage(STORAGE.font, currentFont);
    syncFontControls();
  };

  const syncThemeControls = () => {
    if (!controls) return;
    controls.themeButtons.forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.readerTheme === currentTheme));
    });
  };

  const applyTheme = (theme, persist = false) => {
    currentTheme = ["auto", "light", "dark"].includes(theme) ? theme : "auto";
    const resolved = currentTheme === "auto" ? (systemTheme.matches ? "dark" : "light") : currentTheme;
    darkMediaRules.forEach(({ rule, original }) => {
      try {
        rule.media.mediaText = currentTheme === "auto" ? original : (resolved === "dark" ? "all" : "not all");
      } catch {
        // The explicit data attributes still control modern article palettes.
      }
    });
    if (currentTheme === "auto") root.removeAttribute("data-theme");
    else root.dataset.theme = currentTheme;
    root.dataset.readingTheme = resolved;
    root.style.colorScheme = resolved;
    if (persist) {
      userThemePreference = currentTheme !== "auto";
      writeStorage(STORAGE.theme, currentTheme === "auto" ? null : currentTheme);
    }
    syncThemeControls();
  };

  const clearFallbackMarks = () => {
    while (fallbackMarks.length) {
      const mark = fallbackMarks.pop();
      if (!mark?.parentNode) continue;
      const parent = mark.parentNode;
      mark.replaceWith(document.createTextNode(mark.textContent));
      parent.normalize();
    }
  };

  const clearSearch = () => {
    if (globalThis.CSS?.highlights) CSS.highlights.delete(SEARCH_HIGHLIGHT);
    clearFallbackMarks();
    if (controls) controls.searchStatus.textContent = "";
  };

  const searchableTextNodes = container => {
    const nodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        return parent && !parent.closest(SEARCH_SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  };

  const searchWithHighlights = (nodes, query) => {
    const ranges = [];
    const needle = query.toLocaleLowerCase();
    for (const node of nodes) {
      const haystack = node.nodeValue.toLocaleLowerCase();
      let index = 0;
      while ((index = haystack.indexOf(needle, index)) !== -1 && ranges.length < 500) {
        const range = new Range();
        range.setStart(node, index);
        range.setEnd(node, index + query.length);
        ranges.push(range);
        index += Math.max(1, query.length);
      }
    }
    if (ranges.length) CSS.highlights.set(SEARCH_HIGHLIGHT, new Highlight(...ranges));
    return { count: ranges.length, first: ranges[0]?.startContainer?.parentElement || null };
  };

  const searchWithMarks = (nodes, query) => {
    const needle = query.toLocaleLowerCase();
    let count = 0;
    let first = null;
    for (const originalNode of nodes) {
      if (count >= 500 || !originalNode.parentNode) break;
      const text = originalNode.nodeValue;
      const lower = text.toLocaleLowerCase();
      let cursor = 0;
      let index = lower.indexOf(needle);
      if (index === -1) continue;
      const fragment = document.createDocumentFragment();
      while (index !== -1 && count < 500) {
        fragment.append(document.createTextNode(text.slice(cursor, index)));
        const mark = document.createElement("mark");
        mark.className = "xr-reader-search-mark";
        mark.textContent = text.slice(index, index + query.length);
        mark.dataset.xrReaderUi = "search";
        fragment.append(mark);
        fallbackMarks.push(mark);
        if (!first) first = mark;
        count += 1;
        cursor = index + query.length;
        index = lower.indexOf(needle, cursor);
      }
      fragment.append(document.createTextNode(text.slice(cursor)));
      originalNode.replaceWith(fragment);
    }
    return { count, first };
  };

  const runSearch = query => {
    clearSearch();
    const trimmed = query.trim();
    const container = articleRoot();
    if (!trimmed || !container) return;
    const nodes = searchableTextNodes(container);
    const result = globalThis.CSS?.highlights && typeof globalThis.Highlight === "function"
      ? searchWithHighlights(nodes, trimmed)
      : searchWithMarks(nodes, trimmed);
    controls.searchStatus.textContent = result.count === 1 ? "1 träff" : `${result.count} träffar`;
    result.first?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };

  const formatTime = value => {
    if (!Number.isFinite(value)) return "0:00";
    const minutes = Math.floor(value / 60);
    return `${minutes}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
  };

  const installAudio = async () => {
    const existing = document.querySelector("audio#narration, audio[src*='narration.mp3']");
    const source = existing?.currentSrc || existing?.getAttribute("src") || "narration.mp3";
    const url = new URL(source, location.href);
    let available = false;
    try {
      const response = await fetch(url, { method: "HEAD", cache: "no-store" });
      available = response.ok && !/text\/html/i.test(response.headers.get("content-type") || "");
    } catch {
      available = false;
    }
    if (!available || !controls) return;

    const audio = existing || new Audio(url.href);
    audio.preload = "metadata";
    controls.audio.hidden = false;
    controls.audioToggle.addEventListener("click", async () => {
      if (audio.paused) {
        try {
          await audio.play();
        } catch {
          controls.audioStatus.textContent = "Ljudet kunde inte startas";
        }
      } else audio.pause();
    });
    audio.addEventListener("play", () => {
      controls.audioToggle.textContent = "Pausa";
      controls.audioToggle.setAttribute("aria-label", "Pausa uppläsningen");
    });
    audio.addEventListener("pause", () => {
      controls.audioToggle.textContent = "Spela";
      controls.audioToggle.setAttribute("aria-label", "Spela uppläsningen");
    });
    audio.addEventListener("timeupdate", () => {
      controls.audioSeek.value = audio.duration ? String(100 * audio.currentTime / audio.duration) : "0";
      controls.audioTime.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
    });
    controls.audioSeek.addEventListener("input", () => {
      if (audio.duration) audio.currentTime = Number(controls.audioSeek.value) * audio.duration / 100;
    });
    const speeds = [1, 1.25, 1.5, 2];
    controls.audioSpeed.addEventListener("click", () => {
      const index = speeds.indexOf(audio.playbackRate);
      const next = speeds[(index + 1) % speeds.length];
      audio.playbackRate = next;
      controls.audioSpeed.textContent = `${next}×`;
    });
  };

  const ensureToolbar = () => {
    let toolbar = document.querySelector(".toolbar, .tools");
    if (!toolbar) {
      toolbar = document.createElement("nav");
      toolbar.className = "xr-reader-toolbar";
      toolbar.setAttribute("aria-label", "Läsverktyg");
      document.body.prepend(toolbar);
    }
    if (!toolbar.querySelector("a[href*='index.html'], a[href='../'], a[href$='/explorations/']")) {
      const library = document.createElement("a");
      library.className = "xr-reader-library-link";
      library.href = "../index.html";
      library.textContent = "Bibliotek";
      toolbar.prepend(library);
    }
    toolbar.querySelectorAll(LEGACY_SELECTORS).forEach(element => {
      if (!element.closest("[data-xr-reader-ui]")) element.dataset.xrLegacyReaderControl = "true";
    });
    toolbar.classList.add("xr-reader-toolbar-host");
    return toolbar;
  };

  const installProgress = () => {
    let progress = document.querySelector(".progress, #progress");
    if (!progress) {
      progress = document.createElement("div");
      document.body.prepend(progress);
    }
    progress.classList.add("xr-reader-progress");
    progress.setAttribute("aria-hidden", "true");
    const update = () => {
      const page = document.documentElement;
      const maximum = page.scrollHeight - page.clientHeight;
      progress.style.width = `${maximum > 0 ? 100 * page.scrollTop / maximum : 0}%`;
    };
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update, { passive: true });
    update();
  };

  const syncToolbarOffset = toolbar => {
    const sync = () => root.style.setProperty("--reader-toolbar-height", `${Math.ceil(toolbar.getBoundingClientRect().height + 12)}px`);
    resizeObserver?.disconnect();
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(sync);
      resizeObserver.observe(toolbar);
    }
    sync();
  };

  const placePanel = () => {
    if (!controls || controls.panel.hidden || matchMedia("(max-width: 700px)").matches) return;
    const triggerRect = controls.trigger.getBoundingClientRect();
    const panelRect = controls.panel.getBoundingClientRect();
    const margin = 12;
    const left = Math.max(margin, Math.min(innerWidth - panelRect.width - margin, triggerRect.right - panelRect.width));
    let top = triggerRect.bottom + 8;
    if (top + panelRect.height > innerHeight - margin && triggerRect.top > panelRect.height + margin) {
      top = triggerRect.top - panelRect.height - 8;
    }
    controls.panel.style.left = `${left}px`;
    controls.panel.style.top = `${Math.max(margin, top)}px`;
  };

  const closePanel = (returnFocus = false) => {
    if (!controls || controls.panel.hidden) return;
    controls.panel.hidden = true;
    controls.trigger.setAttribute("aria-expanded", "false");
    document.body.classList.remove("xr-reader-panel-open");
    if (returnFocus) controls.trigger.focus();
  };

  const openPanel = () => {
    controls.panel.hidden = false;
    controls.trigger.setAttribute("aria-expanded", "true");
    document.body.classList.add("xr-reader-panel-open");
    requestAnimationFrame(() => {
      placePanel();
      controls.search.focus();
    });
  };

  const resetAll = () => {
    Object.values(STORAGE).forEach(key => writeStorage(key, null));
    userThemePreference = false;
    applyTextScale(1);
    applyLineLength(null);
    applyFont("serif");
    applyTheme("auto");
    controls.search.value = "";
    clearSearch();
    controls.liveStatus.textContent = "Läsinställningarna är återställda";
  };

  const buildControls = toolbar => {
    const wrapper = document.createElement("div");
    wrapper.className = "reader-settings";
    wrapper.dataset.xrReaderUi = VERSION;
    wrapper.lang = "sv";
    wrapper.innerHTML = `
      <button class="reader-settings__trigger" type="button" aria-expanded="false" aria-controls="readerSettingsPanel">Läsverktyg</button>
      <section class="reader-settings__panel" id="readerSettingsPanel" role="dialog" aria-modal="false" aria-label="Läsverktyg" hidden>
        <header class="reader-settings__header">
          <h2 class="reader-settings__heading">Läsverktyg</h2>
          <button class="reader-settings__close" type="button" aria-label="Stäng läsverktygen">Stäng</button>
        </header>
        <div class="reader-settings__search-row">
          <label for="readerArticleSearch">Sök i essän</label>
          <input id="readerArticleSearch" class="reader-settings__search" type="search" autocomplete="off" enterkeyhint="search">
          <output class="reader-settings__search-status" for="readerArticleSearch" aria-live="polite"></output>
        </div>
        <div class="reader-settings__row">
          <div class="reader-settings__label-line"><span>Textstorlek</span><output class="reader-settings__value reader-settings__text-value">100 %</output></div>
          <div class="reader-settings__button-grid reader-settings__button-grid--three" role="group" aria-label="Textstorlek">
            <button class="reader-settings__smaller" type="button" aria-label="Mindre text">A−</button>
            <button class="reader-settings__text-reset" type="button">100 %</button>
            <button class="reader-settings__larger" type="button" aria-label="Större text">A+</button>
          </div>
        </div>
        <div class="reader-settings__row">
          <div class="reader-settings__label-line"><span>Typsnitt</span></div>
          <div class="reader-settings__button-grid" role="group" aria-label="Typsnitt">
            <button type="button" data-reader-font="serif" aria-pressed="false">Serif</button>
            <button type="button" data-reader-font="sans" aria-pressed="false">Sans serif</button>
          </div>
        </div>
        <div class="reader-settings__row">
          <div class="reader-settings__label-line"><label for="readerLineLength">Radbredd</label><output class="reader-settings__value reader-settings__line-value" for="readerLineLength">Standard</output></div>
          <div class="reader-settings__slider-line">
            <input class="reader-settings__range" id="readerLineLength" type="range" min="${LIMITS.lineMin}" max="${LIMITS.lineMax}" value="${LIMITS.lineDefault}" step="1">
            <button class="reader-settings__line-reset" type="button">Standard</button>
          </div>
        </div>
        <div class="reader-settings__row">
          <div class="reader-settings__label-line"><span>Tema</span></div>
          <div class="reader-settings__button-grid reader-settings__button-grid--three" role="group" aria-label="Färgtema">
            <button type="button" data-reader-theme="auto" aria-pressed="false">Automatiskt</button>
            <button type="button" data-reader-theme="light" aria-pressed="false">Ljust</button>
            <button type="button" data-reader-theme="dark" aria-pressed="false">Mörkt</button>
          </div>
        </div>
        <div class="reader-settings__row reader-settings__audio" hidden>
          <div class="reader-settings__label-line"><span>Uppläsning</span><output class="reader-settings__audio-status" aria-live="polite"></output></div>
          <div class="reader-settings__audio-controls">
            <button class="reader-settings__audio-toggle" type="button" aria-label="Spela uppläsningen">Spela</button>
            <span class="reader-settings__audio-time">0:00 / 0:00</span>
            <input class="reader-settings__audio-seek" type="range" min="0" max="100" value="0" step="0.1" aria-label="Position i uppläsningen">
            <button class="reader-settings__audio-speed" type="button" aria-label="Ändra uppläsningshastighet">1×</button>
          </div>
        </div>
        <div class="reader-settings__actions">
          <button class="reader-settings__print" type="button">Skriv ut</button>
          <button class="reader-settings__reset-all" type="button">Återställ allt</button>
        </div>
        <p class="reader-settings__live-status" aria-live="polite"></p>
      </section>`;
    toolbar.append(wrapper);

    controls = {
      wrapper,
      trigger: wrapper.querySelector(".reader-settings__trigger"),
      panel: wrapper.querySelector(".reader-settings__panel"),
      close: wrapper.querySelector(".reader-settings__close"),
      search: wrapper.querySelector(".reader-settings__search"),
      searchStatus: wrapper.querySelector(".reader-settings__search-status"),
      smaller: wrapper.querySelector(".reader-settings__smaller"),
      larger: wrapper.querySelector(".reader-settings__larger"),
      textReset: wrapper.querySelector(".reader-settings__text-reset"),
      textValue: wrapper.querySelector(".reader-settings__text-value"),
      fontButtons: [...wrapper.querySelectorAll("[data-reader-font]")],
      lineRange: wrapper.querySelector(".reader-settings__range"),
      lineValue: wrapper.querySelector(".reader-settings__line-value"),
      lineReset: wrapper.querySelector(".reader-settings__line-reset"),
      themeButtons: [...wrapper.querySelectorAll("[data-reader-theme]")],
      print: wrapper.querySelector(".reader-settings__print"),
      resetAll: wrapper.querySelector(".reader-settings__reset-all"),
      liveStatus: wrapper.querySelector(".reader-settings__live-status"),
      audio: wrapper.querySelector(".reader-settings__audio"),
      audioToggle: wrapper.querySelector(".reader-settings__audio-toggle"),
      audioTime: wrapper.querySelector(".reader-settings__audio-time"),
      audioSeek: wrapper.querySelector(".reader-settings__audio-seek"),
      audioSpeed: wrapper.querySelector(".reader-settings__audio-speed"),
      audioStatus: wrapper.querySelector(".reader-settings__audio-status")
    };

    controls.trigger.addEventListener("click", event => {
      event.stopPropagation();
      if (controls.panel.hidden) openPanel();
      else closePanel();
    });
    controls.close.addEventListener("click", () => closePanel(true));
    controls.panel.addEventListener("click", event => event.stopPropagation());
    controls.search.addEventListener("input", event => runSearch(event.target.value));
    controls.smaller.addEventListener("click", () => applyTextScale(currentScale - LIMITS.textStep, true));
    controls.larger.addEventListener("click", () => applyTextScale(currentScale + LIMITS.textStep, true));
    controls.textReset.addEventListener("click", () => applyTextScale(1, true));
    controls.fontButtons.forEach(button => button.addEventListener("click", () => applyFont(button.dataset.readerFont, true)));
    controls.lineRange.addEventListener("input", event => applyLineLength(event.target.value, true));
    controls.lineReset.addEventListener("click", () => applyLineLength(null, true));
    controls.themeButtons.forEach(button => button.addEventListener("click", () => applyTheme(button.dataset.readerTheme, true)));
    controls.print.addEventListener("click", () => window.print());
    controls.resetAll.addEventListener("click", resetAll);
    document.addEventListener("click", () => closePanel());
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        if (controls.search.value) {
          controls.search.value = "";
          clearSearch();
        } else closePanel(true);
      }
    });
    addEventListener("resize", placePanel, { passive: true });
    addEventListener("scroll", placePanel, { passive: true });
  };

  const applySavedPreferences = () => {
    const savedScale = Number(readStorage(STORAGE.textScale));
    const savedLine = Number(readStorage(STORAGE.lineLength));
    const savedFont = readStorage(STORAGE.font);
    const savedTheme = readStorage(STORAGE.theme);
    userThemePreference = savedTheme === "light" || savedTheme === "dark";
    applyTextScale(savedScale >= LIMITS.textMin && savedScale <= LIMITS.textMax ? savedScale : 1);
    applyLineLength(savedLine >= LIMITS.lineMin && savedLine <= LIMITS.lineMax ? savedLine : null);
    applyFont(savedFont === "sans" ? "sans" : "serif");
    applyTheme(userThemePreference ? savedTheme : "auto");
  };

  const install = () => {
    if (controls || document.querySelector("[data-xr-reader-ui]")) return true;
    const content = articleRoot();
    if (!document.body || !content) return false;
    collectThemeRules();
    identifyContentRoots();
    const toolbar = ensureToolbar();
    buildControls(toolbar);
    document.body.classList.add("xr-reader-ready");
    root.dataset.readerVersion = VERSION;
    applySavedPreferences();
    installProgress();
    installAudio();
    syncToolbarOffset(toolbar);
    return true;
  };

  const start = () => {
    if (install()) return;
    const observer = new MutationObserver(() => {
      if (install()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  const followSystemTheme = () => {
    if (!userThemePreference && currentTheme === "auto") applyTheme("auto");
  };
  if (typeof systemTheme.addEventListener === "function") systemTheme.addEventListener("change", followSystemTheme);
  else if (typeof systemTheme.addListener === "function") systemTheme.addListener(followSystemTheme);
})();
