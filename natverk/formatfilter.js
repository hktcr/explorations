/* One projection of published texts. The sources graph keeps its own citation conditions. */
(() => {
  'use strict';
  if (!document.getElementById('networkFormats') || window.ExplorationsBriefingNetwork) return;
  const byId = id => document.getElementById(id);
  const formats = byId('networkFormats');
  const choices = [...formats.querySelectorAll('input')];
  const month = byId('networkMonth');
  const series = byId('networkSeries');
  const months = ['january januari', 'february februari', 'march mars', 'april', 'may maj', 'june juni',
    'july juli', 'august augusti', 'september', 'october oktober', 'november', 'december'];
  function essayMonth(date) {
    const month = months.findIndex(m => m.split(' ').some(word => String(date).toLowerCase().split(/\W+/).includes(word)));
    const year = String(date).match(/\b(20\d\d)\b/);
    return month >= 0 && year ? year[1] + '-' + String(month + 1).padStart(2, '0') : '';
  }
  const engine = window.ExplorationsSearch;
  async function json(file) {
    const response = await fetch('../' + file, {cache:'no-cache'});
    if (!response.ok) throw Error(file);
    return response.json();
  }
  async function load(essays, reviewed) {
    const [catalog, editorial, full, times] = await Promise.all([
      window.ExplorationsBriefingCatalogue.load(), window.ExplorationsChronicles.load('../'),
      json('landing-search-index.json'), json('portal-senaste.json')
    ]);
    const nodes = essays.map(row => ({...row, format:'essay', month:essayMonth(row.datum), href:'../' + row.slug + '/index.html'}));
    const links = [...reviewed];
    const publication = new Map(times.titles.map(r => [r.href,r.published]));
    const briefMonth = new Intl.DateTimeFormat('sv-SE', {year:'numeric',month:'2-digit',timeZone:'Europe/Stockholm'});
    const groups = new Map();
    for (const col of editorial.collections.values()) series.add(new Option(col.title, col.id));
    for (const row of editorial.entries.values()) {
      const label = editorial.collections.get(row.series).title;
      nodes.push({format:'editorial', series:row.series, month:row.date.slice(0,7), slug:row.slug,
        id:label, titel:row.title, href:'../' + row.href, amne:label, datum:row.date.slice(0,10), nyckelord:row.terms, excerpt:row.excerpt});
      const group = 'serie-' + row.series;
      groups.set(group, {slug:group, id:'Serie', titel:label, amne:'Redaktionen'});
      links.push({a:group,b:row.slug,label:'Ingår i ' + label,kind:'format-member',reason:''});
    }
    for (const item of catalog.nodes) {
      if (item.kind === 'category') groups.set(item.slug, {...item,amne:'Format'});
      if (item.kind !== 'article') continue;
      const at = publication.get(item.href.slice(3));
      nodes.push({...item,format:'briefing',month:at ? briefMonth.format(new Date(at)) : ''});
    }
    for (const edge of catalog.edges) {
      // In the combined view, the reviewed reading link lands on its owning essay node.
      const target = edge.b.startsWith('essay-section:') ? edge.b.split(':')[1] : edge.b;
      links.push({...edge,b:target});
    }
    const dates = [...new Set(nodes.map(r => r.month).filter(Boolean))].sort().reverse();
    const fmt = new Intl.DateTimeFormat('sv-SE', {month:'long',year:'numeric',timeZone:'UTC'});
    for (const m of dates) month.add(new Option(fmt.format(new Date(m + '-01T00:00:00Z')),m));
    const index = engine.prepare({schemaVersion:1,articles:[
      ...full.articles, ...full.briefings.map(r=>({...r,slug:'briefing-'+r.slug}))
    ]});
    let previousQuery, fullHits;
    function projection(query, metadata) {
      const selected = choices.filter(c => c.checked).map(c => c.value);
      const showSeries = !selected.length || selected.includes('editorial');
      byId('networkSeriesLabel').hidden = !showSeries;
      byId('networkAll').setAttribute('aria-pressed', String(!selected.length));
      if (query !== previousQuery) {
        fullHits = new Set();
        if (query.trim()) {
          for (const hit of [...engine.search(index,query), ...window.ExplorationsChronicles.search(editorial,query)]) fullHits.add(hit.slug);
        }
        previousQuery=query;
      }
      const texts = nodes.filter(n => (!selected.length || selected.includes(n.format)) &&
        (!month.value || month.value === n.month) && (n.format !== 'editorial' || !series.value || n.series === series.value) &&
        (!query.trim() || fullHits.has(n.slug) || metadata.has(n.slug)));
      const ids = new Set(texts.map(n=>n.slug));
      const used = new Set();
      const edges = links.filter(e => {
        if (!ids.has(e.b) || (!ids.has(e.a) && !groups.has(e.a))) return false;
        if (groups.has(e.a)) used.add(e.a);
        return true;
      });
      return {nodes:[...texts,...[...used].map(key => groups.get(key))],edges,texts:texts.length};
    }
    function sync() {
      const params = new URL(location.href).searchParams;
      for (const c of choices) c.checked = params.getAll('typ').includes(c.value);
      month.value = params.get('month') || '';
      series.value = params.get('serie') || '';
    }
    function changed() {
      const url = new URL(location.href);
      url.searchParams.delete('typ');
      for (const c of choices) if (c.checked) url.searchParams.append('typ', c.value);
      for (const [key, ctrl] of [['month',month], ['serie',series]]) {
        if (ctrl.value) url.searchParams.set(key, ctrl.value); else url.searchParams.delete(key);
      }
      history.replaceState(history.state,'',url);
      byId('essaSok').dispatchEvent(new Event('input'));
    }
    formats.addEventListener('change',changed);
    byId('networkAll').addEventListener('click',()=>{for(const c of choices)c.checked=false; changed();});
    function reset() { for(const c of choices)c.checked=false;month.value='';series.value='';changed(); }
    formats.hidden=false;
    sync();
    return {nodes,projection,sync,reset};
  }
  window.ExplorationsFormatFilter = {load};
})();
