import {
  COMMENT_EXPORT,
  REFLECTION_RETURN,
  anchorsReferToSameText,
  bodyToText,
  canonicalPackageJson,
  commentStatus,
  commentsForMode,
  createAnchor,
  createComment,
  createExportPackage,
  exportToMarkdown,
  fingerprintText,
  parsePackage,
  previewPackage,
  resolveAnchor,
  reviseComment
} from "./reflections-core.mjs";
import { openReflectionStore } from "./reflections-store.mjs";

const ASSET_ROOT = new URL("./", import.meta.url);
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
const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th,figcaption";
const EXCLUDED_SELECTOR = [
  ".toolbar", ".tools", "nav", "footer", ".toc", ".table-of-contents",
  ".sources", ".sources-section", ".source-list", ".references", ".bibliography", ".footnotes",
  ".related-explorations", ".search-popup", ".audio-player", ".font-controls",
  "script", "style", "noscript", "[data-engagement-asset]",
  "[data-xr-ui]"
].join(",");
const HIGHLIGHT_NAME = "explorations-reflections";

let stylesheetPromise;

function ensureStylesheet() {
  if (stylesheetPromise) return stylesheetPromise;
  stylesheetPromise = new Promise(resolve => {
    const existing = document.querySelector('link[data-xr-ui="style"]');
    if (existing) return resolve();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("reflections.css", ASSET_ROOT).href;
    link.dataset.xrUi = "style";
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", resolve, { once: true });
    document.head.append(link);
  });
  return stylesheetPromise;
}

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(options).forEach(([key, value]) => {
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key in node && key !== "role") node[key] = value;
    else node.setAttribute(key, value);
  });
  node.append(...children.filter(Boolean));
  return node;
}

function iconBubble() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", "M5 4.5h14v11H9l-4 4zM8 13l.5-2 5.8-5.8 2 2-5.8 5.8z");
  svg.append(path);
  return svg;
}

function articleId() {
  return document.documentElement.dataset.explorationId || "";
}

function slugFromLocation() {
  const parts = location.pathname.split("/").filter(Boolean);
  return parts.at(-1) === "index.html" ? parts.at(-2) || "" : parts.at(-1) || "";
}

async function loadRegistry() {
  const response = await fetch(new URL("article-registry.json", ASSET_ROOT), { cache: "no-store" });
  if (!response.ok) throw new Error(`Artikelregistret gav status ${response.status}.`);
  const model = await response.json();
  const articles = Array.isArray(model?.articles) ? model.articles : [];
  return new Map(articles.map(article => [article.id, article]));
}

function articleRoot() {
  for (const selector of ROOT_SELECTORS) {
    const root = document.querySelector(selector);
    if (root && root.textContent.trim().length > 80) return root;
  }
  return null;
}

function isExcluded(node, root) {
  const elementNode = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!elementNode || !root.contains(elementNode)) return true;
  const excluded = elementNode.closest(EXCLUDED_SELECTOR);
  return Boolean(excluded && root.contains(excluded));
}

function nearestHeading(block, root) {
  if (/^H[1-6]$/.test(block.tagName)) return block;
  let current = block;
  while (current && current !== root) {
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (/^H[1-6]$/.test(sibling.tagName)) return sibling;
      const nested = [...sibling.querySelectorAll?.("h1,h2,h3,h4,h5,h6") || []].at(-1);
      if (nested) return nested;
      sibling = sibling.previousElementSibling;
    }
    current = current.parentElement;
  }
  return root.querySelector("h1,h2,h3,h4,h5,h6");
}

function articleBlocks(root) {
  const candidates = [...root.querySelectorAll(BLOCK_SELECTOR)];
  if (root.matches?.(BLOCK_SELECTOR)) candidates.unshift(root);
  return candidates.filter(block => {
    if (isExcluded(block, root)) return false;
    if (block.matches("li,blockquote,td,th") && block.querySelector("p,li,blockquote")) return false;
    if (block.closest("p,li,blockquote,td,th") && !block.matches("p,li,blockquote,td,th")) return false;
    return block.textContent.replace(/\u00a0/g, " ").trim().length > 0;
  }).map((block, index) => {
    const heading = nearestHeading(block, root);
    return {
      id: block.id || null,
      tag: block.tagName.toLowerCase(),
      index,
      sectionId: heading?.id || null,
      sectionLabel: heading?.textContent.trim() || document.title,
      text: block.textContent.replace(/\u00a0/g, " "),
      element: block
    };
  });
}

function containingBlock(node, blocks) {
  const candidate = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  if (!candidate) return null;
  return blocks.find(block => block.element === candidate || block.element.contains(candidate)) || null;
}

function rangeOffset(block, container, offset) {
  const range = document.createRange();
  range.selectNodeContents(block);
  range.setEnd(container, offset);
  return range.toString().replace(/\u00a0/g, " ").length;
}

function pointAtOffset(block, offset) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isExcluded(node, block) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  let remaining = offset;
  let node = walker.nextNode();
  let last = null;
  while (node) {
    last = node;
    const length = node.nodeValue.replace(/\u00a0/g, " ").length;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
    node = walker.nextNode();
  }
  return last ? { node: last, offset: last.nodeValue.length } : null;
}

function rangeForResolution(resolution) {
  const block = resolution?.block?.element;
  if (!block) return null;
  const start = pointAtOffset(block, resolution.localStart);
  const end = pointAtOffset(block, resolution.localEnd);
  if (!start || !end) return null;
  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
}

function captureSelection(root, article, registryEntry) {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const blocks = articleBlocks(root);
  const startBlock = containingBlock(range.startContainer, blocks);
  const endBlock = containingBlock(range.endContainer, blocks);
  if (!startBlock || startBlock !== endBlock) return { error: "Markera text inom ett enda stycke eller en rubrik." };
  const index = blocks.indexOf(startBlock);
  let start = rangeOffset(startBlock.element, range.startContainer, range.startOffset);
  let end = rangeOffset(startBlock.element, range.endContainer, range.endOffset);
  if (end < start) [start, end] = [end, start];
  try {
    const anchor = createAnchor({
      articleId: article.id,
      slug: registryEntry.slug,
      blocks,
      blockIndex: index,
      start,
      end
    });
    return { anchor, rect: range.getBoundingClientRect() };
  } catch (error) {
    return { error: error.message };
  }
}

function setButtonLabel(button, count, selectionReady = false) {
  const label = selectionReady ? "Kommentera markering" : "Kommentarer";
  button.replaceChildren(iconBubble(), element("span", { className: "xr-trigger__label", text: label }), element("span", {
    className: "xr-count",
    text: String(count),
    "aria-label": `${count} lokala kommentarer`
  }));
  button.classList.toggle("xr-trigger--selection", selectionReady);
  button.dataset.selectionReady = String(selectionReady);
  button.setAttribute("aria-label", selectionReady ? "Kommentera den markerade texten" : `${count} lokala kommentarer. Öppna reflektionsspåret.`);
  button.title = selectionReady ? "Kommentera den markerade texten" : "Öppna kommentarer";
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function safeFileSlug(value) {
  return String(value || "EXP").replace(/[^a-z0-9]+/gi, "").slice(0, 16) || "EXP";
}

function downloadJson(pkg) {
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
  const link = element("a", { href: URL.createObjectURL(blob), download: `${safeFileSlug(pkg.article.id)}-ref-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  const textarea = element("textarea", { value: String(value), readOnly: true });
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Urklippet kunde inte nås.");
  return true;
}

function dialogShell(id, titleText) {
  const dialog = element("dialog", { id, className: "xr-dialog", lang: "sv", dataset: { xrUi: "dialog" } });
  const surface = element("div", { className: "xr-dialog__surface" });
  const title = element("h2", { id: `${id}-title`, text: titleText });
  const close = element("button", { type: "button", className: "xr-icon-button", text: "Stäng", "aria-label": `Stäng ${titleText.toLowerCase()}` });
  const header = element("header", { className: "xr-dialog__header" }, [title, close]);
  const body = element("div", { className: "xr-dialog__body" });
  dialog.setAttribute("aria-labelledby", title.id);
  surface.append(header, body);
  dialog.append(surface);
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
  return { dialog, surface, body, close };
}

function liveStatus() {
  return element("p", { className: "xr-status", role: "status", "aria-live": "polite", "aria-atomic": "true" });
}

class ReflectionSurface {
  constructor({ store, registryEntry, root }) {
    this.store = store;
    this.registryEntry = registryEntry;
    this.root = root;
    this.article = {
      id: articleId(),
      slug: registryEntry.slug,
      title: document.querySelector("h1")?.textContent.trim() || document.title,
      url: location.href.split("#")[0],
      contentRevision: ""
    };
    this.snapshot = { anchors: [], comments: [], revisions: [], exports: [], reflections: [], imports: [] };
    this.resolutions = new Map();
    this.activeAnchor = null;
    this.selectionSnapshot = null;
    this.editingComment = null;
    this.filter = "all";
    this.activeTab = "comments";
    this.lastFocus = null;
    this.renderTimer = null;
    this.build();
  }

  async init() {
    await this.reload();
    this.installEvents();
    this.installObserver();
    this.installViewport();
    this.renderHighlights();
  }

  build() {
    this.trigger = element("button", {
      id: "xr-trigger", type: "button", className: "xr-trigger", lang: "sv",
      "aria-expanded": "false", "aria-controls": "xr-panel", dataset: { xrUi: "trigger" }
    });
    this.trigger.setAttribute("aria-haspopup", "dialog");
    setButtonLabel(this.trigger, 0);

    this.selectionAction = element("button", {
      id: "xr-selection-action", type: "button", className: "xr-selection-action",
      text: "Kommentera markering", hidden: true, lang: "sv", dataset: { xrUi: "selection" }
    });

    this.panel = element("aside", {
      id: "xr-panel", className: "xr-panel", role: "dialog", lang: "sv", hidden: true,
      "aria-modal": "false", "aria-labelledby": "xr-panel-title", dataset: { xrUi: "panel" }
    });
    const heading = element("h2", { id: "xr-panel-title", text: "Reflektionsspår", tabIndex: -1 });
    this.closeButton = element("button", { type: "button", className: "xr-icon-button", text: "Stäng" });
    const header = element("header", { className: "xr-panel__header" }, [heading, this.closeButton]);
    this.localNote = element("p", { className: "xr-local-note", text: "Privat på denna enhet. Export ändrar eller tar inte bort dina kommentarer." });

    this.tabComments = element("button", { type: "button", className: "xr-tab", text: "Kommentarer 0", role: "tab", id: "xr-tab-comments", "aria-controls": "xr-comments", "aria-selected": "true" });
    this.tabReflections = element("button", { type: "button", className: "xr-tab", text: "Bearbetat 0", role: "tab", id: "xr-tab-reflections", "aria-controls": "xr-reflections", "aria-selected": "false", tabIndex: -1 });
    const tabs = element("div", { className: "xr-tabs", role: "tablist", "aria-label": "Lokalt reflektionsspår" }, [this.tabComments, this.tabReflections]);

    this.commentsPanel = element("section", { id: "xr-comments", className: "xr-tabpanel", role: "tabpanel", "aria-labelledby": "xr-tab-comments" });
    this.reflectionsPanel = element("section", { id: "xr-reflections", className: "xr-tabpanel", role: "tabpanel", "aria-labelledby": "xr-tab-reflections", hidden: true });
    this.status = liveStatus();
    const body = element("div", { className: "xr-panel__body" }, [this.commentsPanel, this.reflectionsPanel]);

    this.exportButton = element("button", { type: "button", className: "xr-button", text: "Exportera…" });
    this.importButton = element("button", { type: "button", className: "xr-button xr-button--quiet", text: "Importera retur…" });
    const footer = element("footer", { className: "xr-panel__footer" }, [this.status, this.exportButton, this.importButton]);
    this.panel.append(header, this.localNote, tabs, body, footer);

    this.markerLayer = element("div", { id: "xr-marker-layer", className: "xr-marker-layer", dataset: { xrUi: "markers" }, "aria-label": "Kommenterade textställen" });
    document.body.append(this.trigger, this.selectionAction, this.markerLayer, this.panel);
    this.placeTrigger();
    this.buildExportDialog();
    this.buildImportDialog();
  }

  placeTrigger() {
    const toolbar = document.querySelector(".toolbar, .tools");
    if (toolbar) {
      toolbar.append(this.trigger);
      this.trigger.classList.add("xr-trigger--toolbar");
    } else {
      this.trigger.classList.add("xr-trigger--floating");
    }
  }

  buildExportDialog() {
    const { dialog, body } = dialogShell("xr-export-dialog", "Exportera kommentarer");
    this.exportDialog = dialog;
    const intro = element("p", { text: "Kopiera läsbar Markdown hit för vidare reflektion. Originalen ligger kvar och kan exporteras igen." });
    this.exportChoices = element("fieldset", { className: "xr-export-choices" });
    this.exportChoices.append(element("legend", { text: "Vilka kommentarer?" }));
    [
      ["new", "Nya och ändrade"],
      ["all", "Alla"],
      ["selection", "Välj själv"]
    ].forEach(([value, label], index) => {
      const input = element("input", { type: "radio", name: "xr-export-mode", value, checked: index === 0 });
      this.exportChoices.append(element("label", {}, [input, document.createTextNode(label)]));
    });
    this.exportSelection = element("div", { className: "xr-export-selection", hidden: true });
    const selectionActions = element("div", { className: "xr-inline-actions" });
    const all = element("button", { type: "button", className: "xr-link-button", text: "Markera alla" });
    const none = element("button", { type: "button", className: "xr-link-button", text: "Avmarkera alla" });
    selectionActions.append(all, none);
    this.exportChecklist = element("div", { className: "xr-checklist" });
    this.exportSelection.append(selectionActions, this.exportChecklist);
    this.exportPreviewStatus = liveStatus();
    this.manualCopy = element("textarea", { className: "xr-manual-copy", readOnly: true, hidden: true, rows: 8, "aria-label": "Markdown för manuell kopiering" });
    this.copyExportButton = element("button", { type: "button", className: "xr-button xr-button--primary", text: "Kopiera Markdown" });
    this.downloadExportButton = element("button", { type: "button", className: "xr-button", text: "Ladda ned JSON-backup" });
    const actions = element("div", { className: "xr-dialog__actions" }, [this.copyExportButton, this.downloadExportButton]);
    body.append(intro, this.exportChoices, this.exportSelection, this.exportPreviewStatus, this.manualCopy, actions);
    document.body.append(dialog);
    this.exportChoices.addEventListener("change", () => this.renderExportSelection());
    this.exportChecklist.addEventListener("change", event => {
      if (event.target.matches("[data-anchor-toggle]")) {
        event.target.closest(".xr-check-group")?.querySelectorAll("[data-comment-id]").forEach(input => { input.checked = event.target.checked; });
      }
      this.syncExportGroups();
      this.updateExportCount();
    });
    all.addEventListener("click", () => {
      this.exportChecklist.querySelectorAll("input").forEach(input => { input.checked = true; });
      this.syncExportGroups();
      this.updateExportCount();
    });
    none.addEventListener("click", () => {
      this.exportChecklist.querySelectorAll("input").forEach(input => { input.checked = false; });
      this.syncExportGroups();
      this.updateExportCount();
    });
    this.copyExportButton.addEventListener("click", () => this.performExport("clipboard"));
    this.downloadExportButton.addEventListener("click", () => this.performExport("download"));
  }

  buildImportDialog() {
    const { dialog, body } = dialogShell("xr-import-dialog", "Importera returpaket");
    this.importDialog = dialog;
    const intro = element("p", { text: "Klistra in JSON-paketet från ChatGPT eller välj en backupfil. Inget publiceras automatiskt." });
    this.importText = element("textarea", { rows: 10, className: "xr-import-text", placeholder: "Klistra in paketet här…", "aria-label": "Returpaket som JSON" });
    this.importFile = element("input", { type: "file", accept: "application/json,.json", className: "xr-file-input", "aria-label": "Välj reflektions- eller backupfil" });
    this.importPreviewStatus = liveStatus();
    this.previewImportButton = element("button", { type: "button", className: "xr-button", text: "Granska paket" });
    this.applyImportButton = element("button", { type: "button", className: "xr-button xr-button--primary", text: "Importera matchade", disabled: true });
    const actions = element("div", { className: "xr-dialog__actions" }, [this.previewImportButton, this.applyImportButton]);
    body.append(intro, this.importText, this.importFile, this.importPreviewStatus, actions);
    document.body.append(dialog);
    const invalidatePreview = () => {
      this.pendingImport = null;
      this.applyImportButton.disabled = true;
      this.importPreviewStatus.textContent = "Paketet har ändrats. Granska det igen före import.";
    };
    this.importText.addEventListener("input", invalidatePreview);
    this.importFile.addEventListener("change", async () => {
      const file = this.importFile.files?.[0];
      if (file) {
        this.importText.value = await file.text();
        invalidatePreview();
      }
    });
    this.previewImportButton.addEventListener("click", () => this.previewImport());
    this.applyImportButton.addEventListener("click", () => this.applyImport());
  }

  installEvents() {
    const captureBeforeToolbarAction = () => this.captureSelectionForToolbar();
    this.trigger.addEventListener("pointerdown", captureBeforeToolbarAction);
    this.trigger.addEventListener("touchstart", captureBeforeToolbarAction, { passive: true });
    this.trigger.addEventListener("mousedown", captureBeforeToolbarAction);
    this.trigger.addEventListener("click", () => {
      if (this.selectionSnapshot && !this.selectionSnapshot.error) {
        this.useSelection();
        return;
      }
      this.panel.hidden ? this.openPanel() : this.closePanel();
    });
    this.closeButton.addEventListener("click", () => this.closePanel(true));
    this.selectionAction.addEventListener("click", () => this.useSelection());
    this.exportButton.addEventListener("click", () => this.openExport());
    this.importButton.addEventListener("click", () => this.openImport());
    this.tabComments.addEventListener("click", () => this.switchTab("comments"));
    this.tabReflections.addEventListener("click", () => this.switchTab("reflections"));
    this.panel.querySelector(".xr-tabs").addEventListener("keydown", event => {
      const tabs = [this.tabComments, this.tabReflections];
      const index = tabs.indexOf(document.activeElement);
      if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click();
      tabs[next].focus();
    });

    let selectionTimers = [];
    const queueSelection = (delays = [60, 220, 520]) => {
      selectionTimers.forEach(clearTimeout);
      selectionTimers = delays.map(delay => setTimeout(() => this.readSelection({ preserve: true }), delay));
    };
    document.addEventListener("selectionchange", () => queueSelection());
    document.addEventListener("contextmenu", () => queueSelection([80, 280, 700, 1200]));
    this.root.addEventListener("pointerup", () => queueSelection([40, 180, 420, 900]));
    this.root.addEventListener("touchend", () => queueSelection([120, 320, 700, 1200]), { passive: true });
    document.addEventListener("pointerdown", event => {
      if (event.target.closest?.("#xr-selection-action, #xr-trigger, #xr-panel, .xr-dialog")) return;
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed) return;
      this.selectionSnapshot = null;
      this.selectionAction.hidden = true;
      this.updateTriggerState();
    }, { capture: true });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !this.panel.hidden && !this.exportDialog.open && !this.importDialog.open) this.closePanel(true);
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "r") {
        this.readSelection();
        if (this.selectionSnapshot && !this.selectionSnapshot.error) {
          event.preventDefault();
          this.useSelection();
        }
      }
    });
    window.addEventListener("beforeunload", event => {
      if (!this.panel.querySelector(".xr-composer textarea")?.value.trim()) return;
      event.preventDefault();
      event.returnValue = "";
    });
    window.addEventListener("resize", () => this.queueHighlights());
    window.addEventListener("scroll", () => this.positionMarkers(), { passive: true });
  }

  installObserver() {
    this.observer = new MutationObserver(records => {
      if (records.every(record => record.target.closest?.("[data-xr-ui]"))) return;
      this.queueHighlights();
    });
    this.observer.observe(this.root, { childList: true, subtree: true, characterData: true });
  }

  installViewport() {
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height || window.innerHeight;
      const top = viewport?.offsetTop || 0;
      document.documentElement.style.setProperty("--xr-visual-height", `${height}px`);
      document.documentElement.style.setProperty("--xr-visual-top", `${top}px`);
      document.documentElement.style.setProperty("--xr-visual-viewport-height", `${height}px`);
      document.documentElement.style.setProperty("--xr-visual-viewport-offset-top", `${top}px`);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
  }

  async reload(message = "") {
    this.snapshot = await this.store.snapshot(this.article.id);
    this.renderPanel();
    this.renderHighlights();
    if (message) this.announce(message);
  }

  announce(message, error = false) {
    this.status.textContent = message;
    this.status.classList.toggle("xr-status--error", error);
  }

  openPanel(focus = true) {
    this.lastFocus = document.activeElement;
    this.panel.hidden = false;
    this.trigger.setAttribute("aria-expanded", "true");
    document.body.classList.add("xr-panel-open");
    this.queueHighlights();
    setTimeout(() => this.positionMarkers(), 240);
    if (focus) this.panel.querySelector("h2")?.focus();
  }

  closePanel(restoreFocus = false) {
    const draft = this.panel.querySelector(".xr-composer textarea")?.value.trim();
    if (draft && !confirm("Stäng och lämna den osparade kommentaren?")) return;
    this.panel.hidden = true;
    this.trigger.setAttribute("aria-expanded", "false");
    document.body.classList.remove("xr-panel-open");
    this.clearComposer();
    this.queueHighlights();
    setTimeout(() => this.positionMarkers(), 240);
    if (restoreFocus) (this.lastFocus?.isConnected ? this.lastFocus : this.trigger).focus();
  }

  switchTab(tab) {
    this.activeTab = tab;
    const comments = tab === "comments";
    this.commentsPanel.hidden = !comments;
    this.reflectionsPanel.hidden = comments;
    this.tabComments.setAttribute("aria-selected", String(comments));
    this.tabReflections.setAttribute("aria-selected", String(!comments));
    this.tabComments.tabIndex = comments ? 0 : -1;
    this.tabReflections.tabIndex = comments ? -1 : 0;
  }

  readSelection({ preserve = false } = {}) {
    if (this.exportDialog.open || this.importDialog.open || !this.root.isConnected) return;
    const captured = captureSelection(this.root, this.article, this.registryEntry);
    if (!captured) {
      if (preserve && this.selectionSnapshot) {
        this.updateTriggerState();
        return;
      }
      this.selectionSnapshot = null;
      this.selectionAction.hidden = true;
      this.updateTriggerState();
      return;
    }
    this.selectionSnapshot = captured;
    if (captured.error) {
      this.selectionAction.textContent = "Markera inom ett stycke";
      this.selectionAction.disabled = true;
      this.selectionAction.hidden = false;
      this.announce(captured.error, true);
      this.updateTriggerState();
      return;
    }
    this.selectionAction.textContent = "Kommentera markering";
    this.selectionAction.disabled = false;
    this.selectionAction.hidden = false;
    this.updateTriggerState();
    if (captured.rect?.width || captured.rect?.height) {
      this.selectionAction.style.setProperty("--xr-selection-x", `${Math.max(12, Math.min(window.innerWidth - 190, captured.rect.left + captured.rect.width / 2))}px`);
      this.selectionAction.style.setProperty("--xr-selection-y", `${Math.max(12, captured.rect.bottom + 8)}px`);
    }
  }

  captureSelectionForToolbar() {
    if (this.exportDialog.open || this.importDialog.open || !this.root.isConnected) return;
    const captured = captureSelection(this.root, this.article, this.registryEntry);
    if (captured) this.selectionSnapshot = captured;
  }

  async useSelection() {
    const captured = this.selectionSnapshot;
    if (!captured || captured.error) return;
    if (this.panel.querySelector(".xr-composer textarea")?.value.trim()) {
      this.announce("Spara eller avbryt den pågående kommentaren först.", true);
      this.openPanel(false);
      return;
    }
    let anchor = this.snapshot.anchors.find(item => item.signature === captured.anchor.signature && anchorsReferToSameText(item, captured.anchor));
    anchor ||= captured.anchor;
    this.activeAnchor = anchor;
    this.selectionSnapshot = null;
    this.selectionAction.hidden = true;
    document.getSelection()?.removeAllRanges();
    this.updateTriggerState();
    this.openPanel(false);
    this.switchTab("comments");
    this.renderPanel();
    requestAnimationFrame(() => this.commentsPanel.querySelector("textarea")?.focus());
  }

  renderPanel() {
    const comments = this.snapshot.comments || [];
    const reflections = this.snapshot.reflections || [];
    this.updateTriggerState();
    this.tabComments.textContent = `Kommentarer ${comments.length}`;
    this.tabReflections.textContent = `Bearbetat ${reflections.length}`;
    this.renderComments();
    this.renderReflections();
    this.switchTab(this.activeTab);
  }

  updateTriggerState() {
    const count = this.snapshot.comments?.length || 0;
    const selectionReady = Boolean(this.selectionSnapshot && !this.selectionSnapshot.error);
    setButtonLabel(this.trigger, count, selectionReady);
  }

  renderComments() {
    this.commentsPanel.replaceChildren();
    const filters = element("div", { className: "xr-filters", role: "group", "aria-label": "Filtrera kommentarer" });
    [
      ["all", "Alla"], ["new", "Nya och ändrade"], ["exported", "Exporterade"], ["processed", "Bearbetade"]
    ].forEach(([value, label]) => {
      const button = element("button", { type: "button", className: "xr-filter", text: label, "aria-pressed": String(this.filter === value), dataset: { filter: value } });
      button.addEventListener("click", () => {
        if (this.commentsPanel.querySelector(".xr-composer textarea")?.value.trim()) {
          this.announce("Spara eller avbryt den pågående kommentaren före filterbyte.", true);
          return;
        }
        this.filter = value;
        this.renderComments();
        requestAnimationFrame(() => this.commentsPanel.querySelector(`[data-filter="${value}"]`)?.focus());
      });
      filters.append(button);
    });
    this.commentsPanel.append(filters);

    const visible = commentsForMode(this.snapshot.comments, this.snapshot.exports, this.snapshot.reflections, this.filter);
    const grouped = new Map();
    visible.forEach(comment => {
      if (!grouped.has(comment.anchorId)) grouped.set(comment.anchorId, []);
      grouped.get(comment.anchorId).push(comment);
    });
    if (!visible.length) {
      const empty = element("div", { className: "xr-empty" });
      empty.append(element("p", { text: this.snapshot.comments.length ? "Inga kommentarer matchar filtret." : "Markera en fras i artikeln och välj Kommentera markering." }));
      empty.append(element("p", { text: "Kortkommando: Ctrl eller ⌘ + Skift + R när text är markerad." }));
      this.commentsPanel.append(empty);
    }

    for (const [anchorIdValue, groupComments] of grouped) {
      const anchor = this.snapshot.anchors.find(item => item.id === anchorIdValue);
      if (!anchor) continue;
      const resolution = this.resolutions.get(anchor.id);
      const group = element("section", { className: "xr-anchor-group", tabIndex: -1, dataset: { anchorId: anchor.id } });
      const quote = element("blockquote", { text: anchor.textQuote.exact });
      const context = element("p", { className: "xr-anchor-context", text: anchor.sectionLabel || "Dokumentets början" });
      if (resolution?.status === "unresolved") context.append(document.createTextNode(" · Kopplingen till texten behöver granskas"));
      const groupActions = element("div", { className: "xr-inline-actions" });
      const jump = element("button", { type: "button", className: "xr-link-button", text: "Visa i texten", disabled: resolution?.status !== "resolved" });
      const add = element("button", { type: "button", className: "xr-link-button", text: "Lägg till en kommentar" });
      jump.addEventListener("click", () => this.jumpToAnchor(anchor.id));
      add.addEventListener("click", () => {
        if (this.commentsPanel.querySelector(".xr-composer textarea")?.value.trim()) {
          this.announce("Spara eller avbryt den pågående kommentaren först.", true);
          return;
        }
        this.activeAnchor = anchor;
        this.editingComment = null;
        this.renderComments();
        requestAnimationFrame(() => this.commentsPanel.querySelector("textarea")?.focus());
      });
      groupActions.append(jump, add);
      group.append(context, quote, groupActions);
      groupComments.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach(comment => group.append(this.commentCard(comment)));
      this.commentsPanel.append(group);
    }
    if (this.activeAnchor) this.commentsPanel.append(this.composer());
  }

  commentCard(comment) {
    const revision = this.snapshot.revisions.find(item => item.key === `${comment.id}:${comment.currentRevision}`);
    const card = element("article", { className: "xr-comment" });
    const status = commentStatus(comment, this.snapshot.exports, this.snapshot.reflections);
    const labels = { new: "Ny", changed: "Ändrad efter export", exported: "Exporterad", processed: "Bearbetad" };
    const meta = element("header", {}, [
      element("span", { className: `xr-state xr-state--${status}`, text: labels[status] }),
      element("time", { dateTime: comment.updatedAt, text: formatDate(comment.updatedAt) })
    ]);
    const body = element("div", { className: "xr-comment__body" });
    (revision?.body || []).forEach(paragraph => body.append(element("p", { text: paragraph })));
    const actions = element("div", { className: "xr-inline-actions" });
    const edit = element("button", { type: "button", className: "xr-link-button", text: "Redigera" });
    const remove = element("button", { type: "button", className: "xr-link-button xr-link-button--danger", text: "Ta bort" });
    edit.addEventListener("click", () => {
      if (this.panel.querySelector(".xr-composer textarea")?.value.trim()) {
        this.announce("Spara eller avbryt den pågående kommentaren först.", true);
        return;
      }
      this.activeAnchor = this.snapshot.anchors.find(item => item.id === comment.anchorId);
      this.editingComment = comment;
      this.renderComments();
      requestAnimationFrame(() => this.commentsPanel.querySelector("textarea")?.focus());
    });
    remove.addEventListener("click", async () => {
      if (this.panel.querySelector(".xr-composer textarea")?.value.trim()) {
        this.announce("Spara eller avbryt den pågående kommentaren innan du tar bort en annan.", true);
        return;
      }
      if (!confirm("Ta bort denna kommentar och dess lokala revisionshistorik?")) return;
      await this.store.deleteComment(comment.id);
      if (this.editingComment?.id === comment.id) this.clearComposer();
      await this.reload("Kommentaren togs bort.");
    });
    actions.append(edit, remove);
    card.append(meta, body, actions);
    return card;
  }

  composer() {
    const anchor = this.activeAnchor;
    const quote = element("blockquote", { text: anchor.textQuote.exact });
    const label = element("label", { text: this.editingComment ? "Redigera kommentar" : "Ny kommentar" });
    const revision = this.editingComment && this.snapshot.revisions.find(item => item.key === `${this.editingComment.id}:${this.editingComment.currentRevision}`);
    const textarea = element("textarea", { rows: 5, value: bodyToText(revision?.body || []), placeholder: "Skriv din kommentar eller reflektion…" });
    label.append(textarea);
    const cancel = element("button", { type: "button", className: "xr-button xr-button--quiet", text: "Avbryt" });
    const save = element("button", { type: "button", className: "xr-button xr-button--primary", text: this.editingComment ? "Spara ändring" : "Lägg till kommentar" });
    const status = liveStatus();
    let saving = false;
    const submit = async () => {
      if (saving) return;
      try {
        saving = true;
        save.disabled = true;
        cancel.disabled = true;
        textarea.readOnly = true;
        status.textContent = "Sparar…";
        if (this.editingComment) {
          const next = reviseComment(this.editingComment, textarea.value);
          await this.store.reviseComment(next.comment, next.revision);
        } else {
          const created = createComment({ articleId: this.article.id, anchorId: anchor.id, body: textarea.value });
          const result = await this.store.addComment(anchor, created.comment, created.revision);
          if (result?.anchorId && result.anchorId !== anchor.id) created.comment.anchorId = result.anchorId;
        }
        const wasEdit = Boolean(this.editingComment);
        this.editingComment = null;
        textarea.value = "";
        await this.reload(wasEdit ? "Ändringen är sparad." : "Kommentaren är sparad. Du kan fortsätta skriva fler.");
        this.activeAnchor = this.snapshot.anchors.find(existing => existing.signature === anchor.signature && anchorsReferToSameText(existing, anchor)) || anchor;
        this.renderComments();
        requestAnimationFrame(() => this.commentsPanel.querySelector("textarea")?.focus());
      } catch (error) {
        saving = false;
        save.disabled = false;
        cancel.disabled = false;
        textarea.readOnly = false;
        status.textContent = error.message || "Kommentaren kunde inte sparas.";
        status.classList.add("xr-status--error");
      }
    };
    textarea.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submit(); }
    });
    save.addEventListener("click", submit);
    cancel.addEventListener("click", () => {
      const anchorIdValue = anchor.id;
      this.clearComposer();
      this.renderComments();
      requestAnimationFrame(() => {
        const group = this.commentsPanel.querySelector(`[data-anchor-id="${CSS.escape(anchorIdValue)}"]`);
        (group?.querySelector(".xr-inline-actions button:last-child") || group)?.focus();
      });
    });
    const actions = element("div", { className: "xr-composer__actions" }, [cancel, save]);
    return element("form", { className: "xr-composer", onsubmit: event => event.preventDefault() }, [element("h3", { text: this.editingComment ? "Redigera" : "Fortsätt på markeringen" }), quote, label, status, actions]);
  }

  clearComposer() {
    this.activeAnchor = null;
    this.editingComment = null;
  }

  renderReflections() {
    this.reflectionsPanel.replaceChildren();
    if (!this.snapshot.reflections.length) {
      this.reflectionsPanel.append(element("div", { className: "xr-empty" }, [
        element("p", { text: "Här hamnar bearbetade reflektioner som du uttryckligen importerar från ett returpaket." }),
        element("p", { text: "De är lokala utkast och publiceras aldrig automatiskt." })
      ]));
      return;
    }
    this.snapshot.reflections.forEach(reflection => {
      const card = element("article", { className: "xr-reflection" });
      card.append(element("header", {}, [
        element("strong", { text: "Gemensam reflektion" }),
        element("span", { text: `${reflection.replyTo?.length || 0} ursprungskommentarer` })
      ]));
      if (reflection.anchor?.textQuote?.exact) card.append(element("blockquote", { text: reflection.anchor.textQuote.exact }));
      (reflection.body || []).forEach(paragraph => card.append(element("p", { text: paragraph })));
      card.append(element("p", { className: "xr-local-note", text: "Lokalt utkast, inte publicerat" }));
      this.reflectionsPanel.append(card);
    });
  }

  queueHighlights() {
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.renderHighlights(), 80);
  }

  renderHighlights() {
    if (!this.root?.isConnected) {
      const replacement = articleRoot();
      if (replacement) {
        this.observer?.disconnect();
        this.root = replacement;
        this.installObserver();
      } else return;
    }
    const blocks = articleBlocks(this.root);
    this.article.contentRevision = fingerprintText(blocks.map(block => block.text).join("\n"));
    this.resolutions.clear();
    const ranges = [];
    (this.snapshot.anchors || []).forEach(anchor => {
      const resolution = resolveAnchor(blocks, anchor);
      this.resolutions.set(anchor.id, resolution);
      if (resolution.status === "resolved") {
        const range = rangeForResolution(resolution);
        if (range) ranges.push(range);
      }
    });
    if (globalThis.CSS?.highlights && globalThis.Highlight) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      if (ranges.length) CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    }
    blocks.forEach(block => block.element.classList.remove("xr-highlight-fallback"));
    if (!(globalThis.CSS?.highlights && globalThis.Highlight)) {
      this.resolutions.forEach(resolution => {
        if (resolution.status === "resolved") resolution.block.element.classList.add("xr-highlight-fallback");
      });
    }
    this.renderMarkers();
    if (!this.commentsPanel.hidden && !this.activeAnchor) this.renderComments();
  }

  renderMarkers() {
    this.markerLayer.replaceChildren();
    const counts = new Map();
    this.snapshot.comments.forEach(comment => counts.set(comment.anchorId, (counts.get(comment.anchorId) || 0) + 1));
    counts.forEach((count, anchorIdValue) => {
      const resolution = this.resolutions.get(anchorIdValue);
      if (resolution?.status !== "resolved") return;
      const quote = this.snapshot.anchors.find(anchor => anchor.id === anchorIdValue)?.textQuote?.exact || "markerad text";
      const button = element("button", {
        type: "button", className: "xr-anchor-marker", text: String(count),
        "aria-label": `${count} kommentarer till: ${quote.slice(0, 90)}`,
        dataset: { anchorId: anchorIdValue }
      });
      button.addEventListener("click", () => {
        if (this.panel.querySelector(".xr-composer textarea")?.value.trim()) {
          this.announce("Spara eller avbryt den pågående kommentaren först.", true);
          this.openPanel(false);
          return;
        }
        this.activeAnchor = null;
        this.editingComment = null;
        this.filter = "all";
        this.openPanel(false);
        this.switchTab("comments");
        this.renderComments();
        const group = this.commentsPanel.querySelector(`[data-anchor-id="${CSS.escape(anchorIdValue)}"]`);
        group?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        group?.focus({ preventScroll: true });
      });
      button._xrBlock = resolution.block.element;
      this.markerLayer.append(button);
    });
    this.positionMarkers();
  }

  positionMarkers() {
    this.markerLayer.querySelectorAll(".xr-anchor-marker").forEach(button => {
      const rect = button._xrBlock?.getBoundingClientRect();
      if (!rect) return;
      button.style.setProperty("--xr-marker-top", `${rect.top + window.scrollY}px`);
      button.style.setProperty("--xr-marker-left", `${Math.min(document.documentElement.clientWidth - 48, rect.right + window.scrollX + 8)}px`);
    });
  }

  jumpToAnchor(anchorIdValue) {
    const resolution = this.resolutions.get(anchorIdValue);
    if (resolution?.status !== "resolved") return;
    const block = resolution.block.element;
    block.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    block.classList.add("xr-pulse");
    block.tabIndex = -1;
    block.focus({ preventScroll: true });
    setTimeout(() => block.classList.remove("xr-pulse"), 1100);
  }

  openExport() {
    if (this.panel.querySelector(".xr-composer textarea")?.value.trim()) return this.announce("Spara eller avbryt den pågående kommentaren före export.", true);
    if (!this.snapshot.comments.length) return this.announce("Det finns inga kommentarer att exportera.", true);
    this.manualCopy.hidden = true;
    this.exportPreviewStatus.textContent = "";
    this.exportPreviewStatus.classList.remove("xr-status--error");
    this.renderExportSelection();
    this.exportDialog.showModal();
  }

  selectedExportMode() {
    return this.exportChoices.querySelector('input[name="xr-export-mode"]:checked')?.value || "new";
  }

  exportCandidates() {
    const mode = this.selectedExportMode();
    if (mode === "selection") {
      const ids = new Set([...this.exportChecklist.querySelectorAll("[data-comment-id]:checked")].map(input => input.value));
      return this.snapshot.comments.filter(comment => ids.has(comment.id));
    }
    return commentsForMode(this.snapshot.comments, this.snapshot.exports, this.snapshot.reflections, mode);
  }

  renderExportSelection() {
    const mode = this.selectedExportMode();
    this.exportSelection.hidden = mode !== "selection";
    this.exportChecklist.replaceChildren();
    if (mode === "selection") {
      const groups = new Map();
      this.snapshot.comments.forEach(comment => {
        if (!groups.has(comment.anchorId)) groups.set(comment.anchorId, []);
        groups.get(comment.anchorId).push(comment);
      });
      groups.forEach((comments, anchorIdValue) => {
        const anchor = this.snapshot.anchors.find(item => item.id === anchorIdValue);
        const group = element("fieldset", { className: "xr-check-group" });
        group.append(element("legend", { text: anchor?.textQuote?.exact?.slice(0, 110) || "Okänt textankare" }));
        const groupToggle = element("input", { type: "checkbox", checked: true, dataset: { anchorToggle: anchorIdValue } });
        group.append(element("label", { className: "xr-check-group__toggle" }, [groupToggle, document.createTextNode(`Välj hela markeringen (${comments.length})`)]));
        comments.forEach(comment => {
          const revision = this.snapshot.revisions.find(item => item.key === `${comment.id}:${comment.currentRevision}`);
          const input = element("input", { type: "checkbox", value: comment.id, checked: true, dataset: { commentId: comment.id } });
          const label = element("label", { className: "xr-check-item" }, [input]);
          const text = element("span");
          text.append(element("strong", { text: formatDate(comment.updatedAt) }));
          text.append(document.createTextNode(` ${bodyToText(revision?.body).slice(0, 160)}`));
          label.append(text);
          group.append(label);
        });
        this.exportChecklist.append(group);
      });
    }
    const count = mode === "selection" ? this.snapshot.comments.length : commentsForMode(this.snapshot.comments, this.snapshot.exports, this.snapshot.reflections, mode).length;
    this.copyExportButton.textContent = `Kopiera ${count} kommentarer`;
    this.downloadExportButton.disabled = count === 0;
    this.copyExportButton.disabled = count === 0;
  }

  updateExportCount() {
    const count = this.selectedExportMode() === "selection"
      ? this.exportChecklist.querySelectorAll("[data-comment-id]:checked").length
      : this.exportCandidates().length;
    this.copyExportButton.textContent = `Kopiera ${count} kommentarer`;
    this.copyExportButton.disabled = count === 0;
    this.downloadExportButton.disabled = count === 0;
  }

  syncExportGroups() {
    this.exportChecklist.querySelectorAll(".xr-check-group").forEach(group => {
      const toggle = group.querySelector("[data-anchor-toggle]");
      const comments = [...group.querySelectorAll("[data-comment-id]")];
      const checked = comments.filter(input => input.checked).length;
      toggle.checked = checked === comments.length;
      toggle.indeterminate = checked > 0 && checked < comments.length;
    });
  }

  packageForExport() {
    const mode = this.selectedExportMode();
    return createExportPackage({
      article: this.article,
      anchors: this.snapshot.anchors,
      comments: this.exportCandidates(),
      revisions: this.snapshot.revisions,
      mode
    });
  }

  async performExport(destination) {
    try {
      this.exportPreviewStatus.classList.remove("xr-status--error");
      const pkg = this.packageForExport();
      if (destination === "clipboard") {
        const markdown = exportToMarkdown(pkg);
        try {
          await copyText(markdown);
        } catch (error) {
          this.manualCopy.value = markdown;
          this.manualCopy.hidden = false;
          this.manualCopy.focus();
          this.manualCopy.select();
          this.exportPreviewStatus.textContent = "Urklippet kunde inte nås. Kopiera texten manuellt. Inget har markerats som exporterat.";
          this.exportPreviewStatus.classList.add("xr-status--error");
          return;
        }
      } else {
        downloadJson(pkg);
      }
      await this.store.recordExport(pkg);
      await this.reload(destination === "clipboard" ? "Markdown är kopierad. Kommentarerna ligger kvar." : "Backupen har skapats. Kommentarerna ligger kvar.");
      this.exportPreviewStatus.textContent = destination === "clipboard" ? "Kopierat och registrerat i exporthistoriken." : "Backup skapad och registrerad i exporthistoriken.";
      this.renderExportSelection();
    } catch (error) {
      this.exportPreviewStatus.textContent = error.message || "Exporten misslyckades.";
      this.exportPreviewStatus.classList.add("xr-status--error");
    }
  }

  openImport() {
    if (this.panel.querySelector(".xr-composer textarea")?.value.trim()) return this.announce("Spara eller avbryt den pågående kommentaren före import.", true);
    this.importText.value = "";
    this.importPreviewStatus.textContent = "";
    this.importPreviewStatus.classList.remove("xr-status--error");
    this.applyImportButton.disabled = true;
    this.pendingImport = null;
    this.importDialog.showModal();
    this.importText.focus();
  }

  previewImport() {
    try {
      this.importPreviewStatus.classList.remove("xr-status--error");
      const pkg = parsePackage(this.importText.value);
      if (pkg.article.id !== this.article.id || pkg.article.slug !== this.article.slug) throw new Error(`Paketet hör till ${pkg.article.id}, inte denna artikel.`);
      if (pkg.packageType === REFLECTION_RETURN && !this.snapshot.exports.some(batch => batch.packageId === pkg.sourcePackageId)) {
        throw new Error("Returpaketets källexport finns inte på den här enheten.");
      }
      const preview = previewPackage(pkg, this.snapshot);
      this.pendingImport = { pkg, preview };
      const accepted = preview.matched.length;
      this.importPreviewStatus.textContent = [
        `Matchade: ${accepted}`,
        `Behöver kopplas: ${preview.needsLink.length}`,
        `Okända: ${preview.unknown.length}`,
        `Redan importerade: ${preview.already.length}`,
        `Konflikter: ${preview.conflicts.length}`
      ].join(". ");
      this.applyImportButton.disabled = accepted === 0;
      this.applyImportButton.textContent = pkg.packageType === COMMENT_EXPORT ? `Återställ ${accepted}` : `Importera ${accepted} matchade`;
    } catch (error) {
      this.pendingImport = null;
      this.applyImportButton.disabled = true;
      this.importPreviewStatus.textContent = error.message || "Paketet kunde inte valideras.";
      this.importPreviewStatus.classList.add("xr-status--error");
    }
  }

  async applyImport() {
    if (!this.pendingImport) return;
    try {
      const currentPackage = parsePackage(this.importText.value);
      if (canonicalPackageJson(currentPackage) !== canonicalPackageJson(this.pendingImport.pkg)) {
        this.pendingImport = null;
        this.applyImportButton.disabled = true;
        throw new Error("Paketet har ändrats sedan granskningen. Granska det igen före import.");
      }
      const result = await this.store.applyPackage(this.pendingImport.pkg);
      const count = result.imported;
      const unresolved = result.needsLink + result.unknown + result.conflicts;
      await this.reload(count
        ? `${count} poster importerades som privata lokala ${this.pendingImport.pkg.packageType === REFLECTION_RETURN ? "utkast" : "kommentarer"}.`
        : "Inga nya poster importerades.");
      this.importPreviewStatus.textContent = count
        ? `Importen är klar. Inget har publicerats.${unresolved ? ` ${unresolved} poster behöver fortfarande hanteras.` : ""}`
        : result.idempotent
          ? "Paketet var redan importerat. Inga dubletter skapades."
          : `${unresolved} poster behöver fortfarande kopplas eller lösas.`;
      this.applyImportButton.disabled = true;
      if (this.pendingImport.pkg.packageType === REFLECTION_RETURN) this.switchTab("reflections");
    } catch (error) {
      this.importPreviewStatus.textContent = error.message || "Importen misslyckades.";
      this.importPreviewStatus.classList.add("xr-status--error");
    }
  }
}

async function decorateLibrary(store) {
  const summary = await store.summary();
  const counts = summary instanceof Map ? summary : new Map(Object.entries(summary || {}));
  let legend = document.getElementById("explorations-status-legend");
  if (!legend) {
    legend = element("div", {
      id: "explorations-status-legend", className: "engagement-status-legend xr-library-legend",
      lang: "sv", "aria-label": "Statussymboler i biblioteket", dataset: { xrUi: "legend" }
    });
    document.querySelector(".search-container")?.insertAdjacentElement("afterend", legend);
  }
  if (!legend.querySelector('[data-xr-legend="comments"]')) {
    const legendItem = element("span", { className: "engagement-status-legend__item xr-library-legend__item", dataset: { xrLegend: "comments" } }, [
      iconBubble(), element("span", { text: "Privata kommentarer på denna enhet" })
    ]);
    legend.append(legendItem);
  }
  document.querySelectorAll(".article-card[data-exploration-id], .card[data-exploration-id]").forEach(card => {
    const countValue = counts.get(card.dataset.explorationId);
    const count = typeof countValue === "number" ? countValue : Number(countValue?.comments || countValue?.count || 0);
    if (!count) return;
    const marker = element("span", {
      className: "xr-library-marker", lang: "sv",
      role: "img", "aria-label": `${count} privata lokala kommentarer`, title: `${count} privata lokala kommentarer`, dataset: { xrUi: "library-marker" }
    }, [iconBubble(), element("span", { className: "xr-library-marker__count", text: String(count) })]);
    const meta = card.querySelector(".card-meta");
    if (meta) meta.insertAdjacentElement("afterend", marker);
    else card.prepend(marker);
  });
}

function persistentFailure(error) {
  const alert = element("aside", { className: "xr-storage-error", role: "alert", lang: "sv", dataset: { xrUi: "error" } });
  alert.append(element("strong", { text: "Lokala kommentarer är inte tillgängliga." }));
  alert.append(document.createTextNode(` ${error?.message || "IndexedDB kunde inte öppnas."} Ingen text har sparats.`));
  document.body.append(alert);
}

async function waitForArticleRoot() {
  const immediate = articleRoot();
  if (immediate) return immediate;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { observer.disconnect(); reject(new Error("Artikeltexten kunde inte hittas.")); }, 12000);
    const observer = new MutationObserver(() => {
      const root = articleRoot();
      if (!root) return;
      clearTimeout(timeout);
      observer.disconnect();
      resolve(root);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

export async function startReflections() {
  await ensureStylesheet();
  let store;
  try {
    store = await openReflectionStore();
  } catch (error) {
    persistentFailure(error);
    return;
  }
  if (!articleId()) {
    await decorateLibrary(store);
    return;
  }
  const registry = await loadRegistry();
  const entry = registry.get(articleId());
  if (!entry || entry.slug !== slugFromLocation()) throw new Error(`Artikelidentiteten ${articleId()} stämmer inte med registret.`);
  const root = await waitForArticleRoot();
  const surface = new ReflectionSurface({ store, registryEntry: entry, root });
  await surface.init();
}
