export const ENGAGEMENT_SCHEMA_VERSION = 1;
export const EXPLICIT_READING_EVIDENCE = "explicit-user-confirmation";
export const PUBLIC_VISIBILITY = "public";
export const PUBLISHED_STATUS = "published";

const ARTICLE_ID_PATTERN = /^EXP#[1-9][0-9]*$/;
const FORBIDDEN_READWISE_KEYS = new Set([
  "content",
  "highlight",
  "highlights",
  "highlightText",
  "note",
  "notes",
  "quote",
  "raw",
  "rawHighlight",
  "text"
]);
const ALLOWED = {
  root: new Set(["$schema", "schemaVersion", "generatedAt", "policy", "integrations", "articles"]),
  policy: new Set(["readingEvidence", "publication", "readwise"]),
  integrations: new Set(["readwise"]),
  integrationReadwise: new Set(["adapter", "status"]),
  article: new Set(["slug", "reading", "reflections", "readwiseReferences"]),
  reading: new Set(["confirmed", "confirmedAt", "evidence", "visibility", "publicationStatus"]),
  reflection: new Set(["id", "kind", "body", "publishedAt", "authorLabel", "articleAnchor", "visibility", "publicationStatus"]),
  readwise: new Set(["id", "source", "kind", "title", "authors", "canonicalUrl", "relevanceSummary", "highlightCount", "evidenceStatus", "visibility", "publicationStatus"])
};

export function isStableArticleId(value) {
  return typeof value === "string" && ARTICLE_ID_PATTERN.test(value);
}

export function isPublished(value) {
  return Boolean(value)
    && value.visibility === PUBLIC_VISIBILITY
    && value.publicationStatus === PUBLISHED_STATUS;
}

export function isConfirmedRead(article) {
  const reading = article?.reading;
  return isPublished(reading)
    && reading.confirmed === true
    && reading.evidence === EXPLICIT_READING_EVIDENCE
    && typeof reading.confirmedAt === "string"
    && !Number.isNaN(Date.parse(reading.confirmedAt));
}

export function getPublishedReflections(article) {
  return Array.isArray(article?.reflections)
    ? article.reflections.filter(reflection => (
      isPublished(reflection)
      && typeof reflection.id === "string"
      && ["user-comment", "joint-reflection"].includes(reflection.kind)
      && Array.isArray(reflection.body)
      && reflection.body.some(paragraph => typeof paragraph === "string" && paragraph.trim())
    ))
    : [];
}

export function getPublishedReadwiseReferences(article) {
  return Array.isArray(article?.readwiseReferences)
    ? article.readwiseReferences.filter(reference => (
      isPublished(reference)
      && reference.source === "readwise"
      && typeof reference.id === "string"
      && typeof reference.title === "string"
      && ["unverified", "original-checked"].includes(reference.evidenceStatus)
    ))
    : [];
}

export function getArticleSignals(article) {
  const reflections = getPublishedReflections(article);
  const readwiseReferences = getPublishedReadwiseReferences(article);
  return {
    showReadMarker: isConfirmedRead(article),
    showReflectionMarker: reflections.length > 0,
    showReadwiseMarker: readwiseReferences.length > 0,
    showReflectionSurface: reflections.length > 0 || readwiseReferences.length > 0,
    reflectionCount: reflections.length,
    readwiseReferenceCount: readwiseReferences.length
  };
}

function cleanString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanStringArray(value) {
  return Array.isArray(value)
    ? value.map(item => cleanString(item)).filter(Boolean)
    : [];
}

function cleanHttpUrl(value) {
  const candidate = cleanString(value);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

function sanitizeReading(reading) {
  if (!isPublished(reading)) return null;
  if (reading.confirmed !== true || reading.evidence !== EXPLICIT_READING_EVIDENCE) return null;
  if (typeof reading.confirmedAt !== "string" || Number.isNaN(Date.parse(reading.confirmedAt))) return null;
  return {
    confirmed: true,
    confirmedAt: reading.confirmedAt,
    evidence: EXPLICIT_READING_EVIDENCE,
    visibility: PUBLIC_VISIBILITY,
    publicationStatus: PUBLISHED_STATUS
  };
}

function sanitizeReflection(reflection) {
  if (!isPublished(reflection)) return null;
  const body = cleanStringArray(reflection.body);
  if (!cleanString(reflection.id) || !["user-comment", "joint-reflection"].includes(reflection.kind) || !body.length) return null;
  const safe = {
    id: cleanString(reflection.id),
    kind: reflection.kind,
    body,
    visibility: PUBLIC_VISIBILITY,
    publicationStatus: PUBLISHED_STATUS
  };
  if (cleanString(reflection.publishedAt) && !Number.isNaN(Date.parse(reflection.publishedAt))) safe.publishedAt = cleanString(reflection.publishedAt);
  if (cleanString(reflection.authorLabel)) safe.authorLabel = cleanString(reflection.authorLabel);
  if (cleanString(reflection.articleAnchor)) safe.articleAnchor = cleanString(reflection.articleAnchor).replace(/^#/, "");
  return safe;
}

export function sanitizeReadwiseReference(reference) {
  if (!isPublished(reference)) return null;
  const id = cleanString(reference.id);
  const title = cleanString(reference.title);
  if (!id || !title) return null;
  const safe = {
    id,
    source: "readwise",
    kind: ["book", "article", "document", "podcast", "other"].includes(reference.kind) ? reference.kind : "other",
    title,
    authors: cleanStringArray(reference.authors),
    evidenceStatus: reference.evidenceStatus === "original-checked" ? "original-checked" : "unverified",
    visibility: PUBLIC_VISIBILITY,
    publicationStatus: PUBLISHED_STATUS
  };
  if (cleanHttpUrl(reference.canonicalUrl)) safe.canonicalUrl = cleanHttpUrl(reference.canonicalUrl);
  if (cleanString(reference.relevanceSummary)) safe.relevanceSummary = cleanString(reference.relevanceSummary);
  if (Number.isInteger(reference.highlightCount) && reference.highlightCount >= 0) safe.highlightCount = reference.highlightCount;
  return safe;
}

export function createPublicProjection(source, options = {}) {
  const articles = {};
  Object.entries(source?.articles || {}).forEach(([articleId, article]) => {
    if (!isStableArticleId(articleId) || typeof article !== "object" || article === null) return;
    const slug = cleanString(article.slug);
    if (!slug) return;
    articles[articleId] = {
      slug,
      reading: sanitizeReading(article.reading),
      reflections: (Array.isArray(article.reflections) ? article.reflections : [])
        .map(sanitizeReflection)
        .filter(Boolean),
      readwiseReferences: (Array.isArray(article.readwiseReferences) ? article.readwiseReferences : [])
        .map(sanitizeReadwiseReference)
        .filter(Boolean)
    };
  });

  return {
    $schema: "./engagement.schema.json",
    schemaVersion: ENGAGEMENT_SCHEMA_VERSION,
    generatedAt: options.generatedAt || source?.generatedAt || "1970-01-01T00:00:00.000Z",
    policy: {
      readingEvidence: EXPLICIT_READING_EVIDENCE,
      publication: "explicit-public-projection-only",
      readwise: "metadata-only-no-raw-highlights"
    },
    integrations: {
      readwise: {
        adapter: "readwise-metadata-v1",
        status: "not-configured"
      }
    },
    articles
  };
}

function findUnknownKeys(value, allowed, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  Object.keys(value).forEach(key => {
    if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed in the public model`);
  });
}

function findForbiddenReadwiseKeys(value, path, errors) {
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, child]) => {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_READWISE_KEYS.has(key)) errors.push(`${childPath} is forbidden in public Readwise metadata`);
    findForbiddenReadwiseKeys(child, childPath, errors);
  });
}

export function validatePublicModel(model) {
  const errors = [];
  if (!model || typeof model !== "object") return ["The engagement model must be an object"];
  findUnknownKeys(model, ALLOWED.root, "root", errors);
  if (model.schemaVersion !== ENGAGEMENT_SCHEMA_VERSION) errors.push(`schemaVersion must be ${ENGAGEMENT_SCHEMA_VERSION}`);
  if (typeof model.generatedAt !== "string" || Number.isNaN(Date.parse(model.generatedAt))) errors.push("generatedAt must be an ISO date-time");
  findUnknownKeys(model.policy, ALLOWED.policy, "policy", errors);
  if (model.policy?.readingEvidence !== EXPLICIT_READING_EVIDENCE) errors.push("readingEvidence policy must require explicit user confirmation");
  if (model.policy?.publication !== "explicit-public-projection-only") errors.push("publication policy must be explicit-public-projection-only");
  if (model.policy?.readwise !== "metadata-only-no-raw-highlights") errors.push("Readwise policy must prohibit raw highlights");
  findUnknownKeys(model.integrations, ALLOWED.integrations, "integrations", errors);
  findUnknownKeys(model.integrations?.readwise, ALLOWED.integrationReadwise, "integrations.readwise", errors);
  if (model.integrations?.readwise?.adapter !== "readwise-metadata-v1") errors.push("Readwise adapter must be readwise-metadata-v1");
  if (model.integrations?.readwise?.status !== "not-configured") errors.push("Readwise connector must not be presented as configured or active");
  if (!model.articles || typeof model.articles !== "object" || Array.isArray(model.articles)) errors.push("articles must be an object");

  const slugs = new Set();
  Object.entries(model.articles || {}).forEach(([articleId, article]) => {
    const path = `articles.${articleId}`;
    if (!isStableArticleId(articleId)) errors.push(`${path} is not a stable EXP id`);
    if (!article || typeof article !== "object") {
      errors.push(`${path} must be an object`);
      return;
    }
    findUnknownKeys(article, ALLOWED.article, path, errors);
    if (typeof article.slug !== "string" || !article.slug.trim()) errors.push(`${path}.slug is required`);
    else if (slugs.has(article.slug)) errors.push(`${path}.slug duplicates another article`);
    else slugs.add(article.slug);
    if (article.reading !== null) {
      findUnknownKeys(article.reading, ALLOWED.reading, `${path}.reading`, errors);
      if (!isConfirmedRead(article)) errors.push(`${path}.reading is not an explicitly confirmed published reading state`);
    }
    if (!Array.isArray(article.reflections)) errors.push(`${path}.reflections must be an array`);
    else {
      article.reflections.forEach((reflection, index) => {
        findUnknownKeys(reflection, ALLOWED.reflection, `${path}.reflections[${index}]`, errors);
        if (reflection.publishedAt && Number.isNaN(Date.parse(reflection.publishedAt))) errors.push(`${path}.reflections[${index}].publishedAt is invalid`);
      });
      if (getPublishedReflections(article).length !== article.reflections.length) errors.push(`${path}.reflections contains private, draft, or invalid content`);
    }
    if (!Array.isArray(article.readwiseReferences)) errors.push(`${path}.readwiseReferences must be an array`);
    else {
      article.readwiseReferences.forEach((reference, index) => {
        findUnknownKeys(reference, ALLOWED.readwise, `${path}.readwiseReferences[${index}]`, errors);
        const sanitized = sanitizeReadwiseReference(reference);
        if (!sanitized) errors.push(`${path}.readwiseReferences[${index}] is private, draft, or invalid`);
        if (reference.canonicalUrl && sanitized?.canonicalUrl !== cleanHttpUrl(reference.canonicalUrl)) errors.push(`${path}.readwiseReferences[${index}].canonicalUrl must use http or https`);
        findForbiddenReadwiseKeys(reference, `${path}.readwiseReferences[${index}]`, errors);
      });
      if (getPublishedReadwiseReferences(article).length !== article.readwiseReferences.length) errors.push(`${path}.readwiseReferences contains private, draft, or invalid content`);
    }
  });
  return errors;
}

export function articleForId(model, articleId) {
  return isStableArticleId(articleId) ? model?.articles?.[articleId] || null : null;
}
