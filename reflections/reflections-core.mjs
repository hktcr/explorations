export const REFLECTIONS_SCHEMA_VERSION = 1;
export const REFLECTIONS_FORMAT = "explorations-reflections";
export const COMMENT_EXPORT = "comment-export";
export const REFLECTION_RETURN = "reflection-return";

const ARTICLE_ID_PATTERN = /^EXP#[1-9][0-9]*$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const CONTEXT_LENGTH = 96;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isStableArticleId(value) {
  return typeof value === "string" && ARTICLE_ID_PATTERN.test(value);
}

function isOpaqueId(value) {
  return typeof value === "string" && OPAQUE_ID_PATTERN.test(value);
}

export function cleanText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

export function bodyFromText(value) {
  const text = cleanText(value);
  return text ? text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean) : [];
}

export function bodyToText(value) {
  return Array.isArray(value)
    ? value.map(cleanText).filter(Boolean).join("\n\n")
    : cleanText(value);
}

export function createId(prefix = "id") {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return `${prefix}_${random}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function fingerprintText(value) {
  const text = String(value ?? "");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildArticleText(blocks) {
  const normalized = [];
  let cursor = 0;
  (Array.isArray(blocks) ? blocks : []).forEach((block, index) => {
    const text = String(block?.text ?? "").replace(/\u00a0/g, " ");
    if (!text) return;
    if (normalized.length) cursor += 1;
    normalized.push({
      id: cleanText(block?.id) || null,
      tag: cleanText(block?.tag).toLowerCase() || "p",
      index: Number.isInteger(block?.index) ? block.index : index,
      sectionId: cleanText(block?.sectionId) || null,
      sectionLabel: cleanText(block?.sectionLabel) || "Document start",
      text,
      start: cursor,
      end: cursor + text.length,
      element: block?.element || null
    });
    cursor += text.length;
  });
  const text = normalized.map(block => block.text).join("\n");
  return { blocks: normalized, text, fingerprint: fingerprintText(text) };
}

function clampOffset(value, length) {
  const number = Math.trunc(Number(value) || 0);
  return Math.max(0, Math.min(length, number));
}

export function createAnchor({ articleId, slug, blocks, blockIndex, start, end, now, id }) {
  if (!isStableArticleId(articleId)) throw new Error("Ogiltigt EXP-id.");
  const article = buildArticleText(blocks);
  const block = article.blocks[blockIndex];
  if (!block) throw new Error("Textblocket kunde inte hittas.");
  const safeStart = clampOffset(start, block.text.length);
  const safeEnd = Math.max(safeStart, clampOffset(end, block.text.length));
  const exact = block.text.slice(safeStart, safeEnd);
  if (!exact.trim()) throw new Error("Markeringen är tom.");
  const globalStart = block.start + safeStart;
  const globalEnd = block.start + safeEnd;
  const timestamp = now || new Date().toISOString();
  const anchor = {
    id: id || createId("a"),
    version: 1,
    articleId,
    slug: cleanText(slug),
    root: "article",
    sectionId: block.sectionId,
    sectionLabel: block.sectionLabel,
    block: { id: block.id, tag: block.tag, index: block.index },
    textQuote: {
      exact,
      prefix: article.text.slice(Math.max(0, globalStart - CONTEXT_LENGTH), globalStart),
      suffix: article.text.slice(globalEnd, Math.min(article.text.length, globalEnd + CONTEXT_LENGTH))
    },
    textPosition: { start: globalStart, end: globalEnd },
    documentFingerprint: article.fingerprint,
    createdAt: timestamp
  };
  return { ...anchor, signature: anchorSignature(anchor) };
}

export function anchorSignature(anchor) {
  const value = [
    anchor?.articleId,
    anchor?.documentFingerprint,
    anchor?.textPosition?.start,
    anchor?.textPosition?.end,
    anchor?.textQuote?.exact,
    anchor?.textQuote?.prefix,
    anchor?.textQuote?.suffix
  ].join("\u241f");
  return `anchor:${fingerprintText(value).split(":")[1]}`;
}

export function anchorsReferToSameText(left, right) {
  return left?.articleId === right?.articleId
    && left?.slug === right?.slug
    && left?.documentFingerprint === right?.documentFingerprint
    && left?.textPosition?.start === right?.textPosition?.start
    && left?.textPosition?.end === right?.textPosition?.end
    && left?.textQuote?.exact === right?.textQuote?.exact
    && left?.textQuote?.prefix === right?.textQuote?.prefix
    && left?.textQuote?.suffix === right?.textQuote?.suffix;
}

function commonPrefixLength(left, right) {
  const max = Math.min(left.length, right.length);
  let count = 0;
  while (count < max && left[count] === right[count]) count += 1;
  return count;
}

function commonSuffixLength(left, right) {
  const max = Math.min(left.length, right.length);
  let count = 0;
  while (count < max && left[left.length - 1 - count] === right[right.length - 1 - count]) count += 1;
  return count;
}

function candidateScore(article, candidate, anchor) {
  const prefix = String(anchor.textQuote?.prefix || "");
  const suffix = String(anchor.textQuote?.suffix || "");
  const before = article.text.slice(Math.max(0, candidate.start - prefix.length), candidate.start);
  const after = article.text.slice(candidate.end, candidate.end + suffix.length);
  let score = 0;
  if (prefix) score += commonSuffixLength(before, prefix) / prefix.length;
  if (suffix) score += commonPrefixLength(after, suffix) / suffix.length;
  if (anchor.sectionId && candidate.block.sectionId === anchor.sectionId) score += .5;
  if (anchor.block?.id && candidate.block.id === anchor.block.id) score += .5;
  else if (candidate.block.index === anchor.block?.index && candidate.block.tag === anchor.block?.tag) score += .2;
  return score;
}

function candidateAt(article, start, end) {
  const block = article.blocks.find(item => start >= item.start && end <= item.end);
  if (!block) return null;
  return {
    block,
    blockIndex: article.blocks.indexOf(block),
    start,
    end,
    localStart: start - block.start,
    localEnd: end - block.start
  };
}

export function resolveAnchor(blocks, anchor) {
  const article = buildArticleText(blocks);
  const exact = String(anchor?.textQuote?.exact ?? "");
  if (!exact) return { status: "unresolved", reason: "invalid-anchor" };
  const positionStart = Number(anchor?.textPosition?.start);
  const positionEnd = Number(anchor?.textPosition?.end);
  if (
    article.fingerprint === anchor.documentFingerprint
    && Number.isInteger(positionStart)
    && Number.isInteger(positionEnd)
    && article.text.slice(positionStart, positionEnd) === exact
  ) {
    const candidate = candidateAt(article, positionStart, positionEnd);
    if (candidate) return { status: "resolved", method: "position", ...candidate };
  }

  const candidates = [];
  let cursor = article.text.indexOf(exact);
  while (cursor >= 0) {
    const candidate = candidateAt(article, cursor, cursor + exact.length);
    if (candidate) {
      candidate.score = candidateScore(article, candidate, anchor);
      candidates.push(candidate);
    }
    cursor = article.text.indexOf(exact, cursor + 1);
  }
  if (!candidates.length) return { status: "unresolved", reason: "quote-missing", exact };
  if (candidates.length === 1) return { status: "resolved", method: "unique-quote", ...candidates[0] };

  candidates.sort((left, right) => right.score - left.score || left.start - right.start);
  const best = candidates[0];
  const second = candidates[1];
  if (best.score >= 1.25 && best.score - second.score >= .5) {
    return { status: "resolved", method: "context", ...best };
  }
  return { status: "unresolved", reason: "ambiguous-quote", exact };
}

export function createComment({ articleId, anchorId, body, now, id, kind = "user-comment" }) {
  if (!isStableArticleId(articleId)) throw new Error("Ogiltigt EXP-id.");
  const paragraphs = bodyFromText(body);
  if (!paragraphs.length) throw new Error("Kommentaren är tom.");
  const timestamp = now || new Date().toISOString();
  const comment = {
    id: id || createId("c"),
    articleId,
    anchorId: cleanText(anchorId),
    kind,
    createdAt: timestamp,
    updatedAt: timestamp,
    currentRevision: 1,
    visibility: "private",
    publicationStatus: "draft"
  };
  const revision = {
    key: `${comment.id}:1`,
    commentId: comment.id,
    articleId,
    revision: 1,
    savedAt: timestamp,
    body: paragraphs
  };
  return { comment, revision };
}

export function reviseComment(comment, body, options = {}) {
  const paragraphs = bodyFromText(body);
  if (!paragraphs.length) throw new Error("Kommentaren är tom.");
  const revisionNumber = Number(comment.currentRevision) + 1;
  const timestamp = options.now || new Date().toISOString();
  return {
    comment: { ...comment, currentRevision: revisionNumber, updatedAt: timestamp },
    revision: {
      key: `${comment.id}:${revisionNumber}`,
      commentId: comment.id,
      articleId: comment.articleId,
      revision: revisionNumber,
      savedAt: timestamp,
      body: paragraphs
    }
  };
}

function exportedRevisionSet(exports) {
  const values = new Set();
  (Array.isArray(exports) ? exports : []).forEach(batch => {
    (Array.isArray(batch?.items) ? batch.items : []).forEach(item => values.add(`${item.commentId}:${item.revision}`));
  });
  return values;
}

function processedRevisionSet(reflections) {
  const values = new Set();
  (Array.isArray(reflections) ? reflections : []).forEach(reflection => {
    (Array.isArray(reflection?.replyTo) ? reflection.replyTo : []).forEach(item => values.add(`${item.id}:${item.revision}`));
  });
  return values;
}

export function commentStatus(comment, exports, reflections) {
  const current = `${comment.id}:${comment.currentRevision}`;
  if (processedRevisionSet(reflections).has(current)) return "processed";
  const exported = exportedRevisionSet(exports);
  if (exported.has(current)) return "exported";
  const wasExported = [...exported].some(key => key.startsWith(`${comment.id}:`));
  return wasExported ? "changed" : "new";
}

export function commentsForMode(comments, exports, reflections, mode) {
  const source = Array.isArray(comments) ? comments : [];
  if (mode === "all" || !mode) return [...source];
  return source.filter(comment => {
    const status = commentStatus(comment, exports, reflections);
    if (mode === "new") return status === "new" || status === "changed";
    if (mode === "exported") return status === "exported";
    if (mode === "processed") return status === "processed";
    return true;
  });
}

function mapBy(values, key) {
  return new Map((Array.isArray(values) ? values : []).map(value => [value?.[key], value]));
}

export function createExportPackage({ article, anchors, comments, revisions, mode = "selection", now, packageId }) {
  if (!isStableArticleId(article?.id)) throw new Error("Artikeln saknar ett giltigt EXP-id.");
  const anchorMap = mapBy(anchors, "id");
  const revisionMap = mapBy(revisions, "key");
  const timestamp = now || new Date().toISOString();
  const items = (Array.isArray(comments) ? comments : []).map(comment => {
    const revision = revisionMap.get(`${comment.id}:${comment.currentRevision}`);
    const anchor = anchorMap.get(comment.anchorId);
    if (!revision || !anchor) throw new Error(`Kommentaren ${comment.id} saknar revision eller ankare.`);
    return {
      id: comment.id,
      articleId: comment.articleId,
      slug: cleanText(article.slug),
      revision: comment.currentRevision,
      kind: "user-comment",
      body: revision.body.map(cleanText).filter(Boolean),
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      anchor,
      replyTo: []
    };
  });
  if (!items.length) throw new Error("Välj minst en kommentar att exportera.");
  return {
    format: REFLECTIONS_FORMAT,
    packageType: COMMENT_EXPORT,
    schemaVersion: REFLECTIONS_SCHEMA_VERSION,
    packageId: packageId || createId("xp"),
    createdAt: timestamp,
    mode,
    sourcePackageId: null,
    article: {
      id: article.id,
      slug: cleanText(article.slug),
      title: cleanText(article.title) || article.id,
      url: cleanText(article.url),
      contentRevision: cleanText(article.contentRevision)
    },
    items
  };
}

function blockquote(value) {
  return String(value ?? "").split("\n").map(line => `> ${line}`).join("\n");
}

function safeMarkdownFence(value) {
  const longest = Math.max(0, ...[...String(value).matchAll(/`+/g)].map(match => match[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

export function exportToMarkdown(pkg) {
  const validation = validatePackage(pkg);
  if (validation.length) throw new Error(validation.join(" "));
  const lines = [
    "# Reflektionsspår från Explorations",
    "",
    `Artikel: ${pkg.article.title}`,
    `EXP-id: ${pkg.article.id}`,
    `URL: ${pkg.article.url || "saknas"}`,
    `Export-id: ${pkg.packageId}`,
    `Kommentarer: ${pkg.items.length}`,
    ""
  ];
  pkg.items.forEach((item, index) => {
    lines.push(`## Kommentar ${index + 1}`, "");
    lines.push(`Kommentar-id: ${item.id}`);
    lines.push(`Revision: ${item.revision}`);
    lines.push(`Ankar-id: ${item.anchor.id}`);
    lines.push(`Avsnitt: ${item.anchor.sectionLabel || "Dokumentets början"}`, "");
    lines.push(blockquote(item.anchor.textQuote.exact), "");
    lines.push("Min ursprungliga kommentar:", "", bodyToText(item.body), "");
  });
  const serialized = JSON.stringify(pkg, null, 2);
  const fence = safeMarkdownFence(serialized);
  lines.push(
    "## Instruktion för fortsatt reflektion",
    "",
    "Hjälp mig att fördjupa kommentarerna utan att skriva över originalen. Flera kommentarer får sammanföras i en gemensam reflektion. När jag ber om ett returpaket ska du returnera enbart giltig JSON: kopiera article-objektet oförändrat, använd format explorations-reflections, packageType reflection-return, schemaVersion 1, mode return, ett nytt packageId, ett ISO-datum i createdAt och sourcePackageId enligt export-id ovan. Varje joint-reflection-post ska ha eget id, articleId, slug, revision 1, body som en lista av stycken, ISO-datum i createdAt och updatedAt, ett oförändrat anchor från en av källkommentarerna samt replyTo med exakt kommentar-id och revision för alla kommentarer som reflektionen bygger på.",
    "",
    "## Maskinläsbart källpaket",
    "",
    `${fence}json`,
    serialized,
    fence,
    ""
  );
  return lines.join("\n");
}

function hasForbiddenKey(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => (
    ["__proto__", "prototype", "constructor"].includes(key) || hasForbiddenKey(child)
  ));
}

function validIso(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validateAnchor(anchor, path, errors, article) {
  if (!isObject(anchor)) return errors.push(`${path}.anchor saknas.`);
  if (!isOpaqueId(anchor.id)) errors.push(`${path}.anchor.id är ogiltigt.`);
  if (anchor.version !== 1) errors.push(`${path}.anchor.version stöds inte.`);
  if (anchor.articleId !== article?.id || anchor.slug !== article?.slug) errors.push(`${path}.anchor hör till fel artikel.`);
  if (
    !isObject(anchor.textQuote)
    || typeof anchor.textQuote.exact !== "string"
    || !cleanText(anchor.textQuote.exact)
    || (anchor.textQuote.prefix !== undefined && typeof anchor.textQuote.prefix !== "string")
    || (anchor.textQuote.suffix !== undefined && typeof anchor.textQuote.suffix !== "string")
  ) errors.push(`${path}.anchor.textQuote är ogiltig.`);
  if (!isObject(anchor.textPosition) || !Number.isInteger(anchor.textPosition.start) || !Number.isInteger(anchor.textPosition.end)) {
    errors.push(`${path}.anchor.textPosition är ogiltig.`);
  } else if (anchor.textPosition.start < 0 || anchor.textPosition.end <= anchor.textPosition.start) {
    errors.push(`${path}.anchor.textPosition har ogiltiga gränser.`);
  } else if (typeof anchor.textQuote?.exact === "string" && anchor.textPosition.end - anchor.textPosition.start !== anchor.textQuote.exact.length) {
    errors.push(`${path}.anchor.textPosition matchar inte citatets längd.`);
  }
  if (typeof anchor.documentFingerprint !== "string" || !anchor.documentFingerprint) errors.push(`${path}.anchor.documentFingerprint saknas.`);
  if (!isOpaqueId(anchor.signature) || anchor.signature !== anchorSignature(anchor)) errors.push(`${path}.anchor.signature är ogiltig.`);
}

export function validatePackage(pkg) {
  const errors = [];
  if (!isObject(pkg)) return ["Paketet måste vara ett JSON-objekt."];
  if (hasForbiddenKey(pkg)) errors.push("Paketet innehåller förbjudna objektnycklar.");
  if (pkg.format !== REFLECTIONS_FORMAT) errors.push("Paketformatet är okänt.");
  if (![COMMENT_EXPORT, REFLECTION_RETURN].includes(pkg.packageType)) errors.push("Pakettypen är okänd.");
  if (pkg.schemaVersion !== REFLECTIONS_SCHEMA_VERSION) errors.push("Schemaversionen stöds inte.");
  if (!isOpaqueId(pkg.packageId)) errors.push("Paket-id är ogiltigt.");
  if (!validIso(pkg.createdAt)) errors.push("Paketets datum är ogiltigt.");
  if (
    !isObject(pkg.article)
    || !isStableArticleId(pkg.article.id)
    || typeof pkg.article.slug !== "string"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pkg.article.slug)
    || (pkg.article.title !== undefined && typeof pkg.article.title !== "string")
    || (pkg.article.url !== undefined && typeof pkg.article.url !== "string")
    || (pkg.article.contentRevision !== undefined && typeof pkg.article.contentRevision !== "string")
  ) errors.push("Artikelidentiteten är ogiltig.");
  if (!Array.isArray(pkg.items) || !pkg.items.length) errors.push("Paketet innehåller inga poster.");
  const ids = new Set();
  (Array.isArray(pkg.items) ? pkg.items : []).forEach((item, index) => {
    const path = `Poster ${index + 1}`;
    if (!isObject(item)) return errors.push(`${path} är ogiltig.`);
    if (!isOpaqueId(item.id)) errors.push(`${path} har ett ogiltigt id.`);
    else if (ids.has(item.id)) errors.push(`${path} har ett duplicerat id.`);
    else ids.add(item.id);
    if (item.articleId !== pkg.article.id) errors.push(`${path} hör till fel artikel.`);
    if (item.slug !== pkg.article.slug) errors.push(`${path} har fel artikelsökväg.`);
    if (!Number.isInteger(item.revision) || item.revision < 1) errors.push(`${path} har ogiltig revision.`);
    if (!Array.isArray(item.body) || !item.body.length || !item.body.every(part => typeof part === "string") || !item.body.some(part => cleanText(part))) {
      errors.push(`${path} saknar giltig text.`);
    }
    if (!validIso(item.createdAt) || !validIso(item.updatedAt)) errors.push(`${path} har ogiltiga datum.`);
    validateAnchor(item.anchor, path, errors, pkg.article);
    if (!Array.isArray(item.replyTo)) errors.push(`${path}.replyTo måste vara en lista.`);
    if (pkg.packageType === COMMENT_EXPORT) {
      if (item.kind !== "user-comment") errors.push(`${path} måste vara en kommentar.`);
      if (item.replyTo?.length) errors.push(`${path}.replyTo måste vara tom för en ursprungskommentar.`);
    }
    if (pkg.packageType === REFLECTION_RETURN) {
      if (item.kind !== "joint-reflection") errors.push(`${path} måste vara en gemensam reflektion.`);
      if (!item.replyTo?.length) errors.push(`${path} saknar koppling till ursprungskommentar.`);
      item.replyTo?.forEach(reference => {
        if (!isObject(reference) || !isOpaqueId(reference.id) || !Number.isInteger(reference.revision) || reference.revision < 1) {
          errors.push(`${path} har en ogiltig replyTo-referens.`);
        }
      });
    }
  });
  if (pkg.packageType === REFLECTION_RETURN && !isOpaqueId(pkg.sourcePackageId)) {
    errors.push("Returpaketet saknar ett giltigt sourcePackageId.");
  }
  if (pkg.packageType === COMMENT_EXPORT && pkg.sourcePackageId !== null) errors.push("Kommentarspaketets sourcePackageId måste vara null.");
  if (pkg.packageType === COMMENT_EXPORT && !["all", "new", "selection"].includes(pkg.mode)) errors.push("Kommentarspaketets exportläge är ogiltigt.");
  if (pkg.packageType === REFLECTION_RETURN && pkg.mode !== "return") errors.push("Returpaketets mode måste vara return.");
  return errors;
}

export function parsePackage(value) {
  const source = String(value ?? "").trim();
  const candidates = [];
  if (source.startsWith("{") || source.startsWith("[")) candidates.push(source);
  for (const match of source.matchAll(/(`{3,}|~{3,})(?:json)?\s*([\s\S]*?)\1/gi)) candidates.push(match[2].trim());
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const errors = validatePackage(parsed);
      if (!errors.length) return parsed;
      lastError = new Error(errors.join(" "));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Inget giltigt reflektionspaket hittades.");
}

export function canonicalItemJson(item) {
  return JSON.stringify(canonicalValue({
    id: item?.id,
    revision: item?.revision,
    body: item?.body,
    anchor: item?.anchor,
    replyTo: item?.replyTo || []
  }));
}

export function canonicalItemHash(item) {
  return fingerprintText(canonicalItemJson(item));
}

export function commentItemMatchesLocal(item, comment, revision, anchor) {
  return item?.id === comment?.id
    && item?.revision === revision?.revision
    && JSON.stringify(item?.body) === JSON.stringify(revision?.body)
    && Array.isArray(item?.replyTo)
    && item.replyTo.length === 0
    && anchorsReferToSameText(item?.anchor, anchor);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isObject(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalValue(value[key]);
    return result;
  }, {});
}

export function canonicalPackageJson(pkg) {
  return JSON.stringify(canonicalValue({
    format: pkg?.format,
    packageType: pkg?.packageType,
    schemaVersion: pkg?.schemaVersion,
    packageId: pkg?.packageId,
    createdAt: pkg?.createdAt,
    mode: pkg?.mode,
    sourcePackageId: pkg?.sourcePackageId,
    article: pkg?.article,
    items: pkg?.items
  }));
}

export function canonicalPackageHash(pkg) {
  return fingerprintText(canonicalPackageJson(pkg));
}

function localReflectionItem(reflection) {
  return {
    id: reflection?.id,
    revision: reflection?.revision,
    body: reflection?.body,
    anchor: reflection?.anchor,
    replyTo: reflection?.replyTo || []
  };
}

export function previewPackage(pkg, snapshot) {
  const errors = validatePackage(pkg);
  if (errors.length) return { errors, matched: [], needsLink: [], unknown: [], already: [], conflicts: [] };
  const comments = mapBy(snapshot?.comments, "id");
  const revisions = mapBy(snapshot?.revisions, "key");
  const reflections = mapBy(snapshot?.reflections, "id");
  const anchors = mapBy(snapshot?.anchors, "id");
  const sourceExport = (snapshot?.exports || []).find(batch => batch.packageId === pkg.sourcePackageId);
  const sourceKeys = new Set((sourceExport?.items || []).map(item => `${item.commentId}:${item.revision}`));
  const sourceItems = sourceExport?.package?.items || [];
  const result = { errors: [], matched: [], needsLink: [], unknown: [], already: [], conflicts: [] };
  pkg.items.forEach(item => {
    if (pkg.packageType === COMMENT_EXPORT) {
      const localComment = comments.get(item.id);
      const localRevision = revisions.get(`${item.id}:${item.revision}`);
      if (!localComment && !localRevision) return result.matched.push(item);
      const localAnchor = anchors.get(localComment?.anchorId);
      if (
        localComment
        && localRevision
        && localAnchor
        && commentItemMatchesLocal(item, localComment, localRevision, localAnchor)
      ) return result.already.push(item);
      return result.conflicts.push(item);
    }
    const existing = reflections.get(item.id);
    if (existing) {
      if (canonicalItemJson(localReflectionItem(existing)) === canonicalItemJson(item)) result.already.push(item);
      else result.conflicts.push(item);
      return;
    }
    const references = item.replyTo || [];
    if (sourceExport && !references.every(reference => sourceKeys.has(`${reference.id}:${reference.revision}`))) {
      result.conflicts.push(item);
      return;
    }
    const known = references.filter(reference => revisions.has(`${reference.id}:${reference.revision}`));
    if (
      sourceExport
      && known.length === references.length
      && !references.some(reference => sourceItems.some(source => (
        source.id === reference.id
        && source.revision === reference.revision
        && source.anchor?.signature === item.anchor.signature
        && anchorsReferToSameText(source.anchor, item.anchor)
      )))
    ) result.needsLink.push(item);
    else if (known.length === references.length) result.matched.push(item);
    else if (known.length) result.needsLink.push(item);
    else result.unknown.push(item);
  });
  return result;
}
