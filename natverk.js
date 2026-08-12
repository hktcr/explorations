(function () {
  'use strict';

  var RELEASE = '20260812-network-5';
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

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      normalize:normalize,
      tokenize:tokenize,
      countMatches:countMatches,
      searchIndex:searchIndex,
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
    var nodeLayer = document.getElementById('natverkNoder');
    var canvas = document.getElementById('natverkKanter');
    var status = document.getElementById('natverkStatus');
    var reset = document.getElementById('natverkAterstall');
    var list = document.getElementById('essaLista');
    var listCount = document.getElementById('essaAntal');
    var listSearch = document.getElementById('essaSok');
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

    var networkData = null, relations = [], nodes = [], edges = [];
    var bySlug = {}, nodeElements = {}, listElements = {};
    var selected = null, animation = null, resizeTimer = null;
    var offsetX = 0, offsetY = 0, targetOffsetX = 0, targetOffsetY = 0;

    function fetchJson(path) {
      return fetch(root + path + '?v=' + encodeURIComponent(RELEASE)).then(function (response) {
        if (!response.ok) throw new Error(path + ': ' + response.status);
        return response.json();
      });
    }
    function dimensions() {
      var rectangle = nodeLayer.getBoundingClientRect();
      return {width:Math.max(300, rectangle.width), height:Math.max(360, rectangle.height)};
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
    function updateHash(slug) {
      var next = slug ? '#' + encodeURIComponent(slug) : location.pathname + location.search;
      history.replaceState(null, '', next);
    }
    function renderList(filter) {
      var terms = tokenize(filter);
      var visible = 0;
      nodes.forEach(function (node) {
        var haystack = normalize(node.titel + ' ' + node.amne + ' ' + node.id);
        var show = terms.every(function (term) { return haystack.indexOf(term) !== -1; });
        listElements[node.slug].hidden = !show;
        if (show) visible += 1;
      });
      listCount.textContent = String(visible);
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
      panelRead.href = root + node.slug + '/index.html';
      panelRead.setAttribute('aria-label', 'Läs essän ' + node.titel);
      panelRelations.innerHTML = '';
      related.forEach(function (item) {
        var row = document.createElement('li');
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'relationspanel-valj';
        button.innerHTML = '<span class="relationspanel-relationstyp">' + escapeHtml(TYPE_LABELS[item.edge.type]) + '</span>'
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
    }
    function selectNode(node, focusPanel) {
      selected = node.slug;
      var neighbors = {};
      relationsFor(node.slug).forEach(function (item) { neighbors[item.node.slug] = true; });
      Object.keys(nodeElements).forEach(function (slug) {
        var current = slug === selected;
        nodeElements[slug].classList.toggle('nod-vald', current);
        nodeElements[slug].classList.toggle('nod-granne', !!neighbors[slug]);
        nodeElements[slug].classList.toggle('svag', !current && !neighbors[slug]);
        nodeElements[slug].setAttribute('aria-pressed', current ? 'true' : 'false');
        listElements[slug].classList.toggle('essa-vald', current);
        listElements[slug].setAttribute('aria-current', current ? 'true' : 'false');
      });
      renderPanel(node);
      focusSelected(node);
      listElements[node.slug].scrollIntoView({block:'nearest', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
      status.textContent = node.titel + ' vald. ' + relationsFor(node.slug).length + ' granskade samband visas.';
      updateHash(node.slug);
      startDrawing();
      if (focusPanel && panelTitle) panelTitle.focus({preventScroll:true});
    }
    function clearSelection() {
      selected = null;
      targetOffsetX = 0;
      targetOffsetY = 0;
      Object.keys(nodeElements).forEach(function (slug) {
        nodeElements[slug].classList.remove('nod-vald', 'nod-granne', 'svag');
        nodeElements[slug].setAttribute('aria-pressed', 'false');
        listElements[slug].classList.remove('essa-vald');
        listElements[slug].removeAttribute('aria-current');
      });
      panelEmpty.hidden = false;
      panelContent.hidden = true;
      status.textContent = nodes.length + ' essäer, ' + edges.length + ' granskade samband. Välj en essä eller nod.';
      updateHash('');
      startDrawing();
    }
    function buildInterface() {
      nodeLayer.innerHTML = '';
      list.innerHTML = '';
      nodes = networkData.artiklar.map(function (article, index) {
        return Object.assign({}, article, {r:14, x:0, y:0, vx:0, vy:0, index:index});
      });
      nodes.forEach(function (node) { bySlug[node.slug] = node; });
      edges = relations.map(function (edge) {
        return Object.assign({}, edge, {from:bySlug[edge.a], to:bySlug[edge.b]});
      });
      nodes.forEach(function (node) {
        var graphButton = document.createElement('button');
        graphButton.type = 'button';
        graphButton.className = 'nod';
        graphButton.setAttribute('aria-pressed', 'false');
        graphButton.setAttribute('aria-label', node.titel);
        graphButton.innerHTML = '<span class="nod-prick" aria-hidden="true"></span><span class="nod-etikett">' + escapeHtml(node.titel.length > 34 ? node.titel.slice(0, 33) + '…' : node.titel) + '</span>';
        graphButton.addEventListener('click', function (event) { selectNode(node, event.detail === 0); });
        nodeLayer.appendChild(graphButton);
        nodeElements[node.slug] = graphButton;

        var item = document.createElement('li');
        var listButton = document.createElement('button');
        listButton.type = 'button';
        listButton.className = 'essa-knapp';
        listButton.innerHTML = '<span class="essa-id">' + escapeHtml(node.id) + '</span><span class="essa-titel">' + escapeHtml(node.titel) + '</span><span class="essa-amne">' + escapeHtml(node.amne.split(' ').slice(0, 4).join(' ')) + '</span>';
        listButton.addEventListener('click', function () { selectNode(node, false); });
        item.appendChild(listButton);
        list.appendChild(item);
        listElements[node.slug] = item;
      });
      listCount.textContent = String(nodes.length);
    }
    function place() {
      var size = dimensions();
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
      var size = dimensions();
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
        node.y = Math.max(26, Math.min(size.height - 46, node.y + node.vy));
      });
    }
    function draw() {
      if (!nodes.length) return;
      offsetX += (targetOffsetX - offsetX) * 0.13;
      offsetY += (targetOffsetY - offsetY) * 0.13;
      var size = dimensions(), ratio = window.devicePixelRatio || 1;
      var context = canvas.getContext('2d');
      canvas.width = Math.round(size.width * ratio);
      canvas.height = Math.round(size.height * ratio);
      canvas.style.width = size.width + 'px';
      canvas.style.height = size.height + 'px';
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, size.width, size.height);
      context.strokeStyle = color();
      context.lineWidth = 1.2;
      edges.forEach(function (edge) {
        var active = !selected || edge.a === selected || edge.b === selected;
        context.globalAlpha = active ? 0.52 : 0.06;
        context.beginPath();
        context.moveTo(edge.from.x + offsetX, edge.from.y + offsetY);
        context.lineTo(edge.to.x + offsetX, edge.to.y + offsetY);
        context.stroke();
      });
      context.globalAlpha = 1;
      nodes.forEach(function (node) {
        nodeElements[node.slug].style.transform = 'translate(' + (node.x + offsetX - 22) + 'px,' + (node.y + offsetY - 22) + 'px)';
      });
    }
    function startDrawing() {
      if (animation) cancelAnimationFrame(animation);
      var frames = 0;
      function frame() {
        draw();
        frames += 1;
        if (frames < 70 || Math.abs(targetOffsetX - offsetX) > 0.5 || Math.abs(targetOffsetY - offsetY) > 0.5) animation = requestAnimationFrame(frame);
      }
      frame();
    }
    function startLayout() {
      if (animation) cancelAnimationFrame(animation);
      offsetX = targetOffsetX = 0;
      offsetY = targetOffsetY = 0;
      place();
      var steps = 0;
      function frame() {
        for (var i = 0; i < 3; i += 1) tick();
        draw();
        steps += 3;
        if (steps < 210) animation = requestAnimationFrame(frame);
        else if (selected) focusSelected(bySlug[selected]);
      }
      frame();
    }

    listSearch.addEventListener('input', function () { renderList(listSearch.value); });
    reset.addEventListener('click', function () { clearSelection(); startLayout(); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (listSearch.value) {
          listSearch.value = '';
          renderList('');
          listSearch.focus();
        } else if (selected) clearSelection();
      }
    });
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(startLayout, 180);
    });

    Promise.all([fetchJson('natverk-index.json'), fetchJson('relations-curated.json')]).then(function (data) {
      var slugs = (data[0].artiklar || []).map(function (article) { return article.slug; });
      var networkCheck = validateNetwork(data[0], slugs);
      var relationCheck = validateRelations(data[1], networkCheck.slugs || []);
      if (!networkCheck.valid || !relationCheck.valid || relationSignature(data[0]) !== relationSignature(data[1])) throw new Error('Nätverksdata är inte aktuell');
      networkData = data[0];
      relations = data[1].relations;
      buildInterface();
      startLayout();
      status.textContent = nodes.length + ' essäer, ' + edges.length + ' granskade samband. Välj en essä eller nod.';
      var initial = decodeURIComponent(location.hash.slice(1));
      if (initial && bySlug[initial]) {
        setTimeout(function () { selectNode(bySlug[initial], false); }, 80);
      }
    }).catch(function (error) {
      console.error('[Explorations]', error);
      status.textContent = 'Nätverket kunde inte laddas. Gå tillbaka till essäbiblioteket och försök igen.';
      graph.classList.add('natverk-fel');
    });
  });
})();
