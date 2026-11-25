/* Search a catalog of actual citations and explore their intersection. */
(() => {
  "use strict";
  const fold=s=>String(s||"").normalize("NFKC").toLocaleLowerCase("sv");
  const words=s=>fold(s).match(/[\p{L}\p{M}\p{N}]+/gu)||[];
  const match=(rec,raw)=>{
    const q=fold(raw).trim();
    if(!q)return true;
    const bibliographic=fold([rec.title,...rec.aliases,rec.doi,rec.url].join(" "));
    let doiCount=0, exactDoi=true;
    const remaining=q.replace(/(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[-._;()/:a-z0-9+%]+)/g, (_,identifier)=>{
      doiCount++;
      if(identifier.replace(/[.,;:]+$/,"")!==rec.doi) exactDoi=false;
      return " ";
    });
    const tokens=words(remaining);
    return exactDoi && (doiCount>0 || tokens.length>0) && tokens.every(token=>bibliographic.includes(token));
  };
  const used=s=>new Set(s.uses.map(([t])=>t));
  function sharedTexts(groups) {
    if (!groups.length) return new Set();
    const [smallest, ...others] = groups.slice().sort((a,b)=>a.size-b.size);
    return new Set([...smallest].filter(id=>others.every(set=>set.has(id))));
  }
  const intersect=records=>sharedTexts(records.map(used));
  const documentsFor=records=>new Set(records.flatMap(rec=>[...used(rec)]));
  const glyphs=["●","◆","▲","✚","■","⬟","◇","★"];
  const dashes=["","6 4","2 3","8 3 2 3","12 5","5 2 2 2","15 4 3 4","3 4"];
  function style(id,light=false) {
    const hash=parseInt(id.slice(4,12),16)>>>0,i=hash%8, hue=(hash%359+17)%360;
    return {color:"hsl("+hue+" 70% "+(light?"37%":"72%")+")", glyph:glyphs[i],dash:dashes[i]};
  }
  function distinguish(records) {
    const palette=new Map(),hues=[];
    for(const rec of records) {
      const preferred=style(rec.id),pref=Number(preferred.color.match(/\d+/)[0]);
      let hue=pref;
      while(hues.some(other=>Math.min(Math.abs(hue-other),360-Math.abs(hue-other))<23))hue=(hue+137)%360;
      hues.push(hue);
      palette.set(rec.id,{dark:"hsl("+hue+" 70% 72%)",light:"hsl("+hue+" 70% 37%)",glyph:glyphs[hues.length-1],dash:dashes[hues.length-1]});
    }
    return palette;
  }
  const exactText=/^(?:[a-z0-9-]+\/index\.html|vetenskaplig-briefing\/[a-z0-9-]+\/(?:index\.html)?|skogsvaktaren\/20\d\d-\d\d-\d\d\.html|timkronikan\/(?:reportage\/20\d\d-\d\d-\d\d-(?:lunch|world|varlden)\.html|inlagg\/(?:inlagg|halvtimmen)-20\d\d-\d\d-\d\d-\d{4}\.html|(?:halvtimmen\/)?20\d\d-\d\d\.html))(?:#[\w.:%-]+)?$/;
  function validate(data) {
    if(![1,2].includes(data?.schemaVersion) || !Array.isArray(data.sources) || !data.texts)throw Error("Ogiltigt index");
    const seen=new Set();
    for(const text of Object.values(data.texts)) if(!exactText.test(text.href)||typeof text.title!=="string"||typeof text.series!=="string")throw Error("Ogiltig textlänk");
    for(const rec of data.sources) {
      if(!/^src-[a-f0-9]{16}$/.test(rec.id)||seen.has(rec.id)||typeof rec.title!=="string"||!Array.isArray(rec.aliases)||
        !Array.isArray(rec.uses)||rec.uses.some(x=>!Array.isArray(x)||!Object.hasOwn(data.texts,x[0])||!exactText.test(x[1]))||
        rec.count!==used(rec).size||!rec.count)throw Error("Ogiltig källrad");
      if(rec.url){const url=new URL(rec.url);if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw Error("Ogiltig källadress");}
      seen.add(rec.id);
    }
    return data;
  }
  if(typeof module==="object"&&module.exports){module.exports={match,used,intersect,style,distinguish,validate};return;}
  const $=id=>document.getElementById(id);
  const element=(tag,text,attrs={})=>{
    const n=document.createElement(tag);if(text!==null)n.textContent=text;
    for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;
  };
  const list=$("sourceList"),graph=$("sourceGraph"),query=$("sourceQuery");
  const canonical=$("natverk");
  const status=$("sourceStatus"),choice=$("sourceConditions"),answer=$("conditionAnswer");
  const clear=$("clearConditions"),listView=$("viewList"),graphView=$("viewGraph");
  const state={selected:new Set(),mode:"list",limit:30,terms:new Map(),sourceOffset:0,textOffset:0,records:[],byId:new Map(),texts:{},palette:new Map()};
  const selected=()=>[...state.selected].map(id=>state.byId.get(id));
  const light=()=>document.documentElement.dataset.theme==="light";
  function makeSourceButton(rec,label,kind){
    const mix=state.palette.get(rec.id),paint=mix?{color:light()?mix.light:mix.dark,glyph:mix.glyph}:style(rec.id,light());
    const b=element("button",null,{type:"button","aria-pressed":String(state.selected.has(rec.id)),
      class:kind,"data-source-toggle":rec.id});
    b.style.setProperty("--series",paint.color);
    b.append(element("span",paint.glyph,{class:"source-glyph","aria-hidden":"true"}),document.createTextNode(" "+label));
    b.addEventListener("click",()=>toggle(rec.id,kind));
    return b;
  }
  function toggle(id,kind) {
    if(state.selected.has(id))state.selected.delete(id);
    else state.selected.add(id);
    state.sourceOffset=state.textOffset=0;
    render();
    [...document.querySelectorAll("[data-source-toggle]")].find(b=>b.dataset.sourceToggle===id&&b.classList.contains(kind))?.focus({preventScroll:true});
  }
  function uniqueUses(rec){
    return [...new Map(rec.uses.map(([doc,href])=>[doc,href])).entries()];
  }
  function formatTextLink(doc,href){
    return element("a",state.texts[doc].title,{href:"../"+(href||state.texts[doc].href)});
  }
  function renderList(matches){
    list.replaceChildren();
    if(!matches.length)list.append(element("p","Ingen källa matchar sökningen. Prova en kortare titel eller ett efternamn."));
    for(const rec of matches.slice(0,state.limit)){
      const article=element("article",null,{class:"source-record"}),info=element("details",null),head=element("h2",rec.title);
      const summary=element("summary",null);
      summary.append(head,element("span",rec.count+(rec.count===1?" text":" texter"),{class:"usage-group"}));info.append(summary);
      if(rec.aliases.length)info.append(element("p","Andra källrader: "+rec.aliases.join(" · "),{class:"usage-group"}));
      if(rec.url){const p=element("p",null);p.append(element("a",rec.doi?"DOI "+rec.doi:"Öppna originalkällan",{href:rec.url,rel:"noreferrer noopener"}));info.append(p);}
      const ul=element("ul",null);
      for(const [doc,href] of uniqueUses(rec)){
        const li=element("li",null);li.append(formatTextLink(doc,href),element("span",state.texts[doc].series,{class:"usage-group"}));ul.append(li);
      }
      info.append(ul);
      const controls=element("div",null,{class:"source-record-controls"});
      controls.append(makeSourceButton(rec,state.selected.has(rec.id)?"Ta bort som villkor":"Lägg till som villkor","pick-source"));
      article.append(info,controls);list.append(article);
    }
    if(matches.length>state.limit){
      const more=element("button","Visa fler källor",{type:"button"});more.addEventListener("click",()=>{
        const offset=state.limit;state.limit+=30;renderList(matches);list.querySelectorAll("article summary")[offset]?.focus();
      });list.append(more);
    }
  }
  function renderConditions(conditions,hitSet) {
    choice.replaceChildren();
    const active=conditions.length+state.terms.size>0;
    $("activeConditions").hidden=!active;
    clear.hidden=!active;
    answer.replaceChildren();
    if(!active)return;
    for (const [key,term] of state.terms) {
      const li=element("li",null),button=element("button","Ta bort sökning: "+term,{type:"button"});
      button.addEventListener("click",()=>{
        state.terms.delete(key);state.sourceOffset=state.textOffset=0;render();query.focus();
      });
      li.append(button);choice.append(li);
    }
    for(const rec of conditions) {
      const li=element("li",null),button=makeSourceButton(rec,"Ta bort: "+rec.title.slice(0,96),"remove-source");
      li.append(button);choice.append(li);
    }
    const message=hitSet.size+(hitSet.size===1?" text uppfyller":" texter uppfyller")+" alla valda villkor.";
    answer.append(element("span",message));
    if(hitSet.size){
      const ul=element("ul",null);
      for(const doc of hitSet){const li=element("li",null);li.append(formatTextLink(doc));ul.append(li);}
      answer.append(ul);
    }
  }
  function page(items,start,size,controls,previous,next,label) {
    const offset=Math.min(start,Math.max(0,Math.floor((items.length-1)/size)*size));
    $(controls).hidden=items.length<=size;
    $(previous).disabled=offset===0;
    $(next).disabled=offset+size>=items.length;
    $(label).textContent=(offset+1)+"–"+Math.min(items.length,offset+size)+" av "+items.length;
    return items.slice(offset,offset+size);
  }
  function renderGraph(sources,filtering,hits,titleHits){
    const linked=[...documentsFor(sources)].sort((a,b)=>Number(hits.has(b))-Number(hits.has(a)) || Number(titleHits.has(b))-Number(titleHits.has(a)));
    const ids=page(linked,state.textOffset,24,"textPages","prevTexts","nextTexts","textPage");
    const show=new Set(ids);
    const nodes=sources.map(rec=>{
      const paint=state.palette.get(rec.id);
      return {slug:rec.id,id:"Källa",titel:rec.title,amne:"Källa",href:rec.url||null,
        excerpt:rec.count+(rec.count===1?" publicerad text använder källan.":" publicerade texter använder källan."),
        source:true,picked:state.selected.has(rec.id),glyph:paint.glyph,dark:paint.dark,light:paint.light};
    }).concat(ids.map(doc=>{
      const d=state.texts[doc];return {slug:doc,id:d.series,titel:d.title,amne:d.series,href:"../"+d.href,
        excerpt:filtering&&!hits.has(doc)?"Uppfyller inte alla valda villkor.":""};
    }));
    const edges=sources.flatMap(rec=>{
      const paint=state.palette.get(rec.id);
      return [...used(rec)].filter(doc=>show.has(doc)).map(doc=>({a:rec.id,b:doc,label:"Belagd källkoppling",
        reason:state.texts[doc].title+" har en publicerad hänvisning till "+rec.title+".",
        dark:paint.dark,light:paint.light,dash:paint.dash?paint.dash.split(" ").map(Number):[]}));
    });
    canonical.dispatchEvent(new CustomEvent("explorations:sourcenetwork",{
      detail:{nodes,edges,hits:[...hits],filtering,fromAction:state.fromAction}
    }));
    state.fromAction=false;
  }
  canonical.addEventListener("explorations:sourcecondition",e=>{
    if(!state.byId.has(e.detail))return;
    state.fromAction=true;toggle(e.detail,"source-network-condition");
  });
  function search(raw) {
    const tokens=words(raw);
    const articles=new Set(Object.keys(state.texts).filter(id=>{
      const title=fold(state.texts[id].title);
      return tokens.length && tokens.every(token=>title.includes(token));
    }));
    const sources=[],docs=new Set(articles);
    for(const rec of state.records){
      if(match(rec,raw)){
        sources.push(rec);
        for(const [doc] of rec.uses)docs.add(doc);
      }else if(rec.uses.some(([doc])=>articles.has(doc))){
        sources.push(rec);
      }
    }
    return {sources,docs,articles};
  }
  function render(){
    const draftResult=search(query.value);
    const matches=draftResult.sources;
    const conditions=selected();
    const saved=[...state.terms.values()].map(search);
    const termMatches=saved.map(result=>result.sources);
    const hits=sharedTexts([...conditions.map(used),...saved.map(result=>result.docs)]);
    const filtering=conditions.length+termMatches.length>0;
    const draft=query.value.trim();
    const display=draft || !filtering ? matches : [...new Map([...conditions,...termMatches.flat()].map(rec=>[rec.id,rec])).values()];
    const graphSources=[...new Map([...conditions,...termMatches.flat(),...display].map(rec=>[rec.id,rec])).values()];
    const sources=page(graphSources,state.sourceOffset,8,"sourcePages","prevSources","nextSources","sourcePage");
    state.palette=distinguish(sources);
    $("addSourceTerm").hidden=!draft || !matches.length || state.terms.has(fold(draft));
    status.textContent=display.length+" av "+state.records.length+" källor";
    list.hidden=state.mode!=="list";graph.hidden=state.mode!=="graph";
    listView.setAttribute("aria-pressed",String(!list.hidden));graphView.setAttribute("aria-pressed",String(!graph.hidden));
    $("sourcePortalBack").href=draft?"portal/?"+new URLSearchParams({q:draft}):"portal/";
    renderConditions(conditions,hits);
    if(list.hidden)renderGraph(sources,filtering,hits,draftResult.articles);else renderList(display);
  }
  const apply=()=>{state.limit=30;state.sourceOffset=state.textOffset=0;render();const url=new URL(location.href);if(query.value.trim())url.searchParams.set("q",query.value.trim());else url.searchParams.delete("q");history.replaceState(null,"",url);};
  $("sourceForm").addEventListener("submit",event=>{event.preventDefault();apply();});
  query.addEventListener("input",apply);
  $("addSourceTerm").addEventListener("click",()=>{
    const term=query.value.trim();
    if (term && !$("addSourceTerm").hidden) {
      state.terms.set(fold(term),term);query.value="";apply();query.focus();
    }
  });
  for (const [key,offset,increment] of [["prevSources","sourceOffset",-8],["nextSources","sourceOffset",8],["prevTexts","textOffset",-24],["nextTexts","textOffset",24]]) {
    $(key).addEventListener("click",()=>{
      state[offset]+=increment;
      if(offset==="sourceOffset")state.textOffset=0;
      render();
      if($(key).disabled)$(increment>0?(offset==="sourceOffset"?"prevSources":"prevTexts"):(offset==="sourceOffset"?"nextSources":"nextTexts")).focus();
    });
  }
  clear.addEventListener("click",()=>{state.selected.clear();state.terms.clear();apply();query.focus();});
  listView.addEventListener("click",()=>{state.mode="list";render();});
  graphView.addEventListener("click",()=>{state.mode="graph";render();});
  window.addEventListener("explorations:themechange",render);
  const params=new URL(location.href).searchParams;
  query.value=(params.get("q")||"").slice(0,240);
  if(params.get("vy")==="natverk" || params.get("view")==="graph")state.mode="graph";
  fetch("../kallor-index-v2.json",{cache:"no-cache"}).then(r=>{
    if(!r.ok)throw Error();return r.json();
  }).then(validate).then(d=>{
    state.records=d.sources;state.texts=d.texts;state.byId=new Map(d.sources.map(rec=>[rec.id,rec]));render();
  }).catch(()=>{status.textContent="Källregistret kunde inte öppnas. Ladda om sidan och försök igen.";});
})();
