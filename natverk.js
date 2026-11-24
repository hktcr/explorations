(function () {
  'use strict';

  var RELEASE = '20261109-teaching-1';
  var TYPE_LABELS = {
    'same-phenomenon':'Samma fenomen',
    'mechanism':'Mekanism',
    'prerequisite':'Förkunskap',
    'method-evidence':'Metod och evidens',
    'application':'Tillämpning',
    'contrast':'Kontrast',
    'analogy':'Analogi'
  };

  function normalize(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase('sv');
  }
  function tokenize(value) {
    var matches = normalize(value).match(/[\p{L}\p{M}]+/gu) || [], seen = {};
    return matches.filter(function (term) {
      if (term.length < 2 || seen[term]) return false;
      seen[term] = true;
      return true;
    });
  }
  function countMatches(value, term, limit) {
    var text = normalize(value), count = 0, offset = 0, index;
    limit = limit || Number.MAX_SAFE_INTEGER;
    while ((index = text.indexOf(term, offset)) !== -1 && count < limit) {
      count += 1;
      offset = index + term.length;
    }
    return count;
  }
  function searchIndex(data, query) {
    var terms = tokenize(query);
    if (!terms.length) return [];
    var results = [];
    (data.artiklar || []).forEach(function (article) {
      var score = 0, found = {}, sections = [];
      terms.forEach(function (term) {
        if (countMatches(article.titel, term, 1)) { score += 12; found[term] = true; }
        if (countMatches(article.amne, term, 1)) { score += 8; found[term] = true; }
      });
      (article.avsnitt || []).forEach(function (section) {
        var sectionScore = 0;
        terms.forEach(function (term) {
          var heading = countMatches(section.rubrik, term, 1);
          var body = countMatches(section.text, term, 5);
          if (heading || body) found[term] = true;
          sectionScore += heading * 6 + body;
        });
        if (sectionScore) sections.push({ankare:section.ankare, rubrik:section.rubrik, text:section.text, score:sectionScore});
        score += sectionScore;
      });
      if (terms.every(function (term) { return found[term]; }) && score) {
        sections.sort(function (a, b) { return b.score - a.score; });
        results.push({slug:article.slug, titel:article.titel, amne:article.amne, score:score, avsnitt:sections.slice(0, 4), termer:terms});
      }
    });
    return results.sort(function (a, b) { return b.score - a.score; });
  }
  function unique(values) {
    var seen = {}, result = [];
    (values || []).forEach(function (value) {
      value = String(value || '').trim();
      if (value && !seen[value]) { seen[value] = true; result.push(value); }
    });
    return result;
  }
  function relationSignature(data) {
    var relations = data && (data.relations || data.kanter) || [];
    return relations.map(function (relation) {
      return [relation.a, relation.b, relation.status, relation.type, relation.reason].concat(relation.terms || []).join('\u001f');
    }).sort().join('\u001e');
  }
  function validateNetwork(data, cardSlugs) {
    var errors = [], seen = {}, pairs = {};
    if (!data || data.schemaVersion !== 2 || data.releaseId !== RELEASE || !Array.isArray(data.artiklar)) return {valid:false, errors:['Fel nätverksversion']};
    data.artiklar.forEach(function (article) {
      if (!article.slug || seen[article.slug]) errors.push('Ogiltig nod');
      else seen[article.slug] = true;
    });
    (data.kanter || []).forEach(function (edge) {
      var pair = [edge.a, edge.b].sort().join('|');
      if (!seen[edge.a] || !seen[edge.b] || edge.a === edge.b || pairs[pair]) errors.push('Ogiltig kant: ' + pair);
      pairs[pair] = true;
    });
    var cards = unique(cardSlugs).sort(), nodes = Object.keys(seen).sort();
    if (cards.join('|') !== nodes.join('|')) errors.push('Kort och noder skiljer sig');
    return {valid:!errors.length, errors:errors, slugs:nodes};
  }
  function validateRelations(data, nodeSlugs) {
    var errors = [], nodes = {}, pairs = {}, degree = {};
    nodeSlugs.forEach(function (slug) { nodes[slug] = true; });
    if (!data || data.schemaVersion !== 1 || data.releaseId !== RELEASE || !Array.isArray(data.relations)) return {valid:false, errors:['Fel relationsversion']};
    data.relations.forEach(function (relation) {
      var pair = [relation.a, relation.b].sort().join('|');
      if (!nodes[relation.a] || !nodes[relation.b] || relation.a === relation.b || pairs[pair]) errors.push('Ogiltig relation: ' + pair);
      if (relation.status !== 'reviewed' || !TYPE_LABELS[relation.type] || !relation.reason || !Array.isArray(relation.terms) || !relation.terms.length) errors.push('Ofullständig relation: ' + pair);
      pairs[pair] = true;
      degree[relation.a] = (degree[relation.a] || 0) + 1;
      degree[relation.b] = (degree[relation.b] || 0) + 1;
    });
    Object.keys(degree).forEach(function (slug) {
      if (degree[slug] > 5) errors.push('För många relationer: ' + slug);
    });
    return {valid:!errors.length, errors:errors};
  }
  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (character) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];
    });
  }

  // Network search is metadata relevance, independent of curated relation types.
  function networkSearch(articles, relations, query, editorial) {
    var terms = normalize(query).match(/[\p{L}\p{M}\p{N}]+/gu) || [];
    var active = String(query || '').trim().length > 0;
    var matches = new Map(), neighbors = new Set(), links = new Set();
    if (active && terms.length) articles.forEach(function (article) {
      var fields = [['titel', 'titel'], ['amne', 'ämne'], ['id', 'id'], ['nyckelord', 'nyckelord']];
      if (!article.source && String(article.id).startsWith('EXP#')) fields[2][1]='essä-id';
      var haystack = fields.map(function (field) { return normalize(article[field[0]]); }).join(' ');
      if (terms.every(function (term) { return haystack.includes(term); })) {
        matches.set(article.slug, fields.filter(function (field) {
          return terms.some(function (term) { return normalize(article[field[0]]).includes(term); });
        }).map(function (field) { return field[1]; }));
      }
    });
    relations.forEach(function (edge, index) {
      if ((edge.status === 'reviewed' || (editorial && edge.kind === 'published-topic')) && (matches.has(edge.a) || matches.has(edge.b))) {
        links.add(index);
        if (!matches.has(edge.a)) neighbors.add(edge.a);
        if (!matches.has(edge.b)) neighbors.add(edge.b);
      }
    });
    return {active:active, matches:matches, neighbors:neighbors, links:links};
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      normalize:normalize,
      tokenize:tokenize,
      countMatches:countMatches,
      searchIndex:searchIndex,
      networkSearch:networkSearch,
      validateNetwork:validateNetwork,
      validateRelations:validateRelations,
      relationSignature:relationSignature,
      RELEASE:RELEASE
    };
  }
  if (typeof document === 'undefined') return;

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.body.classList.contains('natverk-sida')) return;
    var root = document.body.getAttribute('data-root') || '../';
    var graph = document.getElementById('natverk');
    var sourceMode = document.body.dataset.networkMode === 'sources';
    var editorialMode = document.body.dataset.networkMode === 'editorial';
    var embeddedMode = sourceMode || editorialMode;
    var topicAction = document.getElementById('natverkTopicAction');
    function signalParent(name, detail) {
      if (window.frameElement) window.frameElement.dispatchEvent(new CustomEvent('explorations:' + name, {detail: detail}));
    }
    var scale = 1, panX = 0, panY = 0, pointer = null;
    var sourceHits = new Set(), sourceFiltering = false;
    var sourceAction = document.getElementById('natverkSourceAction');
    function chronicleMode() { return location.hash === '#kronikor'; }
    var nodeLayer = document.getElementById('natverkNoder');
    var canvas = document.getElementById('natverkKanter');
    var status = document.getElementById('natverkStatus');
    var reset = document.getElementById('natverkAterstall');
    var list = document.getElementById('essaLista');
    var listCount = document.getElementById('essaAntal');
    var listSearch = document.getElementById('essaSok');
    var searchStatus = document.getElementById('essaSokStatus');
    var clearSearch = document.getElementById('essaSokRensa');
    var motionButton = document.getElementById('natverkRorelse');
    var panelTitle = document.getElementById('relationspanelTitel');
    var panelSubject = document.getElementById('relationspanelAmne');
    var panelMeta = document.getElementById('relationspanelMeta');
    var panelExcerpt = document.getElementById('relationspanelIngress');
    var panelKeywords = document.getElementById('relationspanelNyckelord');
    var panelRelations = document.getElementById('relationspanelLista');
    var panelRead = document.getElementById('relationspanelLas');
    var panelEmpty = document.getElementById('relationspanelTom');
    var panelContent = document.getElementById('relationspanelInnehall');
    if (!graph || !nodeLayer || !canvas || !status || !list || !listSearch) return;

    var savedTerms = !embeddedMode && window.ExplorationsNetworkConditions ?
      window.ExplorationsNetworkConditions(listSearch,document.getElementById('essayAddTerm'),document.getElementById('essayTerms'),'ec') : null;

    var networkData = null, relations = [], nodes = [], edges = [];
    var bySlug = Object.create(null), nodeElements = {}, listElements = {};
    var selected = null, animation = null, resizeTimer = null;
    var offsetX = 0, offsetY = 0, targetOffsetX = 0, targetOffsetY = 0;
    var search = networkSearch([], [], '');
    var reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    var paused = false, size = null, accent = '';

    function fetchJson(path) {
      return fetch(root + path + '?v=' + encodeURIComponent(RELEASE)).then(function (response) {
        if (!response.ok) throw new Error(path + ': ' + response.status);
        return response.json();
      });
    }
    function dimensions() {
      var rectangle = nodeLayer.getBoundingClientRect();
      return {width:Math.max(1, rectangle.width), height:Math.max(1, rectangle.height)};
    }
    function color() {
      return getComputedStyle(document.documentElement).getPropertyValue('--network-accent').trim() || '#c0392b';
    }
    function relationsFor(slug) {
      return edges.filter(function (edge) {
        return edge.a === slug || edge.b === slug;
      }).map(function (edge) {
        return {edge:edge, node:bySlug[edge.a === slug ? edge.b : edge.a]};
      }).filter(function (item) { return item.node; });
    }
    function updateUrl(push) {
      if (embeddedMode || chronicleMode()) return;
      var url = new URL(location.href);
      if (listSearch.value.trim()) url.searchParams.set('q', listSearch.value);
      else url.searchParams.delete('q');
      url.hash = selected ? encodeURIComponent(selected) : '';
      if (url.href !== location.href) history[push ? 'pushState' : 'replaceState'](null, '', url);
    }
    function renderList(filter) {
      search = networkSearch(nodes, edges, savedTerms ? savedTerms.query() : filter, editorialMode);
      var visible = 0;
      nodes.forEach(function (node) {
        var show = !search.active || search.matches.has(node.slug);
        listElements[node.slug].hidden = !show;
        var reason = listElements[node.slug].querySelector('.essa-trafforsak');
        reason.textContent = search.matches.has(node.slug) ? 'Direkt träff i ' + search.matches.get(node.slug).join(' och ') : '';
        reason.hidden = !search.active;
        if (show) visible += 1;
      });
      if (savedTerms) savedTerms.refresh(visible>0);
      listCount.textContent = String(visible);
      clearSearch.disabled = !listSearch.value;
      searchStatus.textContent = embeddedMode ? (search.active ? visible + ' träffar bland de visade noderna.' : '') : search.active ? (visible ? visible + ' direkta träffar, ' + search.links.size + ' granskade samband och ' + search.neighbors.size + ' kopplade essäer. Välj en träff för sambandstyp och motivering.' : 'Inga träffar. Prova andra ord eller rensa sökningen.') : '';
      refreshHighlights();
    }
    function refreshHighlights() {
      var neighbors = new Set(selected ? relationsFor(selected).map(function (item) { return item.node.slug; }) : []);
      nodes.forEach(function (node) {
        var slug = node.slug, current = slug === selected, direct = search.matches.has(slug);
        var connected = search.neighbors.has(slug);
        var element = nodeElements[slug];
        var conditionHit = embeddedMode && sourceFiltering && (sourceHits.has(slug) ||
          (editorialMode && node.kind === 'topic' && relationsFor(slug).some(function (item) { return sourceHits.has(item.node.slug); })));
        element.classList.toggle('nod-vald', current);
        element.classList.toggle('nod-granne', !search.active && neighbors.has(slug));
        element.classList.toggle('nod-traff', search.active ? direct : conditionHit);
        element.classList.toggle('nod-kopplad', connected);
        var sourceDim = (sourceFiltering && !node.source && !conditionHit) || (search.active && !direct && !connected);
        if (embeddedMode) element.dataset.dim = String(sourceDim);
        element.classList.toggle('svag', embeddedMode ? sourceDim && !current : search.active ? !direct && !connected && !current : !!selected && !current && !neighbors.has(slug));
        if (element.tagName !== 'A') {
          var pressed = editorialMode && node.kind === 'topic' ? node.picked : current;
          element.setAttribute('aria-pressed', String(pressed));
        }
        element.setAttribute('aria-label', (editorialMode ? (node.kind === 'article' ? 'Läs artikeln ' : 'Välj ämnesetiketten ') : '') + node.titel + (search.active ? direct ? '. Direkt sökträff i ' + search.matches.get(slug).join(' och ') : connected ? (editorialMode ? '. Etikettkoppling till sökträff' : '. Granskat samband med sökträff') : '. Ingen direkt sökträff' : ''));
        if (embeddedMode && sourceFiltering && !node.source && node.kind !== 'topic') element.setAttribute('aria-description',conditionHit ? 'Uppfyller alla valda villkor' : 'Uppfyller inte alla valda villkor');
        else element.removeAttribute('aria-description');
        listElements[slug].classList.toggle('essa-vald', current);
        listElements[slug].querySelector('button').setAttribute('aria-pressed', String(current));
      });
      if (search.active) targetOffsetX = targetOffsetY = 0;
      else if (selected) focusSelected(bySlug[selected]);
      startDrawing();
    }
    function renderPanel(node) {
      var related = relationsFor(node.slug);
      panelEmpty.hidden = true;
      panelContent.hidden = false;
      panelSubject.textContent = node.amne;
      panelTitle.textContent = node.titel;
      panelMeta.textContent = [node.id, node.datum, node.lastid].filter(Boolean).join(' · ');
      panelExcerpt.textContent = node.excerpt || '';
      panelKeywords.textContent = node.nyckelord && node.nyckelord.length ? 'Nyckelord: ' + node.nyckelord.join(', ') : '';
      if (editorialMode) {
        var isTopic = node.kind === 'topic';
        topicAction.hidden = !isTopic;
        if (isTopic) {
          topicAction.textContent = node.picked ? 'Ta bort ämnesvalet' : 'Välj ämnesetiketten';
          topicAction.setAttribute('aria-pressed', String(!!node.picked));
          topicAction.onclick = function () { signalParent('editorialtopic', node.titel); };
        }
        panelRead.hidden = isTopic;
        if (isTopic) panelRead.removeAttribute('href');
        else panelRead.href = node.href;
        panelKeywords.textContent = !isTopic && node.nyckelord.length ? 'Publicerade ämnesetiketter: ' + node.nyckelord.join(', ') : '';
      } else if (sourceMode) {
        panelRead.hidden = !node.href;
        if (node.href) panelRead.href = node.href;
        panelRead.textContent = node.source ? 'Öppna originalkällan' : 'Läs texten';
        sourceAction.hidden = !node.source;
        if (node.source) {
          sourceAction.textContent = node.picked ? 'Ta bort som källvillkor' : 'Lägg till som källvillkor';
          sourceAction.setAttribute('aria-pressed', String(!!node.picked));
          sourceAction.onclick = function () { graph.dispatchEvent(new CustomEvent('explorations:sourcecondition', {detail:node.slug})); };
        }
      } else {
        panelRead.href = root + node.slug + '/index.html';
        panelRead.setAttribute('aria-label', 'Läs essän ' + node.titel);
      }
      panelRelations.innerHTML = '';
      related.forEach(function (item) {
        var row = document.createElement('li');
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'relationspanel-valj';
        button.innerHTML = '<span class="relationspanel-relationstyp">' + escapeHtml(embeddedMode ? item.edge.label : TYPE_LABELS[item.edge.type]) + '</span>'
          + '<span class="relationspanel-relationstitel">' + escapeHtml(item.node.titel) + '</span>'
          + '<span class="relationspanel-orsak">' + escapeHtml(item.edge.reason) + '</span>';
        button.addEventListener('click', function () { selectNode(item.node, true); });
        row.appendChild(button);
        panelRelations.appendChild(row);
      });
    }
    function focusSelected(node) {
      var size = dimensions();
      targetOffsetX = size.width / 2 - node.x;
      targetOffsetY = size.height / 2 - node.y;
      panX = panY = 0;
    }
    function selectNode(node, focusPanel, fromHistory) {
      selected = node.slug;
      renderPanel(node);
      refreshHighlights();
      if (!listElements[node.slug].hidden && !fromHistory) listElements[node.slug].scrollIntoView({block:'nearest', behavior:'auto'});
      status.textContent = node.titel + ' vald. ' + relationsFor(node.slug).length + (editorialMode ? ' etikettkopplingar i panelen.' : sourceMode ? ' kopplingar i panelen.' : ' granskade samband i panelen.');
      if (!fromHistory) updateUrl(true);
      if (focusPanel && panelTitle) panelTitle.focus({preventScroll:true});
    }
    function clearSelection(fromHistory) {
      selected = null;
      targetOffsetX = 0;
      targetOffsetY = 0;
      refreshHighlights();
      panelEmpty.hidden = false;
      panelContent.hidden = true;
      status.textContent = editorialMode ? nodes.length + ' noder och ' + edges.length + ' publicerade etikettkopplingar.' : sourceMode ? nodes.length + ' noder: ' + edges.filter(function(e){return !e.reviewed;}).length + ' källkopplingar och ' + edges.filter(function(e){return e.reviewed;}).length + ' granskade samband.' : nodes.length + ' essäer, ' + edges.length + ' granskade samband. Välj en essä eller nod.';
      if (!fromHistory) updateUrl(true);
    }
    function buildInterface() {
      nodeLayer.innerHTML = '';
      list.innerHTML = '';
      bySlug = Object.create(null); nodeElements = Object.create(null); listElements = Object.create(null);
      nodes = networkData.artiklar.map(function (article, index) {
        return Object.assign({}, article, {r:14, x:0, y:0, vx:0, vy:0, index:index});
      });
      nodes.forEach(function (node) { bySlug[node.slug] = node; });
      edges = relations.map(function (edge) {
        return Object.assign({}, edge, {from:bySlug[edge.a], to:bySlug[edge.b]});
      });
      nodes.forEach(function (node) {
        var articleLink = editorialMode && node.kind === 'article';
        var graphButton = document.createElement(articleLink ? 'a' : 'button');
        if (articleLink) {
          graphButton.href = node.href;
          graphButton.target = '_top';
        } else graphButton.type = 'button';
        graphButton.className = 'nod';
        if (!articleLink) graphButton.setAttribute('aria-pressed', 'false');
        graphButton.setAttribute('aria-label', node.titel);
        graphButton.innerHTML = '<span class="nod-prick" aria-hidden="true"></span><span class="nod-etikett">' + escapeHtml(node.titel.length > 34 ? node.titel.slice(0, 33) + '…' : node.titel) + '</span>';
        if (sourceMode && node.source) {
          graphButton.classList.add('source-canonical-node');
          graphButton.dataset.source = node.slug;
          graphButton.style.setProperty('--source-dark', node.dark);
          graphButton.style.setProperty('--source-light', node.light);
          graphButton.querySelector('.nod-prick').textContent = node.glyph;
        }
        if (editorialMode) {
          graphButton.dataset.nodeKind = node.kind;
          graphButton.dataset.nodeKey = node.slug;
          if (node.kind === 'topic') {
            graphButton.querySelector('.nod-prick').textContent = node.glyph;
            graphButton.style.setProperty('--topic-light', node.light);
            graphButton.style.setProperty('--topic-dark', node.dark);
          }
        }
        if (!articleLink) graphButton.addEventListener('click', function (event) {
          selectNode(node, event.detail === 0);
          if (editorialMode && node.kind === 'topic') signalParent('editorialtopic', node.titel);
        });
        nodeLayer.appendChild(graphButton);
        nodeElements[node.slug] = graphButton;

        var item = document.createElement('li');
        var listButton = document.createElement('button');
        listButton.type = 'button';
        listButton.className = 'essa-knapp';
        listButton.innerHTML = '<span class="essa-id">' + escapeHtml(node.id) + '</span><span class="essa-titel">' + escapeHtml(node.titel) + '</span><span class="essa-amne">' + escapeHtml(node.amne.split(' ').slice(0, 4).join(' ')) + '</span><span class="essa-trafforsak" hidden></span>';
        listButton.addEventListener('click', function () { selectNode(node, false); });
        item.appendChild(listButton);
        list.appendChild(item);
        listElements[node.slug] = item;
      });
      listCount.textContent = String(nodes.length);
    }
    function place() {
      var radius = Math.min(size.width, size.height) * 0.36;
      nodes.forEach(function (node, index) {
        var angle = index / nodes.length * Math.PI * 2;
        node.x = size.width / 2 + Math.cos(angle) * radius;
        node.y = size.height / 2 + Math.sin(angle) * radius;
        node.vx = 0;
        node.vy = 0;
      });
    }
    function tick() {
      for (var i = 0; i < nodes.length; i += 1) {
        for (var j = i + 1; j < nodes.length; j += 1) {
          var a = nodes[i], b = nodes[j], dx = b.x - a.x, dy = b.y - a.y;
          var distance = Math.sqrt(dx * dx + dy * dy) || 1;
          var force = 7600 / (distance * distance);
          dx /= distance;
          dy /= distance;
          a.vx -= dx * force;
          a.vy -= dy * force;
          b.vx += dx * force;
          b.vy += dy * force;
        }
      }
      edges.forEach(function (edge) {
        var dx = edge.to.x - edge.from.x, dy = edge.to.y - edge.from.y;
        var distance = Math.sqrt(dx * dx + dy * dy) || 1;
        var force = (distance - 150) * 0.01;
        dx /= distance;
        dy /= distance;
        edge.from.vx += dx * force;
        edge.from.vy += dy * force;
        edge.to.vx -= dx * force;
        edge.to.vy -= dy * force;
      });
      nodes.forEach(function (node) {
        node.vx += (size.width / 2 - node.x) * 0.003;
        node.vy += (size.height / 2 - node.y) * 0.004;
        node.vx *= 0.82;
        node.vy *= 0.82;
        node.x = Math.max(26, Math.min(size.width - 26, node.x + node.vx));
        node.y = Math.max(26, Math.min(size.height - 105, node.y + node.vy));
      });
    }
    function motionAllowed() { return !chronicleMode() && !paused && !reducedMotion.matches && !document.hidden; }
    function flowing() { return motionAllowed() && search.active && search.links.size > 0; }
    function draw(time) {
      if (chronicleMode() || !size || (sourceMode && graph.closest('[hidden]'))) return;
      var moving = motionAllowed();
      offsetX = moving ? offsetX + (targetOffsetX - offsetX) * 0.13 : targetOffsetX;
      offsetY = moving ? offsetY + (targetOffsetY - offsetY) * 0.13 : targetOffsetY;
      function px(x){return size.width/2 + (x + offsetX - size.width/2) * scale + panX;}
      function py(y){return size.height/2 + (y + offsetY - size.height/2) * scale + panY;}
      var ratio = window.devicePixelRatio || 1;
      var context = canvas.getContext('2d');
      if (canvas.width !== Math.round(size.width * ratio) || canvas.height !== Math.round(size.height * ratio)) {
        canvas.width = Math.round(size.width * ratio);
        canvas.height = Math.round(size.height * ratio);
        canvas.style.width = size.width + 'px';
        canvas.style.height = size.height + 'px';
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, size.width, size.height);
      context.strokeStyle = accent;
      context.fillStyle = accent;
      context.lineWidth = 1.2;
      edges.forEach(function (edge, index) {
        var active = search.active ? search.links.has(index) : !selected || edge.a === selected || edge.b === selected;
        if (editorialMode) {
          var edgeMatches = (!sourceFiltering || sourceHits.has(edge.b)) && active;
          context.strokeStyle = document.documentElement.dataset.theme === 'light' ? edge.from.light : edge.from.dark;
          context.setLineDash(edge.from.dash);
          context.globalAlpha = edgeMatches ? .8 : .17;
          context.lineWidth = edgeMatches && selected ? 2.6 : 1.6;
        } else if (sourceMode) {
          var target = edge.to;
          context.strokeStyle = edge.reviewed ? color() : document.documentElement.dataset.theme === 'light' ? edge.light : edge.dark;
          context.setLineDash(edge.reviewed ? [3,3] : edge.dash);
          var dim = sourceFiltering && (!sourceHits.has(target.slug) || (edge.reviewed && !sourceHits.has(edge.from.slug)));
          context.globalAlpha = dim ? 0.22 : edge.reviewed ? 0.69 : 0.86;
          context.lineWidth = edge.reviewed ? 1.15 : sourceFiltering && sourceHits.has(target.slug) ? 2.6 : 1.7;
        } else context.globalAlpha = active ? 0.52 : 0.06;
        context.beginPath();
        context.moveTo(px(edge.from.x), py(edge.from.y));
        context.lineTo(px(edge.to.x), py(edge.to.y));
        context.stroke();
        if (embeddedMode) context.setLineDash([]);
        if (active && flowing()) {
          // Reverses smoothly: navigation aid, never a causal arrow or evidence weight.
          var progress = (1 - Math.cos((time || 0) / 8000 * Math.PI * 2)) / 2;
          context.globalAlpha = 0.65;
          context.beginPath();
          var dotX = edge.from.x + (edge.to.x - edge.from.x) * progress;
          var dotY = edge.from.y + (edge.to.y - edge.from.y) * progress;
          context.arc(editorialMode ? px(dotX) : dotX + offsetX, editorialMode ? py(dotY) : dotY + offsetY, 2.2, 0, Math.PI * 2);
          context.fill();
        }
      });
      context.globalAlpha = 1;
      nodes.forEach(function (node) {
        nodeElements[node.slug].style.transform = 'translate(' + (px(node.x) - 22) + 'px,' + (py(node.y) - 22) + 'px)';
        nodeElements[node.slug].style.setProperty('--label-offset', (Math.max(86, Math.min(size.width - 86, px(node.x))) - px(node.x)) + 'px');
      });
    }
    function startDrawing() {
      if (animation) cancelAnimationFrame(animation);
      animation = null;
      accent = color();
      graph.classList.toggle('sok-rorelse', motionAllowed() && search.active && search.matches.size > 0);
      motionButton.disabled = reducedMotion.matches;
      motionButton.setAttribute('aria-pressed', String(paused));
      motionButton.textContent = reducedMotion.matches ? 'Minskad rörelse aktiv' : paused ? 'Starta rörelse' : 'Pausa rörelse';
      function frame(time) {
        animation = null;
        draw(time);
        if (!document.hidden && (flowing() || Math.abs(targetOffsetX - offsetX) > 0.5 || Math.abs(targetOffsetY - offsetY) > 0.5)) animation = requestAnimationFrame(frame);
      }
      frame(performance.now());
    }
    function startLayout() {
      if (sourceMode && graph.closest('[hidden]')) return;
      if (animation) cancelAnimationFrame(animation);
      offsetX = targetOffsetX = 0;
      offsetY = targetOffsetY = 0;
      size = dimensions();
      place();
      // Settle before painting so layout never animates, including reduced motion.
      for (var i = 0; i < 210; i += 1) tick();
      if (selected && bySlug[selected] && !search.active) focusSelected(bySlug[selected]);
      startDrawing();
    }

    function clearQuery() {
      listSearch.value = '';
      renderList('');
      updateUrl(false);
      listSearch.focus({preventScroll:true});
    }
    function restoreUrl() {
      if (embeddedMode || !networkData || chronicleMode()) return;
      if (savedTerms) savedTerms.sync();
      listSearch.value = new URL(location.href).searchParams.get('q') || '';
      renderList(listSearch.value);
      var slug = '';
      try { slug = decodeURIComponent(location.hash.slice(1)); } catch (error) { /* Invalid fragment: no selection. */ }
      if (bySlug[slug]) selectNode(bySlug[slug], false, true);
      else clearSelection(true);
    }
    listSearch.addEventListener('input', function () { renderList(listSearch.value); updateUrl(false); });
    clearSearch.addEventListener('click', clearQuery);
    motionButton.addEventListener('click', function () { paused = !paused; startDrawing(); });
    reducedMotion.addEventListener('change', startDrawing);
    window.addEventListener('explorations:themechange', startDrawing);
    document.addEventListener('visibilitychange', startDrawing);
    window.addEventListener('explorations:networkview', function () {
      if (!chronicleMode() && networkData) { startLayout(); restoreUrl(); }
      else startDrawing();
    });
    window.addEventListener('popstate', restoreUrl);
    window.addEventListener('hashchange', restoreUrl);
    reset.addEventListener('click', function () { listSearch.value = ''; if (savedTerms) savedTerms.clear(); renderList(''); clearSelection(); startLayout(); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !chronicleMode() && (!sourceMode || (!graph.closest('[hidden]') && graph.closest('#sourceGraph').contains(event.target)))) {
        if (listSearch.value) {
          event.preventDefault();
          clearQuery();
        } else if (selected) {
          clearSelection();
          listSearch.focus({preventScroll:true});
        }
      }
    });
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(startLayout, 180);
    });

    function zoom(delta) { scale = Math.max(.6, Math.min(2.5, scale * delta)); startDrawing(); }
      document.getElementById('natverkZoomIn').addEventListener('click', function(){zoom(1.25);});
      document.getElementById('natverkZoomOut').addEventListener('click', function(){zoom(.8);});
      document.getElementById('natverkZoomReset').addEventListener('click', function(){
        scale = 1; panX = panY = 0; clearSelection(true); startLayout();
      });
      graph.addEventListener('pointerdown', function(event){
        if (event.button !== 0 || event.target.closest('button,a')) return;
        pointer = {id:event.pointerId,x:event.clientX,y:event.clientY};
        graph.setPointerCapture?.(event.pointerId);
      });
      graph.addEventListener('pointermove', function(event){
        if (!pointer || event.pointerId !== pointer.id) return;
        panX += event.clientX - pointer.x;
        panY += event.clientY - pointer.y;
        pointer.x = event.clientX; pointer.y = event.clientY;
        startDrawing();
      });
      ['pointerup','pointercancel','lostpointercapture'].forEach(function(type){
        graph.addEventListener(type, function(event){if(pointer && pointer.id===event.pointerId) pointer = null;});
      });
      graph.addEventListener('keydown', function(event){
        var arrows = {ArrowLeft:[-40,0],ArrowRight:[40,0],ArrowUp:[0,-40],ArrowDown:[0,40]};
        if(event.target !== graph || !arrows[event.key]) return;
        event.preventDefault(); panX += arrows[event.key][0]; panY += arrows[event.key][1]; startDrawing();
      });

    function applyNetworkProjection(data, links) {
      sourceFiltering = !!data.filtering;
      sourceHits = new Set(data.hits);
      networkData = {artiklar:data.nodes};
      relations = links;
      buildInterface();
      startLayout();
      renderList(listSearch.value);
      if (selected && bySlug[selected]) selectNode(bySlug[selected], false, true);
      else clearSelection(true);
    }

    if (editorialMode) {
      function articleHref(item) {
        var path = item.href;
        if (typeof path !== 'string') return '';
        if (/^timkronikan\/(?:inlagg|reportage)\/[a-z0-9][a-z0-9-]*\.html$/.test(path)) return root + path;
        // Older chronological records can have only their original anchored month page.
        var match = /^timkronikan\/(halvtimmen\/)?(20\d\d-(?:0[1-9]|1[0-2]))\.html#(inlagg|halvtimmen)-(20\d\d-\d\d-(?:0[1-9]|[12]\d|3[01]))-([01]\d|2[0-3])[0-5]\d$/.exec(path);
        if (!match || match[4].slice(0, 7) !== match[2]) return '';
        var half = !!match[1], series = item.series || ({Timmen:'timkronikan', 'Timkrönikan':'timkronikan', Halvtimmen:'halvtimmen'})[item.amne];
        if (series !== (half ? 'halvtimmen' : 'timkronikan') || match[3] !== (half ? 'halvtimmen' : 'inlagg')) return '';
        var date = new Date(match[4] + 'T00:00:00Z');
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[4] ? root + path : '';
      }
      function topicColor(value, fallback) {
        return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
      }
      function applyEditorial(data) {
        if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return;
        var records = [], byKey = new Map(), links = [], used = new Set();
        data.nodes.forEach(function (item) {
          if (!item || typeof item.slug !== 'string' || !item.slug || byKey.has(item.slug) ||
              typeof item.titel !== 'string' || !item.titel.trim()) return;
          var record = {slug:item.slug, titel:item.titel, kind:item.kind, datum:'', excerpt:'', nyckelord:[]};
          if (item.kind === 'topic') {
            record.id = 'Ämne'; record.amne = 'Publicerad ämnesetikett';
            record.picked = item.picked === true;
            record.glyph = typeof item.glyph === 'string' && item.glyph ? Array.from(item.glyph)[0] : '◆';
            record.dark = topicColor(item.dark, '#e8b665'); record.light = topicColor(item.light, '#785219');
            record.dash = Array.isArray(item.dash) && item.dash.every(function(n){return Number.isFinite(n) && n >= 0 && n <= 16;}) ? item.dash.slice(0, 6) : [];
          } else if (item.kind === 'article') {
            record.href = articleHref(item);
            if (!record.href) return;
            record.id = 'Text';
            record.amne = typeof item.amne === 'string' ? item.amne : 'Redaktionen';
            record.nyckelord = Array.isArray(item.nyckelord) ? item.nyckelord.filter(function(t){return typeof t === 'string' && !!t;}) : [];
            record.excerpt = typeof item.excerpt === 'string' ? item.excerpt : '';
            record.datum = typeof item.datum === 'string' ? item.datum : '';
          } else return;
          byKey.set(record.slug, record); records.push(record);
        });
        data.edges.forEach(function (edge) {
          if (!edge) return;
          var topic = byKey.get(edge.a), article = byKey.get(edge.b);
          if (!topic || !article || topic.kind !== 'topic' || article.kind !== 'article' || !article.nyckelord.includes(topic.titel)) return;
          var key = JSON.stringify([topic.slug, article.slug]);
          if (used.has(key)) return;
          used.add(key);
          links.push({a:topic.slug, b:article.slug, kind:'published-topic', label:'Publicerad ämnesetikett',
            reason:'”' + article.titel + '” har etiketten ”' + topic.titel + '”.'});
        });
        if (data.theme === 'light' || data.theme === 'dark') document.documentElement.dataset.theme = data.theme;
        var active = document.activeElement;
        var restoreNode = active && active.dataset.nodeKey;
        var restoreAction = active === topicAction;
        applyNetworkProjection({nodes:records, hits:Array.isArray(data.hits) ? data.hits : [], filtering:data.filtering}, links);
        if (restoreNode && nodeElements[restoreNode]) nodeElements[restoreNode].focus({preventScroll:true});
        else if (restoreAction && !topicAction.hidden) topicAction.focus({preventScroll:true});
      }
      graph.addEventListener('explorations:editorialgraph', function(event) { applyEditorial(event.detail); });
      graph.dataset.editorialReady = 'true';
      signalParent('editorialready');
      return;
    }
    if (sourceMode) {
      var sourcePayload = null, reviewed = [];
      function applySource(data) {
        var byHref = new Map(data.nodes.filter(function(node){return !node.source && node.href;}).map(function(node){return [node.href.replace(/#.*$/,''),node.slug];}));
        var reviewedEdges = reviewed.filter(function(edge){return byHref.has(root+edge.a+'/index.html') && byHref.has(root+edge.b+'/index.html');}).map(function(edge){
          return {a:byHref.get(root+edge.a+'/index.html'),b:byHref.get(root+edge.b+'/index.html'),reason:edge.reason,
            reviewed:true,label:'Granskat samband · '+TYPE_LABELS[edge.type]};
        });
        applyNetworkProjection(data, data.edges.concat(reviewedEdges));
        if (sourceAction && !sourceAction.hidden && data.fromAction) sourceAction.focus({preventScroll:true});
      }
      graph.addEventListener('explorations:sourcenetwork', function(event){
        sourcePayload = event.detail;
        applySource(sourcePayload);
      });
      // Load only the actual existing reviewed corpus, never infer a relationship from citations.
      // It is optional to source discovery; a validation error leaves the source edges intact.
      Promise.all([fetchJson('natverk-index.json'),fetchJson('relations-curated.json')]).then(function(data){
        var slugs = (data[0].artiklar || []).map(function(article){return article.slug;});
        var networkCheck = validateNetwork(data[0],slugs);
        var relationCheck = validateRelations(data[1],networkCheck.slugs || []);
        if(!networkCheck.valid || !relationCheck.valid || relationSignature(data[0]) !== relationSignature(data[1])) return;
        reviewed = data[1].relations;
        if(sourcePayload && !graph.closest('[hidden]')) applySource(Object.assign({},sourcePayload,{fromAction:false}));
      }).catch(function(){ /* citation lookup is still available */ });
      return;
    }
    Promise.all([fetchJson('natverk-index.json'), fetchJson('relations-curated.json')]).then(function (data) {
      var slugs = (data[0].artiklar || []).map(function (article) { return article.slug; });
      var networkCheck = validateNetwork(data[0], slugs);
      var relationCheck = validateRelations(data[1], networkCheck.slugs || []);
      if (!networkCheck.valid || !relationCheck.valid || relationSignature(data[0]) !== relationSignature(data[1])) throw new Error('Nätverksdata är inte aktuell');
      networkData = data[0];
      relations = data[1].relations;
      buildInterface();
      startLayout();
      restoreUrl();
    }).catch(function (error) {
      console.error('[Explorations]', error);
      status.textContent = 'Nätverket kunde inte laddas. Gå tillbaka till essäbiblioteket och försök igen.';
      graph.classList.add('natverk-fel');
    });
  });
})();
