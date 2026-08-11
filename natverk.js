/* Explorations: fulltext search and reviewed relationship network. */
(function () {
  'use strict';

  var RELEASE = '20260811-network-2';
  var MIN_CHARS = 2;
  var TYPE_LABELS = {
    'same-phenomenon': 'Samma fenomen', mechanism: 'Mekanism', prerequisite: 'Förutsättning',
    'method-evidence': 'Metod eller evidens', application: 'Tillämpning', contrast: 'Kontrast', analogy: 'Analogi'
  };
  var unicodeLetter = null;
  try { unicodeLetter = new RegExp('[\\p{L}\\p{M}]', 'u'); } catch (error) { /* Old engine fallback below. */ }

  function normalize(value) {
    value = String(value == null ? '' : value);
    if (value.normalize) value = value.normalize('NFC');
    return value.toLowerCase();
  }

  function isLetter(character) {
    if (!character) return false;
    return unicodeLetter ? unicodeLetter.test(character) : /[A-Za-z\u00C0-\u02AF\u0300-\u036F]/.test(character);
  }

  function tokenize(value) {
    var result = [], current = '', characters = Array.from ? Array.from(normalize(value)) : normalize(value).split('');
    characters.forEach(function (character) {
      if (isLetter(character)) current += character;
      else if (current) { result.push(current); current = ''; }
    });
    if (current) result.push(current);
    return result;
  }

  function countMatches(text, term, limit) {
    var haystack = normalize(text), needle = normalize(term), count = 0, position = haystack.indexOf(needle);
    while (needle && position !== -1) {
      if (position === 0 || !isLetter(haystack[position - 1])) {
        count++;
        if (limit && count >= limit) return count;
      }
      position = haystack.indexOf(needle, position + 1);
    }
    return count;
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function excerpt(text, terms) {
    var lower = normalize(text), first = -1;
    terms.forEach(function (term) { var pos = lower.indexOf(term); if (pos !== -1 && (first === -1 || pos < first)) first = pos; });
    if (first < 0) first = 0;
    var start = Math.max(0, first - 70), end = Math.min(text.length, first + 150);
    while (start > 0 && isLetter(text[start - 1])) start--;
    while (end < text.length && isLetter(text[end])) end++;
    var slice = text.slice(start, end), escaped = escapeHtml(slice);
    terms.slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (term) {
      var safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      escaped = escaped.replace(new RegExp('(' + safe + ')', 'gi'), '<mark>$1</mark>');
    });
    return (start ? '… ' : '') + escaped + (end < text.length ? ' …' : '');
  }

  function searchIndex(data, query) {
    var terms = tokenize(query.trim());
    if (query.trim().length < MIN_CHARS || !terms.length) return [];
    var results = [];
    (data.artiklar || []).forEach(function (article) {
      var score = 0, found = {};
      terms.forEach(function (term) {
        if (countMatches(article.titel, term, 1)) { score += 12; found[term] = true; }
        if (countMatches(article.amne, term, 1)) { score += 8; found[term] = true; }
      });
      var sections = [];
      (article.avsnitt || []).forEach(function (section) {
        var sectionScore = 0;
        terms.forEach(function (term) {
          var heading = countMatches(section.rubrik, term, 1), body = countMatches(section.text, term, 5);
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
    results.sort(function (a, b) { return b.score - a.score; });
    return results;
  }

  function unique(values) {
    var seen = {}, result = [];
    (values || []).forEach(function (value) { value = String(value || '').trim(); if (value && !seen[value]) { seen[value] = true; result.push(value); } });
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
    data.artiklar.forEach(function (article) { if (!article.slug || seen[article.slug]) errors.push('Ogiltig nod'); else seen[article.slug] = true; });
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
      pairs[pair] = true; degree[relation.a] = (degree[relation.a] || 0) + 1; degree[relation.b] = (degree[relation.b] || 0) + 1;
    });
    Object.keys(degree).forEach(function (slug) { if (degree[slug] > 5) errors.push('För många relationer: ' + slug); });
    return {valid:!errors.length, errors:errors};
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {normalize:normalize, tokenize:tokenize, countMatches:countMatches, searchIndex:searchIndex, validateNetwork:validateNetwork, validateRelations:validateRelations, relationSignature:relationSignature, RELEASE:RELEASE};
  }
  if (typeof document === 'undefined') return;

  document.addEventListener('DOMContentLoaded', function () {
    var input = document.getElementById('searchInput'), grid = document.getElementById('articlesGrid');
    var graph = document.getElementById('natverk'), nodeLayer = document.getElementById('natverkNoder'), canvas = document.getElementById('natverkKanter');
    var status = document.getElementById('natverkStatus'), toggle = document.getElementById('natverkVaxel'), legend = document.getElementById('natverkLegend');
    var resultsBox = document.getElementById('traffar'), panel = document.getElementById('relationspanel');
    var panelTitle = document.getElementById('relationspanelTitel'), panelSubject = document.getElementById('relationspanelAmne');
    var panelMeta = document.getElementById('relationspanelMeta'), panelExcerpt = document.getElementById('relationspanelIngress');
    var panelKeywords = document.getElementById('relationspanelNyckelord'), panelList = document.getElementById('relationspanelLista');
    var panelRead = document.getElementById('relationspanelLas'), panelEmpty = document.getElementById('relationspanelTom');
    var panelContent = document.getElementById('relationspanelInnehall'), panelBack = document.getElementById('relationspanelTillbaka');
    if (!input || !grid || !graph || !nodeLayer || !canvas || !status || !resultsBox) return;

    var networkData = null, relations = [], searchData = null, searchPromise = null, searchBroken = false;
    var nodes = [], edges = [], nodeElements = {}, selected = null, animation = null, rawResults = [];
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.article-card'));
    var cardSlugs = cards.map(function (card) { return (card.getAttribute('href') || '').replace(/\/index\.html$/, ''); });

    function show(element, visible) { element.classList.toggle('dold', !visible); }
    function readState() { var api = window.explorationsReadFilter; return api && api.getState ? api.getState() : {hideRead:false, slugs:[]}; }
    function hiddenAsRead(slug) { var state = readState(); return !!(state.hideRead && state.slugs.indexOf(slug) !== -1); }
    function color() { return getComputedStyle(document.documentElement).getPropertyValue('--network-accent').trim() || '#c0392b'; }

    function fetchJson(path) { return fetch(path + '?v=' + encodeURIComponent(RELEASE)).then(function (response) { if (!response.ok) throw new Error(path + ': ' + response.status); return response.json(); }); }
    function loadSearch() {
      if (searchData) return Promise.resolve(searchData);
      if (searchPromise) return searchPromise;
      searchPromise = fetchJson('sok-index.json').then(function (data) {
        if (data.schemaVersion !== 2 || data.releaseId !== RELEASE || !Array.isArray(data.artiklar)) throw new Error('Ogiltigt sökindex');
        if (networkData && data.contentHash !== networkData.contentHash) throw new Error('Indexhash skiljer sig');
        searchData = data; return data;
      }).catch(function (error) { searchBroken = true; searchPromise = null; throw error; });
      return searchPromise;
    }

    function relationsFor(slug) {
      return edges.filter(function (edge) { return edge.a === slug || edge.b === slug; }).map(function (edge) {
        return {edge:edge, node:nodes.filter(function (node) { return node.slug === (edge.a === slug ? edge.b : edge.a); })[0]};
      }).filter(function (item) { return item.node; });
    }

    function resetPanel() { if (!panel) return; panel.hidden = false; panelEmpty.hidden = false; panelContent.hidden = true; panelList.innerHTML = ''; }
    function renderPanel(node) {
      if (!panel) return;
      var card = grid.querySelector('.article-card[href="' + node.slug + '/index.html"]'), related = relationsFor(node.slug);
      panel.hidden = false; panelEmpty.hidden = true; panelContent.hidden = false;
      panelTitle.textContent = node.titel; panelSubject.textContent = node.amne;
      panelMeta.textContent = [node.lastid, node.datum].filter(Boolean).join(' · ');
      panelExcerpt.textContent = card ? card.getAttribute('data-excerpt') || '' : '';
      panelKeywords.textContent = (node.nyckelord || []).join(', ');
      panelRead.href = node.slug + '/index.html'; panelRead.setAttribute('aria-label', 'Läs essän ' + node.titel);
      panelList.innerHTML = '';
      if (!related.length) { var empty = document.createElement('li'); empty.className = 'relationspanel-utan-relationer'; empty.textContent = 'Den här essän har ännu inga granskade samband.'; panelList.appendChild(empty); }
      related.forEach(function (item) {
        var li = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.className = 'relationspanel-valj';
        button.innerHTML = '<span class="relationspanel-relationstyp">' + escapeHtml(TYPE_LABELS[item.edge.type]) + '</span>'
          + '<span class="relationspanel-relationstitel">' + escapeHtml(item.node.titel) + '</span>'
          + '<span class="relationspanel-orsak">' + escapeHtml(item.edge.reason) + '</span>'
          + '<span class="relationspanel-termer">Begrepp: ' + escapeHtml(item.edge.terms.join(', ')) + '</span>';
        button.addEventListener('click', function () { selectNode(item.node, false); nodeElements[item.node.slug].focus(); });
        li.appendChild(button); panelList.appendChild(li);
      });
    }

    function selectNode(node, keyboard) {
      selected = node.slug; var neighbors = {};
      relationsFor(node.slug).forEach(function (item) { neighbors[item.node.slug] = true; });
      Object.keys(nodeElements).forEach(function (slug) {
        var element = nodeElements[slug], current = slug === node.slug;
        element.classList.toggle('nod-vald', current); element.classList.toggle('nod-granne', !!neighbors[slug]);
        element.classList.toggle('svag', !current && !neighbors[slug]); element.setAttribute('aria-pressed', current ? 'true' : 'false');
      });
      renderPanel(node); status.textContent = node.titel + ' vald. ' + relationsFor(node.slug).length + ' granskade samband visas.'; draw();
      if (keyboard && panelTitle) panelTitle.focus();
    }

    function clearSelection() {
      selected = null; Object.keys(nodeElements).forEach(function (slug) { var element = nodeElements[slug]; element.classList.remove('nod-vald', 'nod-granne', 'svag'); element.setAttribute('aria-pressed', 'false'); });
      resetPanel(); draw();
    }

    function buildGraph() {
      nodeLayer.innerHTML = ''; nodeElements = {};
      nodes = networkData.artiklar.map(function (article, index) { return {slug:article.slug, titel:article.titel, amne:article.amne, datum:article.datum, lastid:article.lastid, nyckelord:article.nyckelord || [], r:14, x:0, y:0, vx:0, vy:0, index:index}; });
      var bySlug = {}; nodes.forEach(function (node) { bySlug[node.slug] = node; });
      edges = relations.map(function (edge) { return {a:edge.a, b:edge.b, type:edge.type, reason:edge.reason, terms:edge.terms, from:bySlug[edge.a], to:bySlug[edge.b]}; });
      nodes.forEach(function (node) {
        var button = document.createElement('button'); button.type = 'button'; button.className = 'nod'; button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', node.titel);
        button.innerHTML = '<span class="nod-prick" aria-hidden="true"></span><span class="nod-etikett">' + escapeHtml(node.titel.length > 31 ? node.titel.slice(0, 30) + '…' : node.titel) + '</span>';
        button.addEventListener('click', function (event) { selectNode(node, event.detail === 0); });
        nodeLayer.appendChild(button); nodeElements[node.slug] = button;
      });
    }

    function dimensions() { var rect = nodeLayer.getBoundingClientRect(); return {width:Math.max(280, rect.width), height:Math.max(320, rect.height)}; }
    function place() {
      var size = dimensions(), radius = Math.min(size.width, size.height) * 0.34;
      nodes.forEach(function (node, index) { var angle = index / nodes.length * Math.PI * 2; node.x = size.width / 2 + Math.cos(angle) * radius; node.y = size.height / 2 + Math.sin(angle) * radius; node.vx = node.vy = 0; });
    }
    function tick() {
      var size = dimensions();
      for (var i = 0; i < nodes.length; i++) for (var j = i + 1; j < nodes.length; j++) {
        var a = nodes[i], b = nodes[j], dx = b.x-a.x, dy = b.y-a.y, distance = Math.sqrt(dx*dx+dy*dy)||1, force = 7000/(distance*distance); dx/=distance; dy/=distance; a.vx-=dx*force; a.vy-=dy*force; b.vx+=dx*force; b.vy+=dy*force;
      }
      edges.forEach(function (edge) { var dx=edge.to.x-edge.from.x, dy=edge.to.y-edge.from.y, distance=Math.sqrt(dx*dx+dy*dy)||1, force=(distance-145)*0.01; dx/=distance; dy/=distance; edge.from.vx+=dx*force; edge.from.vy+=dy*force; edge.to.vx-=dx*force; edge.to.vy-=dy*force; });
      nodes.forEach(function (node) { node.vx+=(size.width/2-node.x)*0.003; node.vy+=(size.height/2-node.y)*0.004; node.vx*=0.82; node.vy*=0.82; node.x=Math.max(22,Math.min(size.width-22,node.x+node.vx)); node.y=Math.max(22,Math.min(size.height-38,node.y+node.vy)); });
    }
    function draw() {
      if (!nodes.length || !graph.getClientRects().length) return;
      var size=dimensions(), ratio=window.devicePixelRatio||1, context=canvas.getContext('2d'); canvas.width=Math.round(size.width*ratio); canvas.height=Math.round(size.height*ratio); canvas.style.width=size.width+'px'; canvas.style.height=size.height+'px'; context.setTransform(ratio,0,0,ratio,0,0); context.clearRect(0,0,size.width,size.height);
      context.strokeStyle=color(); context.lineWidth=1;
      edges.forEach(function (edge) { var active=!selected||edge.a===selected||edge.b===selected; context.globalAlpha=active?0.45:0.07; context.beginPath(); context.moveTo(edge.from.x,edge.from.y); context.lineTo(edge.to.x,edge.to.y); context.stroke(); }); context.globalAlpha=1;
      nodes.forEach(function (node) { nodeElements[node.slug].style.transform='translate('+(node.x-22)+'px,'+(node.y-22)+'px)'; });
    }
    function startLayout() { if (!nodes.length || !graph.getClientRects().length) return; if (animation) cancelAnimationFrame(animation); place(); var steps=0; function frame(){ for(var i=0;i<3;i++)tick(); draw(); steps+=3; if(steps<180)animation=requestAnimationFrame(frame); } frame(); }

    function applyReadFilterToCards() {
      var visible=0; cards.forEach(function (card) { var slug=(card.getAttribute('href')||'').replace(/\/index\.html$/,''); var showCard=!hiddenAsRead(slug); card.classList.toggle('dold',!showCard); card.hidden=!showCard; if(showCard)visible++; });
      var empty=grid.querySelector('.no-results'); if(!visible&&!empty){empty=document.createElement('p');empty.className='no-results';empty.textContent='Alla artiklar är markerade som lästa.';grid.appendChild(empty);} else if(visible&&empty)empty.remove();
    }
    function resetSearch() { rawResults=[]; resultsBox.innerHTML=''; show(resultsBox,false); show(grid,true); applyReadFilterToCards(); clearSelection(); status.textContent=nodes.length+' essäer, '+edges.length+' granskade samband. Välj en nod för att utforska.'; }
    function renderResults(results) {
      clearSelection(); results=results.filter(function (result) { return !hiddenAsRead(result.slug); }); rawResults=results; show(grid,false); show(resultsBox,true);
      Object.keys(nodeElements).forEach(function(slug){nodeElements[slug].classList.toggle('svag',!results.some(function(result){return result.slug===slug;}));});
      if(!results.length){resultsBox.innerHTML='<p class="ingen-traff">'+(readState().hideRead?'Ingen oläst essä innehåller alla sökorden.':'Ingen essä innehåller alla sökorden.')+'</p>';status.textContent='Ingen träff.';draw();return;}
      resultsBox.innerHTML=results.map(function(result){return '<article class="traff" data-slug="'+escapeHtml(result.slug)+'"><a class="traff-titel" href="'+escapeHtml(result.slug)+'/index.html">'+escapeHtml(result.titel)+'</a><span class="traff-amne">'+escapeHtml(result.amne)+'</span><ul class="traff-avsnitt">'+result.avsnitt.map(function(section){return '<li><a href="'+escapeHtml(result.slug)+'/index.html'+(section.ankare?'#'+escapeHtml(section.ankare):'')+'"><span class="traff-rubrik">'+escapeHtml(section.rubrik||'Ingress')+'</span><span class="traff-utdrag">'+excerpt(section.text,result.termer)+'</span></a></li>';}).join('')+'</ul></article>';}).join('');
      status.textContent=results.length+(results.length===1?' essä träffad.':' essäer träffade.');draw();
    }
    function fallbackSearch(query){var terms=tokenize(query),visible=0;clearSelection();show(resultsBox,false);show(grid,true);cards.forEach(function(card){var slug=(card.getAttribute('href')||'').replace(/\/index\.html$/,'');var hay=normalize((card.dataset.title||'')+' '+(card.dataset.subject||'')+' '+(card.dataset.excerpt||''));var match=terms.length&&terms.every(function(term){return hay.indexOf(term)!==-1;})&&!hiddenAsRead(slug);card.classList.toggle('dold',!match);card.hidden=!match;if(match)visible++;});status.textContent=visible+' kort träffade. Fulltextsökningen är inte tillgänglig.';}
    function runSearch(){var query=input.value;if(query.trim().length<MIN_CHARS){resetSearch();return;}if(searchBroken){fallbackSearch(query);return;}loadSearch().then(function(data){if(input.value===query)renderResults(searchIndex(data,query));}).catch(function(){if(input.value===query)fallbackSearch(query);});}

    var timer; input.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(runSearch,120);}); input.addEventListener('focus',function(){loadSearch().catch(function(){});});
    document.addEventListener('explorations:read-filter-change',function(){if(input.value.trim().length>=MIN_CHARS)runSearch();else applyReadFilterToCards();});
    document.addEventListener('keydown',function(event){if(event.key==='Escape'){if(selected)clearSelection();else if(input.value){input.value='';resetSearch();}}});
    if(panelBack)panelBack.addEventListener('click',function(){if(selected&&nodeElements[selected])nodeElements[selected].focus();});
    if(toggle)toggle.addEventListener('click',function(){var active=document.body.classList.toggle('visa-natverk');toggle.setAttribute('aria-pressed',String(active));toggle.textContent=active?'Dölj nätverk':'Visa nätverk';if(active)startLayout();});
    var resizeTimer; window.addEventListener('resize',function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(startLayout,180);});

    Promise.all([fetchJson('natverk-index.json'),fetchJson('relations-curated.json')]).then(function(data){
      var networkCheck=validateNetwork(data[0],cardSlugs), relationCheck=validateRelations(data[1],networkCheck.slugs||[]);
      if(!networkCheck.valid||!relationCheck.valid||relationSignature(data[0])!==relationSignature(data[1]))throw new Error('Nätverksdata är inte aktuell');
      networkData=data[0];relations=data[1].relations;if(searchData&&searchData.contentHash!==networkData.contentHash)throw new Error('Indexhash skiljer sig');
      graph.hidden=false;buildGraph();resetSearch();if(graph.getClientRects().length)startLayout();
    }).catch(function(error){console.error('[Explorations]',error);graph.hidden=true;if(toggle)toggle.hidden=true;if(panel)panel.hidden=true;if(legend)legend.classList.add('dold');status.textContent='Nätverket kunde inte laddas. Kortvyn och sökningen fungerar fortfarande.';});
  });
})();
