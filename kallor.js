/* Search a catalog of actual citations and explore their intersection. */
(() => {
  "use strict";
  const fold=s=>String(s||"").normalize("NFKC").toLocaleLowerCase("sv");
  const words=s=>fold(s).match(/[\p{L}\p{M}\p{N}]+/gu)||[];
  const match=(rec,raw)=>{
    const q=fold(raw).trim();
    if(!q)return true;
    const bibliographic=fold([rec.title,...rec.aliases,rec.doi,rec.url].join(" "));
    const doi=q.match(/10\.\d{4,9}\/[^\s]+/);
    if (doi) return rec.doi===doi[0].replace(/[,.;]+$/,"");
    return words(q).length>0 && words(q).every(token=>bibliographic.includes(token));
  };
  const used=s=>new Set(s.uses.map(([t])=>t));
  const intersect=(records)=>{
    if(!records.length)return new Set();
    const sets=records.map(used).sort((a,b)=>a.size-b.size);
    return new Set([...sets[0]].filter(id=>sets.every(group=>group.has(id))));
  };
  const glyphs=["●","◆","▲","✚","■","⬟","◇","★"];
  const dashes=["","6 4","2 3","8 3 2 3","12 5","5 2 2 2","15 4 3 4","3 4"];
  function style(id,light=false) {
    const hash=parseInt(id.slice(4,12),16)>>>0,i=hash%8, hue=(hash%359+17)%360;
    return {color:"hsl("+hue+" 70% "+(light?"37%":"72%")+")", glyph:glyphs[i],dash:dashes[i]};
  }
  const exactText=/^(?:[a-z0-9-]+\/index\.html|timkronikan\/(?:inlagg\/(?:inlagg|halvtimmen)-20\d\d-\d\d-\d\d-\d{4}\.html|(?:halvtimmen\/)?20\d\d-\d\d\.html))(?:#[\w.:%-]+)?$/;
  function validate(data) {
    if(data?.schemaVersion!==1 || !Array.isArray(data.sources) || !data.texts)throw Error("Ogiltigt index");
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
  if(typeof module==="object"&&module.exports){module.exports={match,used,intersect,style,validate};return;}
  const $=id=>document.getElementById(id);
  const element=(tag,text,attrs={})=>{
    const n=document.createElement(tag);if(text!==null)n.textContent=text;
    for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;
  };
  const svg=$("sourceEdges"),list=$("sourceList"),graph=$("sourceGraph"),query=$("sourceQuery");
  const graphGrid=$("sourceGraphGrid"),sourcesEl=$("sourceNodes"),textsEl=$("sourceTexts");
  const status=$("sourceStatus"),choice=$("sourceConditions"),answer=$("conditionAnswer");
  const clear=$("clearConditions"),listView=$("viewList"),graphView=$("viewGraph");
  const state={selected:new Set(),mode:"list",limit:30,records:[],byId:new Map(),texts:{}};
  const selected=()=>[...state.selected].map(id=>state.byId.get(id));
  const light=()=>document.documentElement.dataset.theme==="light";
  function makeSourceButton(rec,label,kind){
    const paint=style(rec.id,light());
    const b=element("button",null,{type:"button","aria-pressed":String(state.selected.has(rec.id)),
      class:kind,"data-source-toggle":rec.id});
    b.style.setProperty("--series",paint.color);
    b.append(element("span",paint.glyph,{class:"source-glyph","aria-hidden":"true"}),document.createTextNode(" "+label));
    b.addEventListener("click",()=>toggle(rec.id,kind));
    return b;
  }
  function toggle(id,kind) {
    if(state.selected.has(id))state.selected.delete(id);
    else if(state.selected.size>=8) { answer.textContent="Välj högst åtta källor i taget.";return; }
    else state.selected.add(id);
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
    clear.hidden=!conditions.length;
    answer.replaceChildren();
    if(!conditions.length)return;
    for(const rec of conditions) {
      const li=element("li",null),button=makeSourceButton(rec,"Ta bort: "+rec.title.slice(0,96),"remove-source");
      li.append(button);choice.append(li);
    }
    const message=hitSet.size===1?"1 text använder alla valda källor.":hitSet.size+" texter använder alla valda källor.";
    answer.append(element("span",message));
    if(hitSet.size){
      const ul=element("ul",null);
      for(const doc of hitSet){const li=element("li",null);li.append(formatTextLink(doc));ul.append(li);}
      answer.append(ul);
    }
  }
  let lines=[];
  function reflow() {
    svg.replaceChildren();
    if(graph.hidden)return;
    const area=graphGrid.getBoundingClientRect();
    for(const [rec,src,target,dim] of lines){
      const a=src.getBoundingClientRect(),b=target.getBoundingClientRect(),mid=(a.right+b.left)/2-area.left;
      const path=document.createElementNS("http://www.w3.org/2000/svg","path"),paint=style(rec.id,light());
      const y=a.top+a.height/2-area.top,z=b.top+b.height/2-area.top;
      path.setAttribute("d","M "+(a.right-area.left)+" "+y+" C "+mid+" "+y+" "+mid+" "+z+" "+(b.left-area.left)+" "+z);
      path.setAttribute("fill","none");path.setAttribute("stroke",paint.color);path.setAttribute("stroke-width",dim?"1.3":"2.6");
      path.setAttribute("opacity",dim?".45":".82");if(paint.dash)path.setAttribute("stroke-dasharray",paint.dash);
      svg.append(path);
    }
  }
  function renderGraph(matches,conditions,hits){
    sourcesEl.replaceChildren();textsEl.replaceChildren();lines=[];
    const nodes=[...new Map([...conditions,...matches].map(r=>[r.id,r])).values()].slice(0,8);
    const ids=[...new Set([...hits,...nodes.flatMap(s=>[...used(s)])])].slice(0,24), textNodes=new Map();
    for(const doc of ids){
      const d=state.texts[doc], node=formatTextLink(doc),dim=!!conditions.length&&!hits.has(doc);
      node.className="text-node";node.dataset.dim=String(dim);
      node.append(element("small",d.series),element("span","Saknar minst en vald källa",{class:"missing"}));
      textsEl.append(node);textNodes.set(doc,node);
    }
    if(!nodes.length)sourcesEl.append(element("p","Inga källor att visa."));
    if(!ids.length)textsEl.append(element("p","Inga texter att visa."));
    for(const rec of nodes){
      const b=makeSourceButton(rec,rec.title+" · "+rec.count,"source-node");
      sourcesEl.append(b);
      for(const doc of used(rec))if(textNodes.has(doc))lines.push([rec,b,textNodes.get(doc),conditions.length&&!hits.has(doc)]);
    }
    requestAnimationFrame(reflow);
  }
  function render(){
    const matches=state.records.filter(rec=>match(rec,query.value)),conditions=selected(),hits=intersect(conditions);
    status.textContent=matches.length+" av "+state.records.length+" källor"+(state.mode==="graph"?" · högst åtta källnoder visas":"");
    list.hidden=state.mode!=="list";graph.hidden=state.mode!=="graph";
    listView.setAttribute("aria-pressed",String(!list.hidden));graphView.setAttribute("aria-pressed",String(!graph.hidden));
    renderConditions(conditions,hits);
    if(list.hidden)renderGraph(matches,conditions,hits);else renderList(matches);
  }
  const apply=()=>{state.limit=30;render();const url=new URL(location.href);if(query.value.trim())url.searchParams.set("q",query.value.trim());else url.searchParams.delete("q");history.replaceState(null,"",url);};
  $("sourceForm").addEventListener("submit",event=>{event.preventDefault();apply();});
  query.addEventListener("input",apply);
  clear.addEventListener("click",()=>{state.selected.clear();render();query.focus();});
  listView.addEventListener("click",()=>{state.mode="list";render();});
  graphView.addEventListener("click",()=>{state.mode="graph";render();});
  window.addEventListener("explorations:themechange",render);
  window.addEventListener("resize",reflow,{passive:true});
  if(typeof ResizeObserver==="function")new ResizeObserver(reflow).observe(graphGrid);
  query.value=(new URL(location.href).searchParams.get("q")||"").slice(0,240);
  fetch("../kallor-index.json",{cache:"no-cache"}).then(r=>{
    if(!r.ok)throw Error();return r.json();
  }).then(validate).then(d=>{
    state.records=d.sources;state.texts=d.texts;state.byId=new Map(d.sources.map(rec=>[rec.id,rec]));render();
  }).catch(()=>{status.textContent="Källregistret kunde inte öppnas. Ladda om sidan och försök igen.";});
})();
