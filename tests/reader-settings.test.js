const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const articlePaths = [...index.matchAll(/href="([^"/]+)\/index\.html"/g)]
  .map(match => path.join(root, match[1], "index.html"));
const runtime = fs.readFileSync(path.join(root, "reader-settings.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "reader-settings.css"), "utf8");

test("alla publicerade essäer laddar exakt ett gemensamt läslager", () => {
  assert.ok(articlePaths.length > 0);
  for (const articlePath of articlePaths) {
    const html = fs.readFileSync(articlePath, "utf8");
    assert.equal((html.match(/data-reader-settings-asset="style"/g) || []).length, 1, articlePath);
    assert.equal((html.match(/data-reader-settings-asset="runtime"/g) || []).length, 1, articlePath);
  }
});

test("läsverktygen täcker den gemensamma funktionsuppsättningen", () => {
  for (const hook of [
    "runSearch", "applyTextScale", "applyFont", "applyLineLength", "applyTheme",
    "window.print", "installProgress", "installAudio", "narration.mp3", "method: \"HEAD\"",
    "localStorage", "ResizeObserver", "prefers-color-scheme"
  ]) assert.match(runtime, new RegExp(hook.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(runtime, /speechSynthesis/);
});

test("gränssnittet har touch, små skärmar, utskrift och kontrastlägen", () => {
  for (const hook of [
    "@media (max-width: 700px)", "@media (pointer: coarse)", "min-height: 44px",
    "@media (forced-colors: active)", "@media (prefers-reduced-motion: reduce)", "@media print",
    "::highlight(explorations-reader-search)"
  ]) assert.ok(styles.includes(hook), hook);
});

test("läsverktygen öppnas som en stängbar helskärmsvy på mobil", () => {
  for (const hook of [
    "inset: 0 !important", "height: 100dvh", "max-height: none",
    "body.xr-reader-panel-open", "overflow: hidden", "aria-modal"
  ]) assert.ok(styles.includes(hook) || runtime.includes(hook), hook);
  assert.match(runtime, /aria-label="Stäng läsverktygen">×<\/button>/);
});
