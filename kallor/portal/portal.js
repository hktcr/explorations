(() => {
  const input = document.querySelector('#sourceSearch');
  const toggle = document.querySelector('#sourceContents');
  const list = document.querySelector('#sourceList');
  const status = document.querySelector('#sourceCount');
  const network = document.querySelector('#sourceNetwork');
  const cloud = document.querySelector('#sourceTags');
  const tags = window.ExplorationsSourceTags;
  const selected = tags.read(new URLSearchParams(location.search));
  const collator = new Intl.Collator('sv', {sensitivity:'base', numeric:true, ignorePunctuation:true});
  const fold = s => s.normalize('NFKC').toLocaleLowerCase('sv');
  const root = new URL('../../', location.href);
  let catalog, request, showAll = false, version = 0;
  function link(parent, title, href) {
    const a = document.createElement('a');
    a.textContent = title;
    a.href = href;
    parent.append(a);
  }
  function details(row, texts, taxonomy) {
    const block = document.createElement('details');
    const title = document.createElement('summary');
    title.textContent = row.title;
    block.append(title);
    block.addEventListener('toggle', () => {
      if (!block.open || block.children.length > 1) return;
      const info = document.createElement('p');
      if (row.summary) {
        const paragraph = document.createElement('p');
        paragraph.textContent = row.summary;
        block.append(paragraph);
        if (row.evidence) {
          const basis = document.createElement('p');
          basis.textContent = 'Läsunderlag: ' + row.evidence + '.';
          block.append(basis);
        }
      }
      const records = new Map(row.uses.map(([id, path]) => [id, path]));
      if (row.citation) {
        const ref = document.createElement('p');
        ref.textContent = 'APA: ' + row.citation + (row.doi ? ' ' : '');
        if (row.doi && /^10\.\d{4,9}\/[-._;()/:a-z0-9+]+$/i.test(row.doi)) {
          const doiURL = new URL('https://doi.org/' + row.doi);
          link(ref, doiURL.href, doiURL.href);
        }
        block.append(ref);
      }
      for (const note of row.notes || []) {
        if (!records.has(note.doc) || !texts[note.doc] || !note.text) continue;
        const paragraph = document.createElement('p');
        paragraph.textContent = note.text + ' — ';
        link(paragraph, texts[note.doc].title, new URL(records.get(note.doc), root).href);
        block.append(paragraph);
      }
      const alternative = row.aliases.find(value => value && fold(value) !== fold(row.title));
      if (!row.notes?.length && alternative) {
        const citation = document.createElement('p');
        citation.textContent = 'Även citerad som ”' + alternative + '”.';
        block.append(citation);
      }
      if (row.doi) info.append('DOI ' + row.doi + '. ');
      info.append(records.size ? 'Hänvisning i ' + records.size + (records.size===1 ? ' publicerad text.' : ' publicerade texter.') : 'Fristående källa i samlingen.');
      const subjects = taxonomy.filter(tag => row.tags?.includes(tag.id));
      if (subjects.length) info.append(' Ämnen: ' + subjects.map(tag => tag.sv).join(', ') + '.');
      block.append(info);
      if (row.url) {
        const target = new URL(row.url);
        if (['https:','http:'].includes(target.protocol)) {
          info.append(' ');
          link(info,'Öppna källan (' + target.hostname + ')',target.href);
        }
      }
      const uses = document.createElement('ul');
      for (const [id,path] of records) {
        const text = texts[id], target = new URL(path,root);
        if (!text || target.origin!==root.origin || !target.pathname.startsWith(root.pathname)) continue;
        const li = document.createElement('li');
        link(li,text.series + ' · ' + text.title,target.href);
        uses.append(li);
      }
      if (uses.children.length) block.append(uses);
    });
    return block;
  }
  async function load() {
    if (catalog) return catalog;
    if (!request) request = fetch('../../kallor-index-v2.json',{cache:'no-cache'}).then(async response => {
      if (!response.ok) throw Error('index');
      const data = await response.json();
      if (data.schemaVersion!==2 || !Array.isArray(data.sources) || !data.texts) throw Error('index');
      catalog = {texts:data.texts, taxonomy:data.tags || [], sources:data.sources.sort((a,b)=>collator.compare(a.title,b.title))};
      return catalog;
    }).finally(()=>{request=null;});
    return request;
  }
  async function render() {
    const sequence = ++version, query = input.value.trim();
    const params = tags.write(new URLSearchParams({vy:'natverk'}), selected);
    if (query) params.set('q',query);
    network.href = '../?' + params;
    const url = new URL(location.href);
    tags.write(url.searchParams,selected);
    if (query) url.searchParams.set('q',query);
    else url.searchParams.delete('q');
    if (url.href !== location.href) history.replaceState(history.state,'',url);
    list.hidden = !(showAll || query || selected.size);
    toggle.setAttribute('aria-expanded',String(!list.hidden));
    list.replaceChildren();
    status.textContent = list.hidden ? '' : 'Hämtar källor…';
    try {
      const {sources,texts,taxonomy} = await load();
      if (sequence!==version) return;
      const engine = window.ExplorationsSearch;
      const clauses = [...fold(query).replace(/[“”„]/g, '"').matchAll(/"([^"]+)"|([^"\s]+)/g)]
        .map(m=>m[1] ? {phrase:engine.words(m[1])} : {term:m[2]})
        .filter(c=>c.term || c.phrase?.length);
      const base = sources.filter(row=>{
        if (!clauses.length) return !query;
        const fields = [row.title,...row.aliases,row.doi,row.url,row.summary,row.citation,tags.queryText(row,taxonomy),
          ...(row.notes || []).map(n=>n.text), ...row.uses.map(([id])=>texts[id]?.title)]
          .filter(value=>typeof value === 'string' && value).map(fold);
        const matches = c => c.term
          ? fields.some(field=>field.includes(c.term))
          : fields.some(field=>engine.phraseCount(engine.words(field), c.phrase)>0);
        return clauses.every(matches);
      });
      tags.cloud(cloud,base,taxonomy,selected,id=>{
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        render();
      });
      if (list.hidden) return;
      const rows = base.filter(row=>tags.matches(row,selected));
      const entries = document.createDocumentFragment();
      for (const row of rows) entries.append(details(row,texts,taxonomy));
      list.append(entries);
      status.textContent = rows.length ? rows.length + (rows.length===1?' källa':' källor') : 'Inga källor matchar sökningen.';
    } catch {
      if (sequence===version) status.textContent='Källregistret kunde inte hämtas. Prova igen.';
    }
  }
  input.value = (new URLSearchParams(location.search).get('q')||'').slice(0,240);
  input.addEventListener('input',()=>{showAll=false;render();});
  document.querySelector('#sourceForm').addEventListener('submit',e=>{e.preventDefault();render();});
  toggle.addEventListener('click',()=>{
    if (input.value || selected.size) {input.value='';selected.clear();showAll=true;} else showAll=!showAll;
    render();
  });
  render();
})();
