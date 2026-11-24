/* Plot the very same indexed articles and hits used by the editorial directory. */
(() => {
  'use strict';
  const pageSize = 8;
  const palette = [
    ['#ffc062','#684207','◆',[]], ['#87d5ff','#165274','●',[6,3]],
    ['#c7a5ff','#64477d','▲',[3,3]], ['#82dbc2','#225c4a','■',[7,3,2,3]],
    ['#ffa7af','#793d4a','✦',[2,3]], ['#cadb7d','#485b1d','✚',[9,3]],
    ['#e9acdf','#73396c','⬟',[3,3,7,3]], ['#95bfff','#35567c','⬢',[6,2]]
  ];
  function labelHash(label) {
    let code = 0;
    for (const letter of label) code = (Math.imul(31, code) + letter.codePointAt(0)) >>> 0;
    return code;
  }
  // Keep the familiar swatches where possible, then fill gaps between visible hues.
  // Each label and all its edges use the same paint in the current graph, in both themes.
  const hues = [36,200,262,163,355,70,310,216];
  function tone(hue, lightness) {
    const saturation = .69;
    function channel(offset) {
      const k = (offset + hue / 30) % 12;
      const amplitude = saturation * Math.min(lightness, 1 - lightness);
      const level = lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * level).toString(16).padStart(2, '0');
    }
    return '#' + channel(0) + channel(8) + channel(4);
  }
  function stylesFor(labels) {
    const assigned = new Map(), occupied = new Set(), extra = [];
    const distance = new Array(360).fill(180);
    function reserve(hue) {
      for (let i=0; i<360; i++) {
        const gap = Math.abs(i - hue);
        distance[i] = Math.min(distance[i], gap, 360 - gap);
      }
    }
    for (const label of [...labels].sort((a,b) => a.localeCompare(b,'sv'))) {
      const hash = labelHash(label), index = hash % palette.length;
      const [dark, light, glyph, dash] = palette[index];
      if (occupied.has(index)) extra.push({label,hash,glyph,dash});
      else {
        occupied.add(index); reserve(hues[index]);
        assigned.set(label,{dark,light,glyph,dash});
      }
    }
    for (const [i,item] of extra.entries()) {
      let hue = item.hash % 360;
      for (let step=1; step<360; step++) {
        const candidate = (item.hash % 360 + step * 137) % 360;
        if (distance[candidate] > distance[hue]) hue = candidate;
      }
      reserve(hue);
      // Only very dense graphs can exhaust whole-degree hues. Give the next band its own tint.
      const band = Math.floor((occupied.size + i) / 360);
      assigned.set(item.label, {glyph:item.glyph,dash:item.dash,
        dark:tone(hue,.74 + .015 * (band % 6)),light:tone(hue,.28 - .012 * (band % 6))});
      if ((occupied.size + i + 1) % 360 === 0) distance.fill(180);
    }
    return assigned;
  }
  function project(scope, hits, collections, chosen, filtering, page) {
    const hitSlugs = new Set(hits.map(row => row.slug));
    const ordered = filtering ? [...hits, ...scope.filter(row => !hitSlugs.has(row.slug))] : scope;
    const pages = Math.max(1, Math.ceil(ordered.length / pageSize));
    const current = Math.min(page, pages - 1), start = current * pageSize;
    const shown = ordered.slice(start, start + pageSize);
    const topics = new Map(), articles = [], edges = [];
    for (const row of shown) {
      const labels = [...new Set(row.terms.filter(label => label.trim()))];
      articles.push({kind:'article', slug:row.slug, titel:row.title, href:row.href, series:row.series, datum:row.date,
        amne:collections.get(row.series).title, nyckelord:labels, excerpt:row.excerpt});
      for (const label of labels) {
        if (!topics.has(label)) topics.set(label, {kind:'topic', slug:'amne-' + label, titel:label,
          picked:chosen.has(label)});
        edges.push({a:topics.get(label).slug, b:row.slug});
      }
    }
    const styles = stylesFor(topics.keys());
    for (const [label,node] of topics) Object.assign(node,styles.get(label));
    return {current, pages, start, total:ordered.length, count:shown.length,
      detail:{nodes:[...topics.values(), ...articles], edges, filtering,
        hits:articles.filter(row => hitSlugs.has(row.slug)).map(row => row.slug)}};
  }
  function mount(toggleTopic) {
    const byId = id => document.getElementById(id);
    const frame = byId('xrChronicleFrame'), panel = byId('xrTopicCanvas'), toggle = byId('xrGraphToggle');
    const prev = byId('xrTopicPrev'), next = byId('xrTopicNext'), caption = byId('xrTopicRange');
    let page = 0, model, version, signature;
    const open = () => new URL(location.href).searchParams.get('rgraf') !== '0';
    function push() {
      const graph = frame.contentDocument?.getElementById('natverk');
      if (panel.hidden || graph?.dataset.editorialReady !== 'true' || !version) return;
      graph.dispatchEvent(new frame.contentWindow.CustomEvent('explorations:editorialgraph', {
        detail:{...version.detail, theme:document.documentElement.dataset.theme}
      }));
    }
    function draw() {
      panel.hidden = !open();
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      toggle.textContent = panel.hidden ? 'Visa ämnesnätverk' : 'Dölj ämnesnätverk';
      if (panel.hidden || !model) return;
      version = project(model.scope, model.hits, model.collections, model.chosen, model.filtering, page);
      page = version.current;
      caption.textContent = version.count ? 'Inlägg ' + (version.start + 1) + '–' + (version.start + version.count)
        + ' av ' + version.total + (model.filtering ? ' · ' + model.hits.length + ' sökträffar' : '') : 'Inga inlägg i den valda samlingen.';
      prev.disabled = page === 0;
      next.disabled = page + 1 >= version.pages;
      if (!frame.hasAttribute('src')) frame.setAttribute('src', frame.dataset.src);
      push();
    }
    prev.addEventListener('click', () => { if (page > 0) { page--; draw(); } });
    next.addEventListener('click', () => { if (version && page + 1 < version.pages) { page++; draw(); } });
    toggle.addEventListener('click', () => {
      const url = new URL(location.href);
      if (open()) url.searchParams.set('rgraf', '0'); else url.searchParams.delete('rgraf');
      history.replaceState(history.state, '', url); draw();
    });
    frame.addEventListener('explorations:editorialready', push);
    frame.addEventListener('explorations:editorialtopic', event => {
      if (version?.detail.nodes.some(node => node.kind === 'topic' && node.titel === event.detail)) toggleTopic(event.detail);
    });
    new MutationObserver(() => {
      const graph = frame.contentDocument?.documentElement, theme = document.documentElement.dataset.theme;
      if (graph && (theme === 'light' || theme === 'dark')) {
        graph.dataset.theme = theme;
        frame.contentWindow.dispatchEvent(new frame.contentWindow.CustomEvent('explorations:themechange'));
      }
    }).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});
    return (input, filterKey) => {
      if (signature !== filterKey) page = 0;
      signature = filterKey; model = input; draw();
    };
  }
  window.ExplorationsChronicleTopicGraph = Object.freeze({project, mount});
})();
