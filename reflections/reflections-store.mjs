import {
  COMMENT_EXPORT,
  REFLECTION_RETURN,
  anchorSignature,
  anchorsReferToSameText,
  canonicalItemJson,
  canonicalPackageHash,
  canonicalPackageJson,
  commentItemMatchesLocal,
  validatePackage
} from "./reflections-core.mjs";

const DB_NAME = "explorations-reflections";
const DB_VERSION = 1;
const STORE_NAMES = ["anchors", "comments", "revisions", "exports", "reflections", "imports"];

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("IndexedDB-anropet misslyckades.")), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("Lagringstransaktionen avbröts.")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error || new Error("Lagringstransaktionen misslyckades.")), { once: true });
  });
}

function ensureIndex(store, name, keyPath, options = {}) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
}

function upgradeDatabase(database, transaction) {
  const anchors = database.objectStoreNames.contains("anchors")
    ? transaction.objectStore("anchors")
    : database.createObjectStore("anchors", { keyPath: "id" });
  ensureIndex(anchors, "articleId", "articleId");
  ensureIndex(anchors, "signature", "signature");

  const comments = database.objectStoreNames.contains("comments")
    ? transaction.objectStore("comments")
    : database.createObjectStore("comments", { keyPath: "id" });
  ensureIndex(comments, "articleId", "articleId");
  ensureIndex(comments, "anchorId", "anchorId");
  ensureIndex(comments, "articleUpdated", ["articleId", "updatedAt"]);

  const revisions = database.objectStoreNames.contains("revisions")
    ? transaction.objectStore("revisions")
    : database.createObjectStore("revisions", { keyPath: "key" });
  ensureIndex(revisions, "articleId", "articleId");
  ensureIndex(revisions, "commentId", "commentId");

  const exportsStore = database.objectStoreNames.contains("exports")
    ? transaction.objectStore("exports")
    : database.createObjectStore("exports", { keyPath: "packageId" });
  ensureIndex(exportsStore, "articleId", "articleId");
  ensureIndex(exportsStore, "createdAt", "createdAt");

  const reflections = database.objectStoreNames.contains("reflections")
    ? transaction.objectStore("reflections")
    : database.createObjectStore("reflections", { keyPath: "id" });
  ensureIndex(reflections, "articleId", "articleId");
  ensureIndex(reflections, "anchorId", "anchorId");
  ensureIndex(reflections, "sourcePackageId", "sourcePackageId");

  const imports = database.objectStoreNames.contains("imports")
    ? transaction.objectStore("imports")
    : database.createObjectStore("imports", { keyPath: "packageId" });
  ensureIndex(imports, "articleId", "articleId");
  ensureIndex(imports, "importedAt", "importedAt");
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("Den här webbläsaren erbjuder inte IndexedDB."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener("upgradeneeded", event => {
      upgradeDatabase(request.result, event.target.transaction);
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("blocked", () => reject(new Error("Lagringen blockeras av en annan öppen version av sidan.")), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("IndexedDB kunde inte öppnas.")), { once: true });
  });
}

function valuesForArticle(transaction, storeName, articleId) {
  return requestResult(transaction.objectStore(storeName).index("articleId").getAll(articleId));
}

function byCreatedAt(left, right) {
  return String(left?.createdAt || left?.savedAt || left?.importedAt || "")
    .localeCompare(String(right?.createdAt || right?.savedAt || right?.importedAt || ""));
}

function exportReceipt(pkg, items = pkg.items) {
  return {
    packageId: pkg.packageId,
    articleId: pkg.article.id,
    createdAt: pkg.createdAt,
    mode: pkg.mode,
    items: items.map(item => ({ commentId: item.id, revision: item.revision })),
    packageHash: canonicalPackageHash(pkg),
    packageCanonical: canonicalPackageJson(pkg),
    package: { ...pkg, items }
  };
}

function importedAnchor(item) {
  const anchor = { ...item.anchor };
  const expected = anchorSignature(anchor);
  if (anchor.signature !== expected) throw new Error(`Ankaret ${anchor.id} har en ogiltig signatur.`);
  anchor.signature = expected;
  return anchor;
}

function sameImmutableComment(left, right) {
  return ["id", "articleId", "anchorId", "kind", "createdAt", "visibility", "publicationStatus"]
    .every(key => left?.[key] === right?.[key]);
}

function assertRevision(comment, revision) {
  if (
    revision?.key !== `${comment.id}:${comment.currentRevision}`
    || revision?.commentId !== comment.id
    || revision?.articleId !== comment.articleId
    || revision?.revision !== comment.currentRevision
    || !Array.isArray(revision?.body)
    || !revision.body.length
    || !revision.body.every(part => typeof part === "string" && part.trim())
  ) throw new Error("Kommentarens revision är inkonsekvent.");
}

async function equivalentAnchor(index, candidate) {
  const matches = await requestResult(index.getAll(candidate.signature));
  return matches.find(anchor => anchorsReferToSameText(anchor, candidate)) || null;
}

class ReflectionStore {
  constructor(database) {
    this.database = database;
    database.addEventListener("versionchange", () => database.close());
  }

  async snapshot(articleId) {
    const transaction = this.database.transaction(STORE_NAMES, "readonly");
    const done = transactionDone(transaction);
    const [anchors, comments, revisions, exports, reflections, imports] = await Promise.all(
      STORE_NAMES.map(name => valuesForArticle(transaction, name, articleId))
    );
    await done;
    anchors.sort(byCreatedAt);
    comments.sort(byCreatedAt);
    revisions.sort((left, right) => left.commentId.localeCompare(right.commentId) || left.revision - right.revision);
    exports.sort(byCreatedAt);
    reflections.sort(byCreatedAt);
    imports.sort(byCreatedAt);
    return { anchors, comments, revisions, exports, reflections, imports };
  }

  async summary() {
    const transaction = this.database.transaction("comments", "readonly");
    const done = transactionDone(transaction);
    const comments = await requestResult(transaction.objectStore("comments").getAll());
    await done;
    return comments.reduce((result, comment) => {
      result[comment.articleId] = { comments: (result[comment.articleId]?.comments || 0) + 1 };
      return result;
    }, {});
  }

  async findAnchorBySignature(articleId, signature) {
    const transaction = this.database.transaction("anchors", "readonly");
    const done = transactionDone(transaction);
    const matches = await requestResult(transaction.objectStore("anchors").index("signature").getAll(signature));
    await done;
    return matches.find(anchor => anchor.articleId === articleId) || null;
  }

  async addComment(anchor, comment, revision) {
    const expectedSignature = anchorSignature(anchor);
    if (
      anchor.signature !== expectedSignature
      || anchor.articleId !== comment.articleId
      || comment.anchorId !== anchor.id
      || comment.currentRevision !== 1
      || comment.kind !== "user-comment"
      || comment.visibility !== "private"
      || comment.publicationStatus !== "draft"
    ) throw new Error("Kommentaren eller ankaret är inkonsekvent.");
    assertRevision(comment, revision);
    const transaction = this.database.transaction(["anchors", "comments", "revisions"], "readwrite");
    const done = transactionDone(transaction);
    try {
      const anchorStore = transaction.objectStore("anchors");
      const existing = await equivalentAnchor(anchorStore.index("signature"), anchor);
      const actualAnchor = existing || { ...anchor, signature: expectedSignature };
      if (actualAnchor.articleId !== comment.articleId) throw new Error("Ankaret hör till fel artikel.");
      if (!existing) await requestResult(anchorStore.add(actualAnchor));
      const storedComment = { ...comment, anchorId: actualAnchor.id };
      await requestResult(transaction.objectStore("comments").add(storedComment));
      await requestResult(transaction.objectStore("revisions").add({ ...revision, commentId: storedComment.id, articleId: storedComment.articleId }));
      await done;
      return { anchorId: actualAnchor.id, comment: storedComment };
    } catch (error) {
      try { transaction.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
  }

  async reviseComment(comment, revision) {
    const transaction = this.database.transaction(["anchors", "comments", "revisions"], "readwrite");
    const done = transactionDone(transaction);
    try {
      const comments = transaction.objectStore("comments");
      const existing = await requestResult(comments.get(comment.id));
      if (!existing) throw new Error("Kommentaren finns inte längre.");
      if (!sameImmutableComment(existing, comment)) throw new Error("Kommentarens identitet eller ankare får inte ändras vid redigering.");
      if (comment.currentRevision !== existing.currentRevision + 1 || revision.revision !== comment.currentRevision) {
        throw new Error("Kommentaren har ändrats i en annan flik. Ladda om innan du sparar.");
      }
      assertRevision(comment, revision);
      const anchor = await requestResult(transaction.objectStore("anchors").get(comment.anchorId));
      if (!anchor || anchor.articleId !== comment.articleId) throw new Error("Kommentarens ankare saknas eller hör till fel artikel.");
      await requestResult(transaction.objectStore("revisions").add(revision));
      await requestResult(comments.put(comment));
      await done;
      return comment;
    } catch (error) {
      try { transaction.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
  }

  async deleteComment(commentId) {
    const transaction = this.database.transaction(["anchors", "comments", "revisions"], "readwrite");
    const done = transactionDone(transaction);
    try {
      const comments = transaction.objectStore("comments");
      const comment = await requestResult(comments.get(commentId));
      if (!comment) {
        await done;
        return false;
      }
      await requestResult(comments.delete(commentId));
      const revisions = transaction.objectStore("revisions");
      const revisionKeys = await requestResult(revisions.index("commentId").getAllKeys(commentId));
      await Promise.all(revisionKeys.map(key => requestResult(revisions.delete(key))));
      const remaining = await requestResult(comments.index("anchorId").getAllKeys(comment.anchorId));
      if (!remaining.length) await requestResult(transaction.objectStore("anchors").delete(comment.anchorId));
      await done;
      return true;
    } catch (error) {
      try { transaction.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
  }

  async recordExport(pkg) {
    const errors = validatePackage(pkg);
    if (errors.length || pkg.packageType !== COMMENT_EXPORT) throw new Error(errors.join(" ") || "Endast kommentarspaket kan registreras som export.");
    const transaction = this.database.transaction(["anchors", "comments", "revisions", "exports"], "readwrite");
    const done = transactionDone(transaction);
    try {
      const exportsStore = transaction.objectStore("exports");
      const existingReceipt = await requestResult(exportsStore.get(pkg.packageId));
      const packageCanonical = canonicalPackageJson(pkg);
      if (existingReceipt) {
        if (existingReceipt.packageCanonical === packageCanonical) {
          await done;
          return pkg.packageId;
        }
        throw new Error("Export-id:t används redan av ett annat paket.");
      }
      for (const item of pkg.items) {
        const comment = await requestResult(transaction.objectStore("comments").get(item.id));
        const revision = await requestResult(transaction.objectStore("revisions").get(`${item.id}:${item.revision}`));
        const anchor = comment && await requestResult(transaction.objectStore("anchors").get(comment.anchorId));
        if (
          !comment
          || !revision
          || !anchor
          || comment.currentRevision !== item.revision
          || !commentItemMatchesLocal(item, comment, revision, anchor)
        ) throw new Error(`Kommentaren ${item.id} motsvarar inte den lokala aktuella revisionen.`);
      }
      await requestResult(exportsStore.add(exportReceipt(pkg)));
      await done;
      return pkg.packageId;
    } catch (error) {
      try { transaction.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
  }

  async applyPackage(pkg) {
    const errors = validatePackage(pkg);
    if (errors.length) throw new Error(errors.join(" "));
    const transaction = this.database.transaction(STORE_NAMES, "readwrite");
    const done = transactionDone(transaction);
    try {
      const packageHash = canonicalPackageHash(pkg);
      const packageCanonical = canonicalPackageJson(pkg);
      const importsStore = transaction.objectStore("imports");
      const priorImport = await requestResult(importsStore.get(pkg.packageId));
      if (priorImport) {
        if (priorImport.packageCanonical !== packageCanonical) throw new Error("Paket-id:t används redan av ett annat innehåll.");
      }
      const accepted = [];
      const already = [];
      const needsLink = [];
      const unknown = [];
      const conflicts = [];

      if (pkg.packageType === COMMENT_EXPORT) {
        const anchorStore = transaction.objectStore("anchors");
        const commentsStore = transaction.objectStore("comments");
        const revisionsStore = transaction.objectStore("revisions");
        for (const item of pkg.items) {
          const candidate = importedAnchor(item);
          if (candidate.articleId !== pkg.article.id || candidate.slug !== pkg.article.slug) throw new Error(`Ankaret ${candidate.id} hör till fel artikel.`);
          const existingComment = await requestResult(commentsStore.get(item.id));
          const existingRevision = await requestResult(revisionsStore.get(`${item.id}:${item.revision}`));
          if (existingComment || existingRevision) {
            const existingAnchor = existingComment && await requestResult(anchorStore.get(existingComment.anchorId));
            if (
              existingComment
              && existingRevision
              && existingAnchor
              && commentItemMatchesLocal(item, existingComment, existingRevision, existingAnchor)
            ) already.push(item);
            else conflicts.push(item);
            continue;
          }
          const anchorWithSignature = await equivalentAnchor(anchorStore.index("signature"), candidate);
          const anchor = anchorWithSignature || candidate;
          if (!anchorWithSignature) await requestResult(anchorStore.add(anchor));
          await requestResult(commentsStore.add({
            id: item.id,
            articleId: item.articleId,
            anchorId: anchor.id,
            kind: "user-comment",
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            currentRevision: item.revision,
            visibility: "private",
            publicationStatus: "draft",
            restoredFromPackageId: pkg.packageId
          }));
          await requestResult(revisionsStore.add({
            key: `${item.id}:${item.revision}`,
            commentId: item.id,
            articleId: item.articleId,
            revision: item.revision,
            savedAt: item.updatedAt,
            body: item.body
          }));
          accepted.push(item);
        }
        const eligible = [...accepted, ...already];
        if (!eligible.length) throw new Error("Backupen innehåller inga konfliktfria poster att återställa.");
        const exportsStore = transaction.objectStore("exports");
        const priorExport = await requestResult(exportsStore.get(pkg.packageId));
        if (priorExport && priorExport.packageCanonical !== packageCanonical) throw new Error("Export-id:t används redan av ett annat innehåll.");
        await requestResult(exportsStore.put(exportReceipt(pkg, eligible)));
      } else if (pkg.packageType === REFLECTION_RETURN) {
        const sourceExport = await requestResult(transaction.objectStore("exports").get(pkg.sourcePackageId));
        if (!sourceExport) throw new Error("Returpaketets källexport finns inte på den här enheten.");
        if (sourceExport.articleId !== pkg.article.id) throw new Error("Returpaketets källexport hör till fel artikel.");
        const sourceKeys = new Set((sourceExport.items || []).map(item => `${item.commentId}:${item.revision}`));
        const sourceItems = sourceExport.package?.items || [];
        const revisionsStore = transaction.objectStore("revisions");
        const reflectionsStore = transaction.objectStore("reflections");
        for (const item of pkg.items) {
          const existing = await requestResult(reflectionsStore.get(item.id));
          if (existing) {
            if (canonicalItemJson(existing) === canonicalItemJson(item)) already.push(item);
            else conflicts.push(item);
            continue;
          }
          const references = item.replyTo || [];
          if (!references.every(reference => sourceKeys.has(`${reference.id}:${reference.revision}`))) {
            conflicts.push(item);
            continue;
          }
          const localRevisions = [];
          for (const reference of item.replyTo) {
            const revision = await requestResult(revisionsStore.get(`${reference.id}:${reference.revision}`));
            if (revision) localRevisions.push(revision);
          }
          if (localRevisions.length !== references.length) {
            (localRevisions.length ? needsLink : unknown).push(item);
            continue;
          }
          if (localRevisions.some(revision => revision.articleId !== pkg.article.id)) {
            conflicts.push(item);
            continue;
          }
          const anchorMatchesSource = references.some(reference => sourceItems.some(source => (
            source.id === reference.id
            && source.revision === reference.revision
            && source.anchor?.signature === item.anchor.signature
            && anchorsReferToSameText(source.anchor, item.anchor)
          )));
          if (!anchorMatchesSource) {
            needsLink.push(item);
            continue;
          }
          await requestResult(reflectionsStore.add({
            ...item,
            anchorId: item.anchor.id,
            sourcePackageId: pkg.sourcePackageId,
            sourceReturnPackageId: pkg.packageId,
            importedAt: new Date().toISOString(),
            visibility: "private",
            publicationStatus: "draft"
          }));
          accepted.push(item);
        }
      }
      if (!accepted.length && !already.length) throw new Error("Paketet innehåller inga säkert matchade poster att importera.");
      const now = new Date().toISOString();
      await requestResult(importsStore.put({
        packageId: pkg.packageId,
        packageHash,
        packageCanonical,
        articleId: pkg.article.id,
        sourcePackageId: pkg.sourcePackageId,
        packageType: pkg.packageType,
        importedAt: now,
        accepted: [...accepted, ...already].map(item => ({ id: item.id, revision: item.revision })),
        skipped: [
          ...already.map(item => ({ id: item.id, reason: "already" })),
          ...needsLink.map(item => ({ id: item.id, reason: "needs-link" })),
          ...unknown.map(item => ({ id: item.id, reason: "unknown" }))
        ],
        conflicts: conflicts.map(item => item.id)
      }));
      await done;
      return {
        imported: accepted.length,
        already: already.length,
        needsLink: needsLink.length,
        unknown: unknown.length,
        conflicts: conflicts.length,
        idempotent: accepted.length === 0 && needsLink.length === 0 && unknown.length === 0 && conflicts.length === 0
      };
    } catch (error) {
      try { transaction.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}

export async function openReflectionStore() {
  return new ReflectionStore(await openDatabase());
}
