(function () {
  'use strict';
  var RELEASE = '20260814-network-6';
  var MIN_CHARS = 2;

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
  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (character) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];
    });
  }
  function excerpt(text, terms) {
    var plain = String(text || '').replace(/\s+/g, ' ').trim();
    var lower = normalize(plain), first = -1;
    terms.forEach(function (term) { var at = lower.indexOf(term); if (at !== -1 && (first === -1 || at < first)) first = at; });
    var start = Math.max(0, first - 90), sample = plain.slice(start, start + 260);
    if (start) sample = '…' + sample;
    if (start + 260 < plain.length) sample += '…';
    var safe = escapeHtml(sample);
    terms.sort(function (a, b) { return b.length - a.length; }).forEach(function (term) {
      safe = safe.replace(new RegExp('(' + term + ')', 'giu'), '<mark>$1</mark>');
    });
    return safe;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var input = document.getElementById('searchInput');
    var grid = document.getElementById('articlesGrid');
    var resultsBox = document.getElementById('traffar');
    var status = document.getElementById('natverkStatus');
    if (!input || !grid || !resultsBox || !status) return;
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.article-card'));
    var searchData = null, searchPromise = null, searchBroken = false, timer;

    function show(element, visible) { element.classList.toggle('dold', !visible); }
    function readState() {
      var api = window.explorationsReadFilter;
      return api && api.getState ? api.getState() : {hideRead:false, slugs:[]};
    }
    function hiddenAsRead(slug) {
      var state = readState();
      return !!(state.hideRead && state.slugs.indexOf(slug) !== -1);
    }
    function loadSearch() {
      if (searchData) return Promise.resolve(searchData);
      if (searchPromise) return searchPromise;
      searchPromise = fetch('sok-index.json?v=' + encodeURIComponent(RELEASE)).then(function (response) {
        if (!response.ok) throw new Error('Sökindex: ' + response.status);
        return response.json();
      }).then(function (data) {
        if (data.schemaVersion !== 2 || data.releaseId !== RELEASE || !Array.isArray(data.artiklar)) throw new Error('Ogiltigt sökindex');
        searchData = data;
        return data;
      }).catch(function (error) {
        searchBroken = true;
        searchPromise = null;
        throw error;
      });
      return searchPromise;
    }
    function applyReadFilter() {
      var visible = 0;
      cards.forEach(function (card) {
        var slug = (card.getAttribute('href') || '').split('/')[0];
        var display = !hiddenAsRead(slug);
        card.classList.toggle('dold', !display);
        card.hidden = !display;
        if (display) visible += 1;
      });
      var empty = grid.querySelector('.no-results');
      if (!visible && !empty) {
        empty = document.createElement('p');
        empty.className = 'no-results';
        empty.textContent = 'Alla essäer är markerade som lästa.';
        grid.appendChild(empty);
      } else if (visible && empty) empty.remove();
    }
    function resetSearch() {
      resultsBox.innerHTML = '';
      show(resultsBox, false);
      show(grid, true);
      applyReadFilter();
      status.textContent = '29 essäer, 41 granskade samband.';
    }
    function renderResults(results) {
      results = results.filter(function (result) { return !hiddenAsRead(result.slug); });
      show(grid, false);
      show(resultsBox, true);
      if (!results.length) {
        resultsBox.innerHTML = '<p class="ingen-traff">Ingen essä innehåller alla sökorden.</p>';
        status.textContent = 'Ingen träff.';
        return;
      }
      resultsBox.innerHTML = results.map(function (result) {
        return '<article class="traff"><a class="traff-titel" href="' + escapeHtml(result.slug) + '/index.html">' + escapeHtml(result.titel) + '</a>'
          + '<span class="traff-amne">' + escapeHtml(result.amne) + '</span><ul class="traff-avsnitt">'
          + result.avsnitt.map(function (section) {
            return '<li><a href="' + escapeHtml(result.slug) + '/index.html' + (section.ankare ? '#' + escapeHtml(section.ankare) : '') + '">'
              + '<span class="traff-rubrik">' + escapeHtml(section.rubrik || 'Ingress') + '</span>'
              + '<span class="traff-utdrag">' + excerpt(section.text, result.termer.slice()) + '</span></a></li>';
          }).join('') + '</ul></article>';
      }).join('');
      status.textContent = results.length + (results.length === 1 ? ' essä träffad.' : ' essäer träffade.');
    }
    function fallbackSearch(query) {
      var terms = tokenize(query), visible = 0;
      show(resultsBox, false);
      show(grid, true);
      cards.forEach(function (card) {
        var slug = (card.getAttribute('href') || '').split('/')[0];
        var haystack = normalize((card.dataset.title || '') + ' ' + (card.dataset.subject || '') + ' ' + (card.dataset.excerpt || ''));
        var display = terms.length && terms.every(function (term) { return haystack.indexOf(term) !== -1; }) && !hiddenAsRead(slug);
        card.classList.toggle('dold', !display);
        card.hidden = !display;
        if (display) visible += 1;
      });
      status.textContent = visible + ' kort träffade. Fulltextsökningen är inte tillgänglig.';
    }
    function runSearch() {
      var query = input.value;
      if (query.trim().length < MIN_CHARS) { resetSearch(); return; }
      if (searchBroken) { fallbackSearch(query); return; }
      loadSearch().then(function (data) {
        if (input.value === query) renderResults(searchIndex(data, query));
      }).catch(function () {
        if (input.value === query) fallbackSearch(query);
      });
    }

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(runSearch, 120);
    });
    input.addEventListener('focus', function () { loadSearch().catch(function () {}); });
    document.addEventListener('explorations:read-filter-change', function () {
      if (input.value.trim().length >= MIN_CHARS) runSearch();
      else applyReadFilter();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && input.value) {
        input.value = '';
        resetSearch();
        input.focus();
      }
    });
    resetSearch();
  });
})();
