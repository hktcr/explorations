/* One persistent palette for the library, reader, network and Timkrönikan. */
(() => {
  "use strict";
  if (window.ExplorationsTheme) return;
  const key = "explorationsReadingTheme";
  const themeEvent = "explorations:themechange";
  const root = document.documentElement;
  const original = new WeakMap();
  const darkQuery = /\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi;
  const valid = value => value === "light" || value === "dark";
  let current = "dark";

  function storedTheme() {
    try { const choice = localStorage.getItem(key); return valid(choice) ? choice : "dark"; }
    catch { return "dark"; }
  }
  function syncRoot() {
    if (root.dataset.theme !== current) root.dataset.theme = current;
    if (root.dataset.readingTheme !== current) root.dataset.readingTheme = current;
    if (root.style.colorScheme !== current) root.style.colorScheme = current;
  }
  function visit(rules) {
    for (const rule of Array.from(rules || [])) {
      if (rule.media) {
        const source = original.get(rule) || rule.media.mediaText;
        if (/prefers-color-scheme\s*:\s*dark/i.test(source)) {
          original.set(rule, source);
          /* Keep any additional width, output-media or preference condition. */
          const query = current === "dark" ? "(min-width: 0px)" : "(width < 0px)";
          const target = source.replace(darkQuery, query);
          try { if (rule.media.mediaText !== target) rule.media.mediaText = target; }
          catch { /* Explicit dataset palettes still apply. */ }
        }
      }
      if (rule.cssRules) visit(rule.cssRules);
    }
  }
  function refresh() {
    syncRoot();
    for (const sheet of document.styleSheets) {
      try { visit(sheet.cssRules); }
      catch { /* Never access cross-origin styles. */ }
    }
    for (const button of document.querySelectorAll("[data-xr-global-theme]")) {
      button.setAttribute("aria-pressed", String(current === "light"));
    }
    return current;
  }
  function set(theme, persist = true) {
    const next = valid(theme) ? theme : "dark";
    const changed = current !== next;
    current = next;
    if (persist) {
      try { localStorage.setItem(key, next); } catch { /* Choice remains active in this document. */ }
    }
    refresh();
    if (changed) window.dispatchEvent(new CustomEvent(themeEvent, { detail: { theme: current } }));
    return current;
  }
  function tools() {
    for (const slot of document.querySelectorAll("[data-xr-theme-slot]")) {
      if (slot.querySelector("[data-xr-global-theme]")) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "xr-global-theme-button";
      button.dataset.xrGlobalTheme = "";
      button.lang = "sv";
      button.textContent = "Ljust tema";
      button.addEventListener("click", () => set(current === "dark" ? "light" : "dark"));
      slot.appendChild(button);
    }
    refresh();
  }
  window.ExplorationsTheme = Object.freeze({ get: () => current, set, refresh, event: themeEvent });
  set(storedTheme(), false);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tools, { once: true });
  else tools();
  document.addEventListener("load", event => {
    if (event.target.tagName === "LINK" && event.target.rel === "stylesheet") refresh();
  }, true);
  window.addEventListener("storage", event => {
    if (event.key === key || event.key === null) set(storedTheme(), false);
  });
  window.addEventListener("pageshow", event => {
    if (event.persisted) set(storedTheme(), false);
  });
  /* Retire legacy per-essay initializers that still write root theme attributes. */
  new MutationObserver(syncRoot).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-reading-theme", "style"] });
})();
