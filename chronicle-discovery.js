/* Canonical chronicle discovery; independent of the reviewed essay corpus. */
(() => {
  "use strict";
  const folder = {timkronikan:"timkronikan",halvtimmen:"timkronikan/halvtimmen",reportage:"timkronikan/reportage"};
  const prefix = {timkronikan:"inlagg-",halvtimmen:"halvtimmen-"};
  function validate(data) {
    if (![1,2].includes(data?.schemaVersion) || !Array.isArray(data.collections) || !Array.isArray(data.entries)) throw Error("Ogiltigt krönikeindex");
    const collections = new Map();
    const entries = new Map();
    for (const col of data.collections) {
      if (!Object.hasOwn(folder,col.id) || collections.has(col.id) || col.href !== folder[col.id]+"/" ||
          typeof col.title !== "string" || !Number.isInteger(col.count) || col.count<0 ||
          !Array.isArray(col.topics) || col.topics.some(t=>typeof t.label!=="string" || !Number.isInteger(t.count) || t.count<1)) throw Error("Ogiltig samling");
      collections.set(col.id,col);
    }
    for (const row of data.entries) {
      if(row?.series==="reportage"){
        const m=typeof row.date==="string"&&row.date.match(/^20\d\d-\d\d-\d\d$/);
        const a=typeof row.anchor==="string"&&row.anchor.match(/^reportage-(20\d\d-\d\d-\d\d)-(lunch|world|varlden)$/);
        const expected=a&&folder.reportage+"/"+a[1]+"-"+a[2]+".html";
        if(!collections.has(row.series)||!m||!a||a[1]!==row.date||!Number.isFinite(Date.parse(row.date))||
          row.slug!==row.anchor||row.href!==expected||row.anchorUrl!==expected+"#"+row.anchor||entries.has(row.slug)||
          typeof row.title!=="string"||typeof row.excerpt!=="string"||
          [row.terms,row.paragraphs,row.references].some(x=>!Array.isArray(x)||x.some(y=>typeof y!=="string"))) throw Error("Ogiltigt reportage");
        entries.set(row.slug,row);continue;
      }
      const match = typeof row.date === "string" && row.date.match(/^(20\d\d-\d\d-\d\d)T(\d\d):(\d\d)[+-]\d\d:\d\d$/);
      if (!collections.has(row.series) || !match || !Number.isFinite(Date.parse(row.date)) ||
          row.anchor !== prefix[row.series]+match[1]+"-"+match[2]+match[3] ||
          row.slug !== row.series+"-"+match[1]+"-"+match[2]+match[3] ||
          row.anchorUrl !== folder[row.series]+"/"+match[1].slice(0,7)+".html#"+row.anchor ||
          (row.href !== row.anchorUrl && row.href !== "timkronikan/inlagg/"+row.anchor+".html") ||
          entries.has(row.slug) || typeof row.title !== "string" || typeof row.excerpt !== "string" ||
          [row.terms,row.paragraphs,row.references].some(x=>!Array.isArray(x)||x.some(y=>typeof y!=="string"))) throw Error("Ogiltig krönika");
      entries.set(row.slug,row);
    }
    const counts = new Map();
    for (const row of entries.values()) counts.set(row.series,(counts.get(row.series)||0)+1);
    for (const col of collections.values()) if (col.count!==(counts.get(col.id)||0)) throw Error("Ofullständigt krönikeindex");
    return {collections,entries};
  }
  const engine=()=>window.ExplorationsSearch;
  function prepare(source) {
    return engine().prepare({schemaVersion:1,articles:[...source.entries.values()].map(row=>{
      const series=source.collections.get(row.series).title;
      return {slug:row.slug,id:series,title:row.title,subject:row.terms.join(" · "),excerpt:row.excerpt,language:"sv",
        blocks:[{kind:"heading",text:series+" "+row.terms.join(" · "),anchor:"",heading:"Serie och ämne"},
          ...row.paragraphs.map(text=>({kind:"body",text,anchor:"",heading:""}))],
        references:row.references.map(title=>({title,anchor:""}))};
    })});
  }
  let dataRequest;
  function load(base="") {
    if (!dataRequest) dataRequest=fetch(base+"kronikor-index-v2.json",{cache:"no-cache"}).then(r=>{
      if(!r.ok) throw Error("Krönikeindex saknas");
      return r.json();
    }).then(validate).then(d=>({...d,search:prepare(d)})).catch(e=>{dataRequest=null;throw e;});
    return dataRequest;
  }
  function search(data,q) {
    if (!q.trim()) return [...data.entries.values()].map(row=>({...row}));
    const indices=data.entries;
    return engine().search(data.search,q).map(result=>({...indices.get(result.slug),hit:result}))
      .sort((a,b)=>b.hit.score-a.hit.score || Date.parse(b.date)-Date.parse(a.date) || a.slug.localeCompare(b.slug));
  }
  function item(tag,value,attrs={}) {
    const el=document.createElement(tag); if(value!==null) el.textContent=value;
    for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
    return el;
  }
  function card(row,data,base="") {
    const wrap=item("article",null,{class:"xr-chronicle-hit"});
    const head=item("h3",null); head.append(item("a",row.title,{href:base+row.href})); wrap.append(head);
    const prefix=data.collections.get(row.series).title, ts=row.date.slice(0,16).replace("T"," kl. ");
    wrap.append(item("p",prefix+" · "+ts,{class:"result-kicker",lang:"sv"}));
    const p=item("p",null,{class:"result-snippet",lang:"sv"});
    const hit=row.hit;
    if(hit) {
      for(const s of engine().snippet(hit.hits.find(h=>h.kind!=="title")?.text || row.excerpt,hit.query))
        p.append(item(s.match?"mark":"span",s.text));
    } else p.textContent=row.excerpt.slice(0,180)+(row.excerpt.length>180?"…":"");
    wrap.append(p);return wrap;
  }
  window.ExplorationsChronicles=Object.freeze({load,search,card,item});
})();
