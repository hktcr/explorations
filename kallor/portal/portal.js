(() => {
  const input = document.querySelector('#sourceSearch');
  const toggle = document.querySelector('#sourceContents');
  const list = document.querySelector('#sourceList');
  const status = document.querySelector('#sourceCount');
  const network = document.querySelector('#sourceNetwork');
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
  function details(row, texts) {
    const block = document.createElement('details');
    const title = document.createElement('summary');
    title.textContent = row.title;
    block.append(title);
    block.addEventListener('toggle', () => {
      if (!block.open || block.children.length > 1) return;
      const info = document.createElement('p');
      const records = new Map(row.uses.map(([id, path]) => [id, path]));
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
      info.append('Hänvisning i ' + records.size + (records.size===1 ? ' publicerad text.' : ' publicerade texter.'));
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
      block.append(uses);
    });
    return block;
  }
  async function load() {
    if (catalog) return catalog;
    if (!request) request = fetch('../../kallor-index-v2.json',{cache:'no-cache'}).then(async response => {
      if (!response.ok) throw Error('index');
      const data = await response.json();
      if (data.schemaVersion!==2 || !Array.isArray(data.sources) || !data.texts) throw Error('index');
      catalog = {texts:data.texts, sources:data.sources.sort((a,b)=>collator.compare(a.title,b.title))};
      return catalog;
    }).finally(()=>{request=null;});
    return request;
  }
  async function render() {
    const sequence = ++version, query = input.value.trim();
    const params = new URLSearchParams({vy:'natverk'});
    if (query) params.set('q',query);
    network.href = '../?' + params;
    list.hidden = !(showAll || query);
    toggle.setAttribute('aria-expanded',String(!list.hidden));
    list.replaceChildren();
    status.textContent = '';
    if (list.hidden) return;
    status.textContent = 'Hämtar källor…';
    try {
      const {sources,texts} = await load();
      if (sequence!==version) return;
      const terms = fold(query).split(/\s+/).filter(Boolean);
      const rows = sources.filter(row=>{
        const haystack=fold([row.title,...row.aliases,row.doi,row.url].join(' '));
        return terms.every(term=>haystack.includes(term));
      });
      const entries = document.createDocumentFragment();
      for (const row of rows) entries.append(details(row,texts));
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
    if (input.value) {input.value='';showAll=true;} else showAll=!showAll;
    render();
  });
  render();
})();
