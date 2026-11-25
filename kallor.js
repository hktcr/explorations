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
        rec.count!==used(rec).size||(!rec.count&&rec.library!==true))throw Error("Ogiltig källrad");
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
  const state={selected:new Set(),mode:"list",overview:false,overviewDoc:null,limit:30,terms:new Map(),sourceOffset:0,textOffset:0,records:[],byId:new Map(),texts:{},palette:new Map()};
  const tags=window.ExplorationsSourceTags;
  state.tags=tags ? tags.read(new URLSearchParams(location.search)) : new Set();
  state.taxonomy=[];state.overviewSource="";state.three=false;state.yaw=.42;state.pitch=-.24;
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
  // The flat atlas and its rotatable projection share the same nodes and citation
  // pairs. Depth is only a layout coordinate; it is never a property of a source.
  let drawRotation = null, zoomOverview = null, resetCamera = null;
  const camera = {zoom:1, x:.5, y:.5};
  function renderOverview(sources,filtering,hits){
    const host=$("overviewMap"), select=$("overviewArticle"), sourceSelect=$("overviewSource");
    const docs=[...documentsFor(sources)].sort((a,b)=>state.texts[a].title.localeCompare(state.texts[b].title,"sv"));
    select.replaceChildren(element("option","Välj text …",{value:""}));
    sourceSelect.replaceChildren(element("option","Välj källa …",{value:""}));
    select.disabled=!docs.length;
    sourceSelect.disabled=!sources.length;
    host.replaceChildren();
    drawRotation=null;zoomOverview=null;resetCamera=null;
    const count=sources.reduce((sum,record)=>sum+used(record).size,0);
    $("graphScope").textContent=sources.length+" av "+state.records.length+" källor · "+docs.length+" av "+Object.keys(state.texts).length+" texter · "+count+" källkopplingar";
    $("overviewSelection").replaceChildren();
    if(!sources.length){host.append(element("p","Inga källor i urvalet."));return;}
    const loose=sources.filter(rec=>!rec.uses.length);
    const cells=docs.length+Math.ceil(loose.length/12);
    const cols=Math.ceil(Math.sqrt(cells*1.4)), rows=Math.ceil(cells/cols);
    const width=cols*100,height=rows*100;
    const make=(tag,attrs)=>{
      const node=document.createElementNS("http://www.w3.org/2000/svg",tag);
      for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);
      return node;
    };
    const svg=make("svg",{viewBox:"0 0 "+width+" "+height,role:"img","aria-label":state.three?"Källnät i tre dimensioner. Dra eller använd piltangenterna för att rotera. Rulla eller använd plus och minus för att zooma.":"Karta över samtliga källor och källkopplingar i urvalet"});
    const coords=new Map(),clusters=new Map(),points=make("g",{class:"atlas-sources"});
    const centers=make("g",{}),targets=make("g",{}),lines=make("path",{class:"atlas-links"});
    const positions=[],edges=[];
    function cell(i){
      return {x:50+(i%cols)*100,y:50+Math.floor(i/cols)*100,z:Math.sin(i*2.39996)*Math.max(width,height)*.18};
    }
    docs.forEach((doc,i)=>{
      const point=cell(i);
      coords.set(doc,point);clusters.set(doc,[]);
      select.append(element("option",state.texts[doc].title,{value:doc}));
      const center=make("circle",{r:6,class:"atlas-text",opacity:filtering&&!hits.has(doc)?.48:1});
      const target=make("circle",{r:17,class:"atlas-target","data-doc":doc});
      const title=make("title",{});title.textContent=state.texts[doc].title;
      target.append(title);targets.append(target);centers.append(center);
      positions.push({point,nodes:[center,target]});
    });
    for(const rec of sources){
      if(rec.uses.length)clusters.get(rec.uses[0][0]).push(rec);
      sourceSelect.append(element("option",rec.title,{value:rec.id}));
    }
    function addSource(rec,i,total,center){
      const angle=i*2.39996323, radius=13+28*Math.sqrt((i+.5)/total);
      const point={x:center.x+Math.cos(angle)*radius,y:center.y+Math.sin(angle)*radius,z:center.z+Math.sin(angle+.8)*radius};
      const circle=make("circle",{r:2.8,"data-source":rec.id});
      const tip=make("title",{});tip.textContent=rec.title;circle.append(tip);
      points.append(circle);positions.push({point,nodes:[circle]});
      for(const doc of used(rec))edges.push([point,coords.get(doc)]);
    }
    for(const [doc,records] of clusters){
      records.forEach((rec,i)=>addSource(rec,i,records.length,coords.get(doc)));
    }
    loose.forEach((rec,i)=>addSource(rec,i%12,Math.min(12,loose.length-12*Math.floor(i/12)),cell(docs.length+Math.floor(i/12))));
    const rad=Math.hypot(width/2,height/2,Math.max(width,height)*.24);
    function draw(){
      const cy=Math.cos(state.yaw),sy=Math.sin(state.yaw),cp=Math.cos(state.pitch),sp=Math.sin(state.pitch);
      for(const {point,nodes} of positions){
        let x=point.x,y=point.y;
        if(state.three){
          const dx=x-width/2,dy=y-height/2,rx=cy*dx+sy*point.z,rz=cy*point.z-sy*dx;
          const ry=cp*dy-sp*rz,depth=sp*dy+cp*rz;
          const scale=Math.min(width,height)*.46/rad * (3*rad)/(3*rad-depth);
          x=width/2+rx*scale;y=height/2+ry*scale;
        }
        point.u=x.toFixed(2);point.v=y.toFixed(2);
        for(const node of nodes){node.setAttribute("cx",point.u);node.setAttribute("cy",point.v);}
      }
      lines.setAttribute("d",edges.map(([a,b])=>"M"+a.u+","+a.v+"L"+b.u+","+b.v).join(" "));
    }
    draw();svg.append(lines,points,centers,targets);host.append(svg);
    if(sourceSelect.options.length && [...sourceSelect.options].some(o=>o.value===state.overviewSource)){
      sourceSelect.value=state.overviewSource;inspectSource();
    }
    let dragged=false;
    svg.addEventListener("click",event=>{
      if(dragged)return;
      const doc=event.target.closest("[data-doc]")?.dataset.doc;
      const source=event.target.closest("[data-source]")?.dataset.source;
      if(doc)openOverviewArticle(doc);
      else if(source){sourceSelect.value=source;inspectSource();}
    });
    if(!state.three)return;
    drawRotation=draw;svg.classList.add("rotatable");svg.setAttribute("tabindex","0");
    function applyCamera(){
      const w=width/camera.zoom, h=height/camera.zoom;
      svg.setAttribute("viewBox",[camera.x*width-w/2,camera.y*height-h/2,w,h].join(" "));
    }
    applyCamera();
    resetCamera=()=>{camera.x=.5;camera.y=.5;camera.zoom=1;applyCamera();};
    zoomOverview=(factor,anchorX=camera.x,anchorY=camera.y)=>{
      const next=Math.min(8,Math.max(.5,camera.zoom*factor));
      if(next===camera.zoom)return;
      const ratio=camera.zoom/next;
      const half=.5/next;
      const bounded=value=>half>=.5 ? .5 : Math.max(half,Math.min(1-half,value));
      camera.x=bounded(anchorX+(camera.x-anchorX)*ratio);
      camera.y=bounded(anchorY+(camera.y-anchorY)*ratio);
      camera.zoom=next;
      applyCamera();
    };
    svg.addEventListener("wheel",event=>{
      const mode=event.deltaMode;
      if(!event.deltaY || !event.cancelable)return;
      event.preventDefault();
      const unit=mode===1 ? 16 : mode===2 ? svg.clientHeight||400 : 1;
      const pixels=Math.max(-240,Math.min(240,event.deltaY*unit));
      const factor=Math.exp(-pixels*.0025);
      const matrix=svg.getScreenCTM?.();
      if(matrix){
        const cursor=svg.createSVGPoint();
        cursor.x=event.clientX;cursor.y=event.clientY;
        const local=cursor.matrixTransform(matrix.inverse());
        zoomOverview(factor,local.x/width,local.y/height);
      }else zoomOverview(factor);
    },{passive:false});
    let start=null,frame=0;
    svg.addEventListener("pointerdown",e=>{
      if(!e.isPrimary||e.button!==0)return;
      start={id:e.pointerId,x:e.clientX,y:e.clientY,yaw:state.yaw,pitch:state.pitch};
      dragged=false;
    });
    svg.addEventListener("pointermove",e=>{
      if(!start||e.pointerId!==start.id)return;
      const dx=e.clientX-start.x,dy=e.clientY-start.y;
      if(!dragged && Math.hypot(dx,dy)<5)return;
      if(!dragged)svg.setPointerCapture(e.pointerId);
      dragged=true;state.yaw=start.yaw+dx*.012;state.pitch=start.pitch-dy*.012;
      if(!frame)frame=requestAnimationFrame(()=>{frame=0;draw();});
    });
    for(const type of ["pointerup","pointercancel","lostpointercapture","pointerleave"]){
      svg.addEventListener(type,e=>{if(start?.id===e.pointerId && (type!=="pointerleave"||!dragged))start=null;});
    }
    svg.addEventListener("keydown",e=>{
      if(!e.ctrlKey && !e.metaKey && ["+","=","-"].includes(e.key)){
        e.preventDefault();zoomOverview(e.key==="-" ? .8 : 1.25);return;
      }
      const key={ArrowLeft:"rotateLeft",ArrowRight:"rotateRight",ArrowUp:"rotateUp",ArrowDown:"rotateDown",Home:"resetRotation"}[e.key];
      if(key){e.preventDefault();rotate(key);}
    });
  }
  function rotate(id){
    if(!drawRotation)return;
    if(id==="resetRotation"){
      state.yaw=.42;state.pitch=-.24;
      resetCamera();
    }
    else {
      state.yaw+=({rotateLeft:-.22,rotateRight:.22}[id]||0);
      state.pitch+=({rotateUp:-.22,rotateDown:.22}[id]||0);
    }
    drawRotation();
  }
  function inspectSource(){
    const id=$("overviewSource").value, rec=state.byId.get(id);
    state.overviewSource=id;
    const panel=$("overviewSelection");panel.replaceChildren();
    $("overviewMap").querySelector(".chosen")?.classList.remove("chosen");
    if(!rec)return;
    $("overviewMap").querySelector('[data-source="'+id+'"]')?.classList.add("chosen");
    panel.append(element("strong",rec.title),element("p",rec.count?rec.count+" kopplade texter":"Fristående källa"));
    if(rec.url)panel.append(element("a","Öppna originalkällan",{href:rec.url,rel:"noreferrer noopener"}));
    for(const [doc,href] of uniqueUses(rec)){const p=element("p",null);p.append(formatTextLink(doc,href));panel.append(p);}
  }
  function openOverviewArticle(doc){
    if(!Object.hasOwn(state.texts,doc))return;
    state.overview=false;state.overviewDoc=doc;state.sourceOffset=state.textOffset=0;
    render();$("showSourceOverview").focus();
  }
  function renderGraph(sources,filtering,hits,titleHits){
    const linked=[...documentsFor(sources)].sort((a,b)=>Number(b===state.overviewDoc)-Number(a===state.overviewDoc) || Number(hits.has(b))-Number(hits.has(a)) || Number(titleHits.has(b))-Number(titleHits.has(a)));
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
  function search(raw,filterTags=true) {
    const tokens=words(raw);
    const articles=new Set(Object.keys(state.texts).filter(id=>{
      const title=fold(state.texts[id].title);
      return tokens.length && tokens.every(token=>title.includes(token));
    }));
    const sources=[],docs=new Set();
    for(const rec of state.records){
      if(filterTags && tags && !tags.matches(rec,state.tags))continue;
      const tagTerms=tags ? fold(tags.queryText(rec,state.taxonomy)) : "";
      if(match(rec,raw)||(tokens.length&&tokens.every(t=>tagTerms.includes(t)))){

        sources.push(rec);
        for(const [doc] of rec.uses)docs.add(doc);
      }else if(rec.uses.some(([doc])=>articles.has(doc))){
        sources.push(rec);
        for(const [doc] of rec.uses)if(articles.has(doc))docs.add(doc);
      }
    }
    return {sources,docs,articles};
  }
  function render(){
    const draftResult=search(query.value);
    const matches=draftResult.sources;
    const conditions=selected();
    if(tags){
      const available=state.tags.size ? search(query.value,false).sources : matches;
      tags.cloud($("networkTags"),available,state.taxonomy,state.tags,id=>{
        if(state.tags.has(id))state.tags.delete(id);else state.tags.add(id);
        apply();
        [...$("networkTags").querySelectorAll("[data-tag-id]")].find(b=>b.dataset.tagId===id)?.focus();
      });
    }
    const saved=[...state.terms.values()].map(search);
    const termMatches=saved.map(result=>result.sources);
    const permitted=rec=>!tags || tags.matches(rec,state.tags);
    const hits=sharedTexts([...conditions.map(rec=>permitted(rec)?used(rec):new Set()),...saved.map(result=>result.docs)]);
    const filtering=conditions.length+termMatches.length>0;
    const draft=query.value.trim();
    const display=draft || !filtering ? matches : [...new Map([...conditions.filter(permitted),...termMatches.flat()].map(rec=>[rec.id,rec])).values()];
    const graphSources=[...new Map([...conditions.filter(permitted),...termMatches.flat(),...display].map(rec=>[rec.id,rec])).values()];
    const detailSources=state.overviewDoc ? graphSources.filter(rec=>used(rec).has(state.overviewDoc)) : graphSources;
    const sources=page(detailSources,state.sourceOffset,8,"sourcePages","prevSources","nextSources","sourcePage");
    state.palette=distinguish(sources);
    $("addSourceTerm").hidden=!draft || !matches.length || state.terms.has(fold(draft));
    status.textContent=display.length+" av "+state.records.length+" källor";
    list.hidden=state.mode!=="list";graph.hidden=state.mode!=="graph";
    listView.setAttribute("aria-pressed",String(!list.hidden));graphView.setAttribute("aria-pressed",String(!graph.hidden));
    const backParams=new URLSearchParams();if(draft)backParams.set("q",draft);
    if(tags)tags.write(backParams,state.tags);
    $("sourcePortalBack").href="portal/"+(backParams.size?"?"+backParams:"");
    renderConditions(conditions,hits);
    const showOverview=state.mode==="graph" && state.overview;
    $("rotationTools").hidden=!showOverview||!state.three;
    $("overview3D").setAttribute("aria-pressed",String(showOverview&&state.three));
    $("overview2D").setAttribute("aria-pressed",String(!showOverview||!state.three));
    $("sourceOverview").hidden=!showOverview;$("sourceDetail").hidden=showOverview;
    const overviewButton=$("showSourceOverview");
    overviewButton.setAttribute("aria-expanded",String(showOverview));
    overviewButton.textContent=showOverview ? "Till detaljvyn" : (draft||filtering||state.tags.size ? "Översikt över urvalet" : "Visa hela nätet");
    if(!list.hidden){renderList(display);return;}
    if(showOverview){renderOverview(graphSources,filtering,hits);return;}
    renderGraph(sources,filtering,hits,draftResult.articles);
    const linked=documentsFor(sources).size;
    const scope=state.overviewDoc ? state.texts[state.overviewDoc].title+" · " : "";
    $("graphScope").textContent=scope+"Detaljvyn visar "+sources.length+" av "+detailSources.length+" källor och "+Math.min(linked,24)+" av "+linked+" texter kopplade till dessa källor.";
  }
  $("showSourceOverview").addEventListener("click",()=>{
    state.overview=!state.overview;state.overviewDoc=null;state.sourceOffset=state.textOffset=0;render();
  });
  for(const [id,three] of [["overview2D",false],["overview3D",true]]){
    $(id).addEventListener("click",()=>{state.overview=true;state.three=three;render();});
  }
  for(const [id,factor] of [["overviewZoomIn",1.25],["overviewZoomOut",.8]]){
    $(id)?.addEventListener("click",()=>zoomOverview?.(factor));
  }
  for(const id of ["rotateLeft","rotateRight","rotateUp","rotateDown","resetRotation"]){
    $(id).addEventListener("click",()=>rotate(id));
  }
  $("overviewSource").addEventListener("change",inspectSource);
  $("overviewArticle").addEventListener("change",event=>openOverviewArticle(event.target.value));
  const apply=()=>{state.overviewDoc=null;state.limit=30;state.sourceOffset=state.textOffset=0;render();const url=new URL(location.href);if(query.value.trim())url.searchParams.set("q",query.value.trim());else url.searchParams.delete("q");if(tags)tags.write(url.searchParams,state.tags);history.replaceState(null,"",url);};
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
    state.records=d.sources;state.texts=d.texts;state.taxonomy=d.tags||[];state.byId=new Map(d.sources.map(rec=>[rec.id,rec]));render();
  }).catch(()=>{status.textContent="Källregistret kunde inte öppnas. Ladda om sidan och försök igen.";});
})();
