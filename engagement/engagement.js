import {
  articleForId,
  getArticleSignals,
  getPublishedReflections,
  getPublishedReadwiseReferences,
  validatePublicModel
} from "./engagement-core.mjs";

const DATA_URL = new URL("./engagement.public.json", import.meta.url);
const PRIVATE_RUNTIME_VERSION = "20260805-3";
const SVG = {
  read: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 5.5c3.5-.8 6.3-.2 8.5 1.7 2.2-1.9 5-2.5 8.5-1.7v13c-3.3-.7-6-.2-8.5 1.5-2.5-1.7-5.2-2.2-8.5-1.5zM12 7.2V20"/></svg>',
  reflection: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h14v11H9l-4 4zM8 8h8M8 11.5h6"/></svg>',
  readwise: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.5h11v15l-5.5-3-5.5 3zM9 8h6M9 11h4"/></svg>'
};

function dateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", { dateStyle: "long" }).format(date);
}

function iconMarker(kind, label) {
  const marker = document.createElement("span");
  marker.className = `engagement-marker engagement-marker--${kind}`;
  marker.setAttribute("role", "img");
  marker.setAttribute("aria-label", label);
  marker.title = label;
  marker.innerHTML = SVG[kind];
  return marker;
}

function markersFor(article) {
  const markers = document.createElement("span");
  markers.className = "engagement-markers";
  const signals = getArticleSignals(article);
  if (signals.showReadMarker) {
    const when = dateLabel(article.reading.confirmedAt);
    markers.append(iconMarker("read", when ? `Bekräftat läst ${when}` : "Bekräftat läst"));
  }
  if (signals.showReflectionMarker) {
    const label = signals.reflectionCount === 1 ? "En publicerad kommentar eller reflektion" : `${signals.reflectionCount} publicerade kommentarer och reflektioner`;
    markers.append(iconMarker("reflection", label));
  }
  if (signals.showReadwiseMarker) {
    const label = signals.readwiseReferenceCount === 1 ? "En publicerad Readwise-källa" : `${signals.readwiseReferenceCount} publicerade Readwise-källor`;
    markers.append(iconMarker("readwise", label));
  }
  return markers;
}

function statusLegend() {
  let legend = document.getElementById("explorations-status-legend");
  if (!legend) {
    legend = document.createElement("div");
    legend.id = "explorations-status-legend";
    legend.className = "engagement-status-legend xr-library-legend";
    legend.lang = "sv";
    legend.setAttribute("aria-label", "Statussymboler i biblioteket");
    const search = document.querySelector(".search-container");
    if (search) search.insertAdjacentElement("afterend", legend);
  }
  [
    ["read", "Läst"],
    ["reflection", "Publicerad reflektion"],
    ["readwise", "Readwise-källa"]
  ].forEach(([kind, label]) => {
    if (legend.querySelector(`[data-engagement-legend="${kind}"]`)) return;
    const item = document.createElement("span");
    item.className = "engagement-status-legend__item";
    item.dataset.engagementLegend = kind;
    item.innerHTML = `${SVG[kind]}<span>${label}</span>`;
    legend.append(item);
  });
  return legend;
}

function decorateLibrary(model) {
  statusLegend();
  document.querySelectorAll(".article-card[data-exploration-id], .card[data-exploration-id]").forEach(card => {
    const article = articleForId(model, card.dataset.explorationId);
    if (!article) return;
    const signals = getArticleSignals(article);
    if (signals.showReadMarker) card.dataset.read = "true";
    const markers = markersFor(article);
    if (!markers.childElementCount) return;
    const meta = card.querySelector(".card-meta");
    if (meta) meta.insertAdjacentElement("afterend", markers);
    else card.prepend(markers);
  });
}

function appendText(element, text) {
  if (typeof text === "string" && text.trim()) element.append(document.createTextNode(text.trim()));
}

function reflectionPanel(articleId, reflections, readwiseReferences) {
  const panelId = `engagementReflections-${articleId.replace(/[^a-z0-9]/gi, "")}`;
  const panel = document.createElement("aside");
  panel.className = "engagement-panel";
  panel.id = panelId;
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", `${panelId}-title`);

  const header = document.createElement("header");
  header.className = "engagement-panel__header";
  const title = document.createElement("h2");
  title.id = `${panelId}-title`;
  title.textContent = "Kommentarer och reflektioner";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "engagement-panel__close";
  close.setAttribute("aria-label", "Stäng kommentarer och reflektioner");
  close.textContent = "Stäng";
  header.append(title, close);
  panel.append(header);

  const intro = document.createElement("p");
  intro.className = "engagement-panel__intro";
  intro.textContent = "Sparade tankar som uttryckligen valts för publicering. Privata anteckningar och råa Readwise-highlights visas aldrig här.";
  panel.append(intro);

  reflections.forEach(reflection => {
    const entry = document.createElement("article");
    entry.className = "engagement-entry";
    const entryHeader = document.createElement("header");
    const kind = document.createElement("strong");
    kind.textContent = reflection.kind === "user-comment" ? "Håkans kommentar" : "Gemensam reflektion";
    entryHeader.append(kind);
    if (reflection.publishedAt) {
      const time = document.createElement("time");
      time.dateTime = reflection.publishedAt;
      time.textContent = dateLabel(reflection.publishedAt);
      entryHeader.append(time);
    }
    entry.append(entryHeader);
    reflection.body.forEach(paragraph => {
      const p = document.createElement("p");
      appendText(p, paragraph);
      entry.append(p);
    });
    if (reflection.articleAnchor) {
      const link = document.createElement("a");
      link.href = `#${encodeURIComponent(reflection.articleAnchor)}`;
      link.textContent = "Till berört avsnitt";
      link.addEventListener("click", () => {
        panel.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
      });
      entry.append(link);
    }
    panel.append(entry);
  });

  if (readwiseReferences.length) {
    const section = document.createElement("section");
    section.className = "engagement-readwise";
    const heading = document.createElement("h3");
    heading.textContent = "Tidigare läsning via Readwise";
    const provenance = document.createElement("p");
    provenance.className = "engagement-readwise__provenance";
    provenance.textContent = "Readwise visar ett tidigare lässpår. Det innebär inte automatiskt att hela källan är läst, att ett påstående är verifierat eller att Håkan instämmer.";
    section.append(heading, provenance);

    readwiseReferences.forEach(reference => {
      const entry = document.createElement("article");
      entry.className = "engagement-readwise__entry";
      const title = document.createElement(reference.canonicalUrl ? "a" : "strong");
      appendText(title, reference.title);
      if (reference.canonicalUrl) {
        title.href = reference.canonicalUrl;
        title.rel = "noopener noreferrer";
      }
      entry.append(title);
      if (reference.authors.length) {
        const authors = document.createElement("p");
        authors.className = "engagement-readwise__authors";
        appendText(authors, reference.authors.join(", "));
        entry.append(authors);
      }
      if (reference.relevanceSummary) {
        const summary = document.createElement("p");
        appendText(summary, reference.relevanceSummary);
        entry.append(summary);
      }
      const evidence = document.createElement("p");
      evidence.className = `engagement-readwise__evidence engagement-readwise__evidence--${reference.evidenceStatus}`;
      evidence.textContent = reference.evidenceStatus === "original-checked"
        ? "Proveniens: Readwise. Originalkällan har kontrollerats."
        : "Proveniens: Readwise. Originalkällan är ännu inte verifierad.";
      entry.append(evidence);
      section.append(entry);
    });
    panel.append(section);
  }

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "engagement-reflection-tab";
  trigger.setAttribute("aria-controls", panelId);
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = `${SVG.reflection}<span>Publicerat</span><span class="engagement-reflection-tab__count" aria-label="${reflections.length} publicerade reflektioner">R ${reflections.length}</span><span class="engagement-reflection-tab__count" aria-label="${readwiseReferences.length} publicerade Readwise-källor">W ${readwiseReferences.length}</span>`;

  const closePanel = () => {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  const openPanel = () => {
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    close.focus();
  };
  trigger.addEventListener("click", () => panel.hidden ? openPanel() : closePanel());
  close.addEventListener("click", () => {
    closePanel();
    trigger.focus();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) {
      closePanel();
      trigger.focus();
    }
  });

  return { panel, trigger };
}

function decorateArticle(model) {
  const articleId = document.documentElement.dataset.explorationId;
  const article = articleForId(model, articleId);
  if (!article) return;

  const signals = getArticleSignals(article);
  const reflections = getPublishedReflections(article);
  const readwiseReferences = getPublishedReadwiseReferences(article);

  const render = () => {
    let awaitingAsyncArticle = false;
    if ((signals.showReadMarker || signals.showReflectionMarker || signals.showReadwiseMarker) && !document.querySelector(".engagement-markers--article")) {
      const meta = document.querySelector(".meta");
      if (meta) {
        const markers = markersFor(article);
        markers.classList.add("engagement-markers--article");
        meta.append(markers);
      } else if (document.getElementById("articleRoot")) awaitingAsyncArticle = true;
    }

    if (signals.showReflectionSurface && !document.querySelector(".engagement-reflection-tab")) {
      const toolbar = document.querySelector(".toolbar, .tools");
      if (!toolbar && document.getElementById("articleRoot")) {
        awaitingAsyncArticle = true;
      } else {
        const { panel, trigger } = reflectionPanel(articleId, reflections, readwiseReferences);
        if (toolbar) toolbar.append(trigger);
        else {
          trigger.classList.add("engagement-reflection-tab--floating");
          document.body.append(trigger);
        }
        document.body.append(panel);
      }
    }
    return awaitingAsyncArticle;
  };

  if (render()) {
    const observer = new MutationObserver(() => {
      if (!render()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

async function start() {
  const response = await fetch(`${DATA_URL.href}?v=1`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Engagement data returned ${response.status}`);
  const model = await response.json();
  const errors = validatePublicModel(model);
  if (errors.length) throw new Error(`Invalid engagement data: ${errors.join("; ")}`);
  decorateLibrary(model);
  document.dispatchEvent(new CustomEvent("explorations:engagement-ready"));
  decorateArticle(model);
}

import(`../reflections/reflections.js?v=${PRIVATE_RUNTIME_VERSION}`)
  .then(module => module.startReflections())
  .catch(error => {
    console.warn("[Explorations] Det privata reflektionsspåret kunde inte laddas.", error);
  });

start().catch(error => {
  console.warn("[Explorations] Engagement layer was not loaded.", error);
});
