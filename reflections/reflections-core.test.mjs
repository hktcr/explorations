import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  COMMENT_EXPORT,
  REFLECTION_RETURN,
  REFLECTIONS_FORMAT,
  commentStatus,
  commentsForMode,
  createAnchor,
  createComment,
  createExportPackage,
  exportToMarkdown,
  parsePackage,
  previewPackage,
  resolveAnchor,
  reviseComment,
  validatePackage
} from "./reflections-core.mjs";

const CREATED_AT = "2026-08-04T10:00:00.000Z";
const UPDATED_AT = "2026-08-04T11:00:00.000Z";
const ARTICLE = {
  id: "EXP#24",
  slug: "disengaged-teen",
  title: "The Obedient Student May Already Have Left",
  url: "https://hktcr.github.io/explorations/disengaged-teen/",
  contentRevision: "test-revision"
};
const BLOCKS = [
  {
    id: "opening",
    tag: "p",
    index: 0,
    sectionId: "introduction",
    sectionLabel: "Introduction",
    text: "Before the marked passage, there is enough stable context. The marked passage belongs here. After it comes more stable context."
  }
];

function fixtureAnchor(overrides = {}) {
  const exact = "The marked passage belongs here.";
  const start = BLOCKS[0].text.indexOf(exact);
  return createAnchor({
    articleId: ARTICLE.id,
    slug: ARTICLE.slug,
    blocks: BLOCKS,
    blockIndex: 0,
    start,
    end: start + exact.length,
    now: CREATED_AT,
    id: "anchor-main",
    ...overrides
  });
}

function fixtureComment(number, anchorId = "anchor-main") {
  return createComment({
    articleId: ARTICLE.id,
    anchorId,
    body: `Kommentar ${number}\n\nFördjupning ${number}`,
    now: CREATED_AT,
    id: `comment-${number}`
  });
}

function exportRecord(pkg) {
  return {
    id: pkg.packageId,
    createdAt: pkg.createdAt,
    items: pkg.items.map(item => ({ commentId: item.id, revision: item.revision }))
  };
}

function returnItem({
  id = "reflection-1",
  anchor = fixtureAnchor(),
  replyTo = [{ id: "comment-1", revision: 1 }],
  body = ["En gemensam reflektion."],
  revision = 1
} = {}) {
  return {
    id,
    articleId: ARTICLE.id,
    slug: ARTICLE.slug,
    revision,
    kind: "joint-reflection",
    body,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    anchor,
    replyTo
  };
}

function returnPackage(items, overrides = {}) {
  return {
    format: REFLECTIONS_FORMAT,
    packageType: REFLECTION_RETURN,
    schemaVersion: 1,
    packageId: "return-package-1",
    createdAt: UPDATED_AT,
    mode: "return",
    sourcePackageId: "export-package-1",
    article: { ...ARTICLE },
    items,
    ...overrides
  };
}

describe("kommentarsmodell och export", () => {
  test("har ingen artificiell gräns vid 150 kommentarer", () => {
    const anchor = fixtureAnchor();
    const created = Array.from({ length: 150 }, (_, index) => fixtureComment(index + 1));
    const pkg = createExportPackage({
      article: ARTICLE,
      anchors: [anchor],
      comments: created.map(entry => entry.comment),
      revisions: created.map(entry => entry.revision),
      mode: "all",
      now: UPDATED_AT,
      packageId: "export-150"
    });

    assert.equal(pkg.items.length, 150);
    assert.equal(new Set(pkg.items.map(item => item.id)).size, 150);
    assert.deepEqual(validatePackage(pkg), []);
    const markdown = exportToMarkdown(pkg);
    assert.match(markdown, /Kommentarer: 150/);
    assert.match(markdown, /Kommentar-id: comment-150/);
  });

  test("bevarar flera separata kommentarer på samma ankare", () => {
    const anchor = fixtureAnchor();
    const created = [1, 2, 3].map(number => fixtureComment(number));
    const pkg = createExportPackage({
      article: ARTICLE,
      anchors: [anchor],
      comments: created.map(entry => entry.comment),
      revisions: created.map(entry => entry.revision),
      mode: "selection",
      now: UPDATED_AT,
      packageId: "same-anchor"
    });

    assert.deepEqual(pkg.items.map(item => item.id), ["comment-1", "comment-2", "comment-3"]);
    assert.deepEqual(new Set(pkg.items.map(item => item.anchor.id)), new Set([anchor.id]));
    assert.deepEqual(pkg.items.map(item => item.body[0]), ["Kommentar 1", "Kommentar 2", "Kommentar 3"]);
    assert.deepEqual(validatePackage(pkg), []);
  });

  test("stöder export av alla, nya eller ett uttryckligt urval", () => {
    const anchor = fixtureAnchor();
    const fresh = fixtureComment("new");
    const exported = fixtureComment("exported");
    const changedFirst = fixtureComment("changed");
    const changed = reviseComment(changedFirst.comment, "Ändrad kommentar", { now: UPDATED_AT });
    const processed = fixtureComment("processed");
    const comments = [fresh.comment, exported.comment, changed.comment, processed.comment];
    const revisions = [
      fresh.revision,
      exported.revision,
      changedFirst.revision,
      changed.revision,
      processed.revision
    ];
    const exports = [{
      id: "earlier-export",
      items: [
        { commentId: exported.comment.id, revision: 1 },
        { commentId: changed.comment.id, revision: 1 }
      ]
    }];
    const reflections = [{
      id: "processed-reflection",
      replyTo: [{ id: processed.comment.id, revision: 1 }]
    }];

    const all = commentsForMode(comments, exports, reflections, "all");
    const onlyNew = commentsForMode(comments, exports, reflections, "new");
    assert.deepEqual(all.map(comment => comment.id), comments.map(comment => comment.id));
    assert.deepEqual(onlyNew.map(comment => comment.id), [fresh.comment.id, changed.comment.id]);

    const allPackage = createExportPackage({
      article: ARTICLE,
      anchors: [anchor],
      comments: all,
      revisions,
      mode: "all",
      now: UPDATED_AT,
      packageId: "all-package"
    });
    const newPackage = createExportPackage({
      article: ARTICLE,
      anchors: [anchor],
      comments: onlyNew,
      revisions,
      mode: "new",
      now: UPDATED_AT,
      packageId: "new-package"
    });
    const selected = [processed.comment, fresh.comment];
    const selectionPackage = createExportPackage({
      article: ARTICLE,
      anchors: [anchor],
      comments: selected,
      revisions,
      mode: "selection",
      now: UPDATED_AT,
      packageId: "selection-package"
    });

    assert.equal(allPackage.items.length, 4);
    assert.deepEqual(newPackage.items.map(item => item.id), [fresh.comment.id, changed.comment.id]);
    assert.deepEqual(selectionPackage.items.map(item => item.id), selected.map(comment => comment.id));
    assert.deepEqual(validatePackage(allPackage), []);
    assert.deepEqual(validatePackage(newPackage), []);
    assert.deepEqual(validatePackage(selectionPackage), []);
  });
});

describe("revisioner och status", () => {
  test("går från ny till exporterad, ändrad och bearbetad utan att skriva över revisioner", () => {
    const anchor = fixtureAnchor();
    const first = fixtureComment(1);
    assert.equal(commentStatus(first.comment, [], []), "new");

    const firstPackage = createExportPackage({
      article: ARTICLE,
      anchors: [anchor],
      comments: [first.comment],
      revisions: [first.revision],
      mode: "selection",
      now: CREATED_AT,
      packageId: "export-revision-1"
    });
    const exports = [exportRecord(firstPackage)];
    assert.equal(commentStatus(first.comment, exports, []), "exported");

    const second = reviseComment(first.comment, "En omarbetad kommentar.", { now: UPDATED_AT });
    assert.equal(second.comment.currentRevision, 2);
    assert.equal(first.revision.revision, 1);
    assert.deepEqual(first.revision.body, ["Kommentar 1", "Fördjupning 1"]);
    assert.equal(commentStatus(second.comment, exports, []), "changed");

    const secondPackage = createExportPackage({
      article: ARTICLE,
      anchors: [anchor],
      comments: [second.comment],
      revisions: [first.revision, second.revision],
      mode: "new",
      now: UPDATED_AT,
      packageId: "export-revision-2"
    });
    exports.push(exportRecord(secondPackage));
    assert.equal(commentStatus(second.comment, exports, []), "exported");

    const reflection = returnItem({
      replyTo: [{ id: second.comment.id, revision: second.comment.currentRevision }]
    });
    assert.equal(commentStatus(second.comment, exports, [reflection]), "processed");
  });
});

describe("konservativ återankring", () => {
  test("använder exakt position endast när dokumentfingeravtrycket stämmer", () => {
    const anchor = fixtureAnchor();
    const resolved = resolveAnchor(BLOCKS, anchor);

    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.method, "position");
    assert.equal(BLOCKS[resolved.blockIndex].text.slice(resolved.localStart, resolved.localEnd), anchor.textQuote.exact);
  });

  test("återankrar ett unikt citat efter en försiktig dokumentändring", () => {
    const anchor = fixtureAnchor();
    const shifted = [{ ...BLOCKS[0], text: `Nytt förord. ${BLOCKS[0].text}` }];
    const resolved = resolveAnchor(shifted, anchor);

    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.method, "unique-quote");
  });

  test("använder stark kontext för att skilja mellan identiska citat", () => {
    const anchor = fixtureAnchor();
    const repeated = [
      {
        id: "other",
        tag: "p",
        index: 0,
        sectionId: "other-section",
        sectionLabel: "Other",
        text: "Unrelated words. The marked passage belongs here. More unrelated words."
      },
      { ...BLOCKS[0], index: 1 }
    ];
    const resolved = resolveAnchor(repeated, anchor);

    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.method, "context");
    assert.equal(resolved.block.id, "opening");
  });

  test("vägrar gissa när två citat är tvetydiga eller originalcitatet saknas", () => {
    const exact = "same phrase";
    const source = [{ id: null, tag: "p", index: 0, sectionId: null, sectionLabel: "Start", text: exact }];
    const anchor = createAnchor({
      articleId: ARTICLE.id,
      slug: ARTICLE.slug,
      blocks: source,
      blockIndex: 0,
      start: 0,
      end: exact.length,
      now: CREATED_AT,
      id: "ambiguous-anchor"
    });

    const ambiguous = resolveAnchor([{ ...source[0], text: `${exact} ${exact}` }], anchor);
    const missing = resolveAnchor([{ ...source[0], text: "a rewritten sentence" }], anchor);
    assert.deepEqual(
      { status: ambiguous.status, reason: ambiguous.reason },
      { status: "unresolved", reason: "ambiguous-quote" }
    );
    assert.deepEqual(
      { status: missing.status, reason: missing.reason },
      { status: "unresolved", reason: "quote-missing" }
    );
  });
});

describe("returpaket", () => {
  test("validerar och läser både rå och inhägnad JSON", () => {
    const pkg = returnPackage([returnItem()]);
    assert.deepEqual(validatePackage(pkg), []);
    assert.deepEqual(parsePackage(JSON.stringify(pkg)), pkg);
    assert.deepEqual(parsePackage(`Här kommer paketet:\n\n\`\`\`json\n${JSON.stringify(pkg, null, 2)}\n\`\`\``), pkg);
  });

  test("avvisar returpaket utan käll-id eller koppling till ursprungskommentar", () => {
    const invalid = returnPackage(
      [returnItem({ replyTo: [] })],
      { sourcePackageId: null }
    );
    const errors = validatePackage(invalid);

    assert.ok(errors.some(error => error.includes("sourcePackageId")));
    assert.ok(errors.some(error => error.includes("koppling till ursprungskommentar")));
    assert.throws(() => parsePackage(JSON.stringify(invalid)), /sourcePackageId|ursprungskommentar/);
  });

  test("avvisar manipulerad artikelidentitet och ankarsignatur", () => {
    const wrongArticle = returnPackage([returnItem()]);
    wrongArticle.items[0].anchor.articleId = "EXP#2";
    const wrongSignature = returnPackage([returnItem({ id: "reflection-2" })]);
    wrongSignature.items[0].anchor.signature = "anchor:deadbeef";

    assert.ok(validatePackage(wrongArticle).some(error => error.includes("anchor hör till fel artikel")));
    assert.ok(validatePackage(wrongSignature).some(error => error.includes("anchor.signature")));
  });

  test("maskinpaketet kan läsas även när kommentaren innehåller kodstaket", () => {
    const anchor = fixtureAnchor();
    const created = createComment({
      articleId: ARTICLE.id,
      anchorId: anchor.id,
      body: "```js\nconsole.log('hej')\n```",
      now: CREATED_AT,
      id: "comment-fence"
    });
    const pkg = createExportPackage({
      article: ARTICLE,
      anchors: [anchor],
      comments: [created.comment],
      revisions: [created.revision],
      mode: "selection",
      now: UPDATED_AT,
      packageId: "export-fence"
    });

    assert.deepEqual(parsePackage(exportToMarkdown(pkg)), pkg);
  });
});

describe("förhandsgranskning av returpaket", () => {
  const knownRevision = {
    key: "comment-1:1",
    commentId: "comment-1",
    articleId: ARTICLE.id,
    revision: 1,
    savedAt: CREATED_AT,
    body: ["Kommentar 1"]
  };

  test("klassar ett känt svar som matchat och en identisk återimport som redan importerad", () => {
    const item = returnItem();
    const pkg = returnPackage([item]);
    const first = previewPackage(pkg, { revisions: [knownRevision], reflections: [] });
    const repeated = previewPackage(pkg, { revisions: [knownRevision], reflections: [structuredClone(item)] });

    assert.deepEqual(first.errors, []);
    assert.deepEqual(first.matched.map(entry => entry.id), [item.id]);
    assert.deepEqual(repeated.already.map(entry => entry.id), [item.id]);
    assert.equal(repeated.conflicts.length, 0);
    assert.deepEqual(
      previewPackage(pkg, { revisions: [knownRevision], reflections: [structuredClone(item)] }),
      repeated
    );
  });

  test("stoppar samma reflektions-id med ett annat innehåll som konflikt", () => {
    const item = returnItem();
    const pkg = returnPackage([item]);
    const conflictingLocal = { ...structuredClone(item), body: ["Ett annat innehåll."] };
    const preview = previewPackage(pkg, { revisions: [knownRevision], reflections: [conflictingLocal] });

    assert.deepEqual(preview.conflicts.map(entry => entry.id), [item.id]);
    assert.equal(preview.already.length, 0);
    assert.equal(preview.matched.length, 0);
  });

  test("skiljer partiellt kända och helt okända replyTo-kopplingar", () => {
    const partial = returnItem({
      id: "reflection-partial",
      replyTo: [
        { id: "comment-1", revision: 1 },
        { id: "comment-missing", revision: 1 }
      ]
    });
    const unknown = returnItem({
      id: "reflection-unknown",
      replyTo: [{ id: "comment-unknown", revision: 1 }]
    });
    const pkg = returnPackage([partial, unknown]);
    const preview = previewPackage(pkg, { revisions: [knownRevision], reflections: [] });

    assert.deepEqual(preview.needsLink.map(entry => entry.id), [partial.id]);
    assert.deepEqual(preview.unknown.map(entry => entry.id), [unknown.id]);
    assert.equal(preview.matched.length, 0);
  });
});
