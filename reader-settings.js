(() => {
  "use strict";

  const STORAGE = {
    theme: "explorationsReadingTheme",
    lineLength: "explorationsLineLength"
  };
  const LIMITS = { min: 48, max: 110, defaultPosition: 70 };
  const root = document.documentElement;
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const darkMediaRules = [];
  let controls = null;
  let hasThemePreference = false;
  let currentTheme = "light";
  let currentLineLength = null;

  const readStorage = key => {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  };

  const writeStorage = (key, value) => {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (error) {
      // Reading preferences still work for this page when storage is unavailable.
    }
  };

  const collectDarkMediaRules = ruleList => {
    Array.from(ruleList || []).forEach(rule => {
      const mediaText = rule.media?.mediaText || "";
      if (/prefers-color-scheme\s*:\s*dark/i.test(mediaText)) {
        darkMediaRules.push(rule);
        return;
      }
      if (rule.cssRules) collectDarkMediaRules(rule.cssRules);
    });
  };

  Array.from(document.styleSheets).forEach(sheet => {
    try {
      collectDarkMediaRules(sheet.cssRules);
    } catch (error) {
      // Cross-origin font stylesheets are intentionally inaccessible.
    }
  });

  const syncThemeButtons = () => {
    if (!controls) return;
    controls.themeButtons.forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.readerTheme === currentTheme));
    });
  };

  const applyTheme = (theme, persist = false) => {
    currentTheme = theme === "dark" ? "dark" : "light";
    darkMediaRules.forEach(rule => {
      try {
        rule.media.mediaText = currentTheme === "dark" ? "all" : "not all";
      } catch (error) {
        // The core palette still follows data-reading-theme if a rule is immutable.
      }
    });
    root.dataset.readingTheme = currentTheme;
    root.style.colorScheme = currentTheme;
    if (persist) {
      hasThemePreference = true;
      writeStorage(STORAGE.theme, currentTheme);
    }
    syncThemeButtons();
  };

  const syncLineControls = () => {
    if (!controls) return;
    controls.range.value = String(currentLineLength ?? LIMITS.defaultPosition);
    controls.output.textContent = currentLineLength === null ? "Default" : `${currentLineLength} ch`;
    controls.reset.disabled = currentLineLength === null;
  };

  const setLineLength = (value, persist = false) => {
    const numeric = value === null || value === undefined || value === "" ? NaN : Number(value);
    currentLineLength = Number.isFinite(numeric)
      ? Math.min(LIMITS.max, Math.max(LIMITS.min, Math.round(numeric)))
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

  const savedTheme = readStorage(STORAGE.theme);
  hasThemePreference = savedTheme === "light" || savedTheme === "dark";
  applyTheme(hasThemePreference ? savedTheme : (systemTheme.matches ? "dark" : "light"));

  const savedLineLength = Number(readStorage(STORAGE.lineLength));
  setLineLength(savedLineLength >= LIMITS.min && savedLineLength <= LIMITS.max ? savedLineLength : null);

  const placePanel = () => {
    if (!controls || controls.panel.hidden) return;
    const triggerRect = controls.trigger.getBoundingClientRect();
    const panelRect = controls.panel.getBoundingClientRect();
    const margin = 12;
    const left = Math.max(margin, Math.min(window.innerWidth - panelRect.width - margin, triggerRect.right - panelRect.width));
    let top = triggerRect.bottom + 8;
    if (top + panelRect.height > window.innerHeight - margin && triggerRect.top > panelRect.height + margin) {
      top = triggerRect.top - panelRect.height - 8;
    }
    controls.panel.style.left = `${left}px`;
    controls.panel.style.top = `${Math.max(margin, top)}px`;
  };

  const closePanel = () => {
    if (!controls) return;
    controls.panel.hidden = true;
    controls.trigger.setAttribute("aria-expanded", "false");
  };

  const openPanel = () => {
    controls.panel.hidden = false;
    controls.trigger.setAttribute("aria-expanded", "true");
    window.requestAnimationFrame(placePanel);
  };

  const installControls = () => {
    if (controls || document.querySelector(".reader-settings")) return Boolean(controls);
    const toolbar = document.querySelector(".toolbar");
    if (!toolbar) return false;

    const wrapper = document.createElement("div");
    wrapper.className = "reader-settings";
    wrapper.innerHTML = `
      <button class="reader-settings__trigger" type="button" aria-expanded="false" aria-controls="readerSettingsPanel">Reading</button>
      <section class="reader-settings__panel" id="readerSettingsPanel" role="dialog" aria-label="Reading settings" hidden>
        <h2 class="reader-settings__heading">Reading settings</h2>
        <div class="reader-settings__row">
          <div class="reader-settings__label-line"><label for="readerLineLength">Line length</label><output class="reader-settings__value" for="readerLineLength">Default</output></div>
          <div class="reader-settings__slider-line">
            <input class="reader-settings__range" id="readerLineLength" type="range" min="${LIMITS.min}" max="${LIMITS.max}" value="${LIMITS.defaultPosition}" step="1" aria-label="Line length">
            <button class="reader-settings__reset" type="button">Default</button>
          </div>
        </div>
        <div class="reader-settings__row">
          <div class="reader-settings__label-line"><span>Theme</span></div>
          <div class="reader-settings__theme" role="group" aria-label="Color theme">
            <button class="reader-settings__theme-button" type="button" data-reader-theme="light" aria-pressed="false">Light</button>
            <button class="reader-settings__theme-button" type="button" data-reader-theme="dark" aria-pressed="false">Dark</button>
          </div>
        </div>
      </section>`;
    toolbar.appendChild(wrapper);

    controls = {
      wrapper,
      trigger: wrapper.querySelector(".reader-settings__trigger"),
      panel: wrapper.querySelector(".reader-settings__panel"),
      range: wrapper.querySelector(".reader-settings__range"),
      output: wrapper.querySelector(".reader-settings__value"),
      reset: wrapper.querySelector(".reader-settings__reset"),
      themeButtons: Array.from(wrapper.querySelectorAll(".reader-settings__theme-button"))
    };

    controls.trigger.addEventListener("click", event => {
      event.stopPropagation();
      if (controls.panel.hidden) openPanel();
      else closePanel();
    });
    controls.panel.addEventListener("click", event => event.stopPropagation());
    controls.range.addEventListener("input", event => setLineLength(event.target.value, true));
    controls.reset.addEventListener("click", () => setLineLength(null, true));
    controls.themeButtons.forEach(button => {
      button.addEventListener("click", () => applyTheme(button.dataset.readerTheme, true));
    });
    document.addEventListener("click", closePanel);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !controls.panel.hidden) {
        closePanel();
        controls.trigger.focus();
      }
    });
    window.addEventListener("resize", placePanel, { passive: true });
    window.addEventListener("scroll", placePanel, { passive: true });

    syncLineControls();
    syncThemeButtons();
    return true;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installControls);
  } else {
    installControls();
  }

  if (!installControls()) {
    const observer = new MutationObserver(() => {
      if (installControls()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  const followSystemTheme = event => {
    if (!hasThemePreference) applyTheme(event.matches ? "dark" : "light");
  };
  if (typeof systemTheme.addEventListener === "function") systemTheme.addEventListener("change", followSystemTheme);
  else if (typeof systemTheme.addListener === "function") systemTheme.addListener(followSystemTheme);
})();
