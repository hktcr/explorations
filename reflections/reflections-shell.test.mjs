import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

const ROOT = new URL("../", import.meta.url);

async function text(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

async function json(path) {
  return JSON.parse(await text(path));
}

function tags(source, name) {
  return [...source.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(match => match[0]);
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? "";
  }
  return result;
}

function hasClass(attrs, className) {
  return String(attrs.class || "").split(/\s+/).includes(className);
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  values.forEach(value => seen.has(value) ? duplicates.add(value) : seen.add(value));
  return [...duplicates];
}

function collectKeys(value, keys = new Set()) {
  if (!value || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    value.forEach(item => collectKeys(item, keys));
    return keys;
  }
  Object.entries(value).forEach(([key, child]) => {
    keys.add(key);
    collectKeys(child, keys);
  });
  return keys;
}

function collectStringValues(value, strings = []) {
  if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) value.forEach(item => collectStringValues(item, strings));
  else if (value && typeof value === "object") Object.values(value).forEach(item => collectStringValues(item, strings));
  return strings;
}

describe("artikelregistret", () => {
  test("innehåller exakt EXP#1 till EXP#26 utan duplicerade identiteter", async () => {
    const registry = await json("reflections/article-registry.json");
    assert.equal(registry.schemaVersion, 1);
    assert.equal(registry.articles.length, 26);

    const ids = registry.articles.map(article => article.id);
    const slugs = registry.articles.map(article => article.slug);
    const paths = registry.articles.map(article => article.path);
    assert.deepEqual(duplicateValues(ids), []);
    assert.deepEqual(duplicateValues(slugs), []);
    assert.deepEqual(duplicateValues(paths), []);
    assert.deepEqual(
      [...ids].sort((left, right) => Number(left.slice(4)) - Number(right.slice(4))),
      Array.from({ length: 26 }, (_, index) => `EXP#${index + 1}`)
    );

    registry.articles.forEach(article => {
      assert.match(article.id, /^EXP#[1-9][0-9]*$/);
      assert.match(article.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.equal(article.path, `${article.slug}/index.html`);
      assert.ok(article.title.trim(), `${article.id} saknar titel`);
      assert.match(article.rootSelector, /article/);
      assert.match(article.toolbarSelector, /^\.(?:toolbar|tools)$/);
      assert.ok(["static", "async-fragments"].includes(article.loadMode));
    });
    assert.deepEqual(
      registry.articles.filter(article => article.loadMode === "async-fragments").map(article => article.id),
      ["EXP#17"]
    );
  });

  test("matchar varje artikels data-id och motsvarande bibliotekskort", async () => {
    const registry = await json("reflections/article-registry.json");
    const library = await text("index.html");
    const cards = tags(library, "a")
      .map(attributes)
      .filter(attrs => hasClass(attrs, "article-card") && attrs["data-exploration-id"]);

    assert.equal(cards.length, 26);
    assert.deepEqual(duplicateValues(cards.map(card => card["data-exploration-id"])), []);
    assert.deepEqual(duplicateValues(cards.map(card => card.href)), []);

    for (const article of registry.articles) {
      const source = await text(article.path);
      const html = attributes(tags(source, "html")[0] || "");
      const matchingCards = cards.filter(card => card["data-exploration-id"] === article.id);
      assert.equal(html["data-exploration-id"], article.id, `${article.path} har fel data-exploration-id`);
      assert.equal(matchingCards.length, 1, `${article.id} ska ha exakt ett bibliotekskort`);
      assert.equal(matchingCards[0].href, article.path, `${article.id} har fel sökväg i biblioteket`);
    }

    assert.deepEqual(
      new Set(cards.map(card => card["data-exploration-id"])),
      new Set(registry.articles.map(article => article.id))
    );
  });
});

describe("skal och resursladdning", () => {
  test("alla 26 artikel-HTML laddar exakt en publik engagement-CSS och runtime", async () => {
    const registry = await json("reflections/article-registry.json");
    for (const article of registry.articles) {
      const source = await text(article.path);
      const styles = tags(source, "link").map(attributes).filter(attrs => attrs["data-engagement-asset"] === "style");
      const runtimes = tags(source, "script").map(attributes).filter(attrs => attrs["data-engagement-asset"] === "runtime");

      assert.equal(styles.length, 1, `${article.path} ska ladda exakt en engagement-stilmall`);
      assert.equal(styles[0].rel, "stylesheet");
      assert.equal(styles[0].href, "../engagement/engagement.css");
      assert.equal(runtimes.length, 1, `${article.path} ska ladda exakt en engagement-runtime`);
      assert.equal(runtimes[0].type, "module");
      assert.equal(runtimes[0].src, "../engagement/engagement.js");

      assert.doesNotMatch(source, /(?:src|href)=["'][^"']*reflections\/(?:reflections\.js|reflections\.css)["']/i,
        `${article.path} ska inte koppla den privata runtimen direkt`);
    }
  });

  test("engagement.js laddar den privata runtimen separat och felisolerat", async () => {
    const source = await text("engagement/engagement.js");
    assert.match(source, /import\(\s*["']\.\.\/reflections\/reflections\.js["']\s*\)/);
    assert.match(source, /\.then\(\s*module\s*=>\s*module\.startReflections\(\)\s*\)/);
    assert.match(source, /Det privata reflektionsspåret kunde inte laddas/);
    assert.match(source, /start\(\)\.catch/);
    assert.doesNotMatch(source, /^\s*import\s+[^\n;]*from\s+["'][^"']*reflections\/reflections\.js["']/m,
      "den privata runtimen ska dynamiskt laddas, inte vara en statisk publik kärndependens");
  });
});

describe("publik och privat dataseparation", () => {
  test("publik JSON och schema innehåller inga privata lagrings- eller exportfält", async () => {
    const publicModel = await json("engagement/engagement.public.json");
    const publicSchema = await json("engagement/engagement.schema.json");
    const forbidden = [
      "anchors", "comments", "revisions", "exports", "imports",
      "anchorId", "currentRevision", "savedAt", "sourcePackageId",
      "replyTo", "textQuote", "textPosition", "documentFingerprint",
      "signature", "packageType", "packageId"
    ];

    for (const [label, model] of [["engagement.public.json", publicModel], ["engagement.schema.json", publicSchema]]) {
      const keys = collectKeys(model);
      assert.deepEqual(forbidden.filter(key => keys.has(key)), [], `${label} läcker privata modellfält`);
      const values = collectStringValues(model).map(value => value.toLowerCase());
      assert.ok(!values.includes("private"), `${label} innehåller privat synlighetsstatus`);
      assert.ok(!values.includes("draft"), `${label} innehåller utkaststatus`);
    }
  });

  test("publika modeller refererar inte till privata filer eller IndexedDB", async () => {
    const sources = await Promise.all([
      text("engagement/engagement.public.json"),
      text("engagement/engagement.schema.json"),
      text("engagement/engagement-core.mjs")
    ]);
    sources.forEach(source => {
      assert.doesNotMatch(source, /reflections-(?:store|core)|article-registry|indexeddb|openreflectionstore/i);
    });
  });
});

describe("förväntade runtime- och CSS-krokar", () => {
  test("runtimen har krokar för lagring, register, dynamiskt innehåll, urval, export och import", async () => {
    const source = await text("reflections/reflections.js");
    const required = [
      [/import\s*\{\s*openReflectionStore\s*\}\s*from\s*["']\.\/reflections-store\.mjs["']/, "privat lagringsadapter"],
      [/new URL\(["']article-registry\.json["'],\s*ASSET_ROOT\)/, "artikelregister"],
      [/new URL\(["']reflections\.css["'],\s*ASSET_ROOT\)/, "privat stilmall"],
      [/export async function startReflections\s*\(/, "fristående startfunktion"],
      [/document\.documentElement\.dataset\.explorationId/, "stabilt artikel-id"],
      [/new MutationObserver\s*\(/, "asynkront artikelinnehåll"],
      [/addEventListener\(["']selectionchange["']/, "textmarkering"],
      [/id:\s*["']xr-trigger["']/, "panelöppnare"],
      [/id:\s*["']xr-selection-action["']/, "åtgärd vid markering"],
      [/className:\s*["']xr-panel["']/, "reflektionspanel"],
      [/commentsForMode\s*\(/, "exportlägen"],
      [/exportToMarkdown\s*\(/, "Markdown-export"],
      [/parsePackage\s*\(/, "paketparsning"],
      [/previewPackage\s*\(/, "importförhandsgranskning"],
      [/recordExport\s*\(/, "exporthistorik"],
      [/applyPackage\s*\(/, "returimport"],
      [/globalThis\.CSS\?\.highlights/, "CSS Highlights"],
      [/xr-highlight-fallback/, "fallback-markering"],
      [/Privat på denna enhet/, "tydlig lokal integritetstext"]
    ];

    required.forEach(([pattern, label]) => assert.match(source, pattern, `runtimen saknar ${label}`));
  });

  test("CSS täcker panel, dialog, markeringar och tillgänglighetslägen", async () => {
    const source = await text("reflections/reflections.css");
    const required = [
      [/#xr-trigger\b/, "panelöppnare"],
      [/#xr-selection-action\b/, "markeringsåtgärd"],
      [/\.xr-panel\b/, "panel"],
      [/\.xr-dialog\b/, "dialog"],
      [/\.xr-comment\b/, "kommentar"],
      [/\.xr-reflection\b/, "bearbetad reflektion"],
      [/::highlight\(explorations-reflections\)/, "CSS Highlight"],
      [/\.xr-highlight-fallback\b/, "markeringsfallback"],
      [/\.xr-storage-error\b/, "lagringsfel"],
      [/@media\s*\(max-width:\s*600px\)/, "mobilläge"],
      [/@media\s*\(pointer:\s*coarse\)/, "pekskärm"],
      [/@media\s*\(prefers-reduced-motion:\s*reduce\)/, "minskad rörelse"],
      [/@media\s*\(forced-colors:\s*active\)/, "hög kontrast"],
      [/@media\s+print/, "utskrift"],
      [/:focus-visible/, "synligt tangentbordsfokus"]
    ];

    required.forEach(([pattern, label]) => assert.match(source, pattern, `CSS saknar ${label}`));
  });
});
