/* Keep the curated essay graph intact; group chronicles by editorial collection. */
document.addEventListener("DOMContentLoaded",() => {
  "use strict";
  const api=window.ExplorationsChronicles, panel=document.getElementById("kronikor");
  if (!api || !panel || new URL(location.href).searchParams.get("format") === "vetenskaplig-briefing") return;
  const essay=document.getElementById("xrEssayNetwork"), contrast=document.getElementById("xrShowChronicles");
  const reset=document.getElementById("natverkAterstall"), title=document.getElementById("xrChronicleTitle");
  const branches=document.getElementById("xrChronicleBranches"), status=document.getElementById("xrChronicleStatus");
  const topics=document.getElementById("xrChronicleTopics"), query=document.getElementById("xrChronicleQuery"), results=document.getElementById("xrChronicleMatches");
  const month=document.getElementById("xrChronicleMonth");
  const savedTerms=window.ExplorationsNetworkConditions ? window.ExplorationsNetworkConditions(query,document.getElementById('chronicleAddTerm'),document.getElementById('chronicleTerms'),'rc') : null;
  let wantedMonth="", data, selection=null, limit=12, loading, wasOpen;
  const chosen=new Set();
  const graphView=window.ExplorationsChronicleTopicGraph?.mount(toggleTopic);
  function restoreTopics() {
    const known=new Set([...data.entries.values()].flatMap(row=>row.terms));
    for(const label of chosen)if(!known.has(label))chosen.delete(label);
  }
  function writeFilters() {
    const url=new URL(location.href);
    url.searchParams.delete('rt');
    for(const label of chosen)url.searchParams.append('rt',label);
    if(selection)url.searchParams.set('serie',selection);else url.searchParams.delete('serie');
    history.replaceState(history.state,'',url);
  }
  function toggleTopic(label) {
    if(chosen.has(label))chosen.delete(label);else chosen.add(label);
    writeFilters();limit=12;renderTopics();renderRows();
  }
  const matchMonth=row=>!wantedMonth || row.date.slice(0,7)===wantedMonth;
  const matches=()=>[...data.entries.values()].filter(row=>(!selection||row.series===selection)&&matchMonth(row));
  function months(){
    if(!month)return;
    const valid=[...new Set([...data.entries.values()].map(x=>x.date.slice(0,7)))].sort().reverse();
    const fmt=new Intl.DateTimeFormat('sv-SE',{month:'long',year:'numeric',timeZone:'UTC'});
    month.replaceChildren(new Option('Alla månader',''),...valid.map(x=>new Option(fmt.format(new Date(x+'-01T00:00:00Z')),x)));
    if(!valid.includes(wantedMonth))wantedMonth='';
    month.value=wantedMonth;
  }
  function renderRows() {
    if(!data)return;
    const searchText=savedTerms?savedTerms.query():query.value;
    const rows=api.search(data,searchText).filter(row=>(!selection||selection===row.series)&&matchMonth(row)&&[...chosen].every(label=>row.terms.includes(label)));
    if(graphView)graphView({scope:matches(),hits:rows,collections:data.collections,chosen,filtering:Boolean(searchText.trim()||chosen.size)},
      JSON.stringify([searchText,selection,wantedMonth,...chosen]));
    if(savedTerms)savedTerms.refresh(rows.length>0);
    status.textContent=rows.length===1?"1 publicerat inlägg":rows.length+" publicerade inlägg";
    if(chosen.size)status.textContent+=" · "+[...chosen].join(" + ");
    results.replaceChildren();
    if (!rows.length) results.append(api.item("p",searchText||chosen.size?"Inga inlägg matchar filtret.":"Inga inlägg är publicerade i den här samlingen."));
    for (const item of rows.slice(0,limit)) results.append(api.card(item,data,"../"));
    if (rows.length>limit) {
      const more=api.item("button","Visa fler inlägg",{type:"button",class:"xr-chronicle-more"});
      more.addEventListener("click",()=>{const index=limit;limit+=12;renderRows();results.querySelectorAll("article h3 a")[index]?.focus();});
      results.append(more);
    }
  }
  function buttons() {
    branches.replaceChildren();
    for (const col of [{id:null,title:"Alla inlägg",count:data.entries.size},...data.collections.values()]) {
      const b=api.item("button",col.title+" · "+col.count,{type:"button",class:"xr-collection-button","aria-pressed":String(selection===col.id)});
      b.addEventListener("click",()=>{
        selection=col.id;chosen.clear();writeFilters();limit=12;
        for(const btn of branches.children)btn.setAttribute("aria-pressed",String(btn===b));
        renderTopics();renderRows();
      });
      branches.append(b);
    }
    renderTopics();
  }
  function renderTopics() {
    const counts=new Map();
    for(const row of matches()) for(const label of row.terms) counts.set(label,(counts.get(label)||0)+1);
    topics.replaceChildren();
    const popular=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"sv")).slice(0,10);
    for(const label of chosen)if(!popular.some(([name])=>name===label))popular.push([label,counts.get(label)||0]);
    for(const [label,count] of popular) {
      const b=api.item("button",label+" · "+count,{type:"button",class:"xr-topic-button","aria-pressed":String(chosen.has(label))});
      b.addEventListener("click",()=>{
        // Keep the pressed button and keyboard focus stable when the first ten labels do not change.
        b.setAttribute('aria-pressed',String(!chosen.has(label)));
        toggleTopic(label);
        [...topics.children].find(button=>button.dataset.label===label)?.focus({preventScroll:true});
      });
      b.dataset.label=label;topics.append(b);
    }
  }
  function get() {
    if (loading || data) return;
    loading=api.load("../").then(value=>{ data=value;if(!data.collections.has(selection))selection=null;restoreTopics();months();buttons();renderRows(); })
      .catch(()=>{
        status.textContent="Redaktionens index kunde inte hämtas.";
        const b=api.item("button","Försök igen",{type:"button",class:"xr-chronicle-more"});
        b.addEventListener("click",()=>{ status.textContent="Läser inläggen …";get(); });
        results.replaceChildren(b);
      }).finally(()=>{loading=null;});
  }
  const sync=()=>{
    const open=location.hash==="#kronikor";panel.hidden=!open;essay.hidden=open;reset.hidden=open;
    document.getElementById('natverkStatus').hidden=open;
    contrast.textContent=open?"Essäer":"Redaktionen";contrast.href=open?"#essaer":"#kronikor";
    if(open){
      if(savedTerms)savedTerms.sync();
      query.value=(new URL(location.href).searchParams.get("cq")||"").slice(0,240);
      wantedMonth=(new URL(location.href).searchParams.get("month")||"").slice(0,7);
      const params=new URL(location.href).searchParams;
      selection=params.get('serie');
      chosen.clear();for(const label of params.getAll('rt'))if(label)chosen.add(label);
      if(data){if(!data.collections.has(selection))selection=null;restoreTopics();months();buttons();}
      get();renderRows();
    }
    if(wasOpen!==open)window.dispatchEvent(new CustomEvent("explorations:networkview"));
    wasOpen=open;
  }
  function updateQuery() {
    const url=new URL(location.href), val=query.value.trim();
    if(val)url.searchParams.set("cq",val);else url.searchParams.delete("cq");
    if(url.href!==location.href)history.replaceState(history.state,"",url);
    limit=12;renderRows();
  }
  month?.addEventListener("change",()=>{
    wantedMonth=month.value;chosen.clear();writeFilters();limit=12;
    const url=new URL(location.href);if(wantedMonth)url.searchParams.set("month",wantedMonth);else url.searchParams.delete("month");
    history.replaceState(history.state,"",url);renderTopics();renderRows();
  });
  document.getElementById('xrGoChronicleSearch')?.addEventListener('click',()=>query.focus());
  query.addEventListener("input",updateQuery);
  query.addEventListener("keydown", event=>{
    if(event.key==="Escape" && query.value) { event.preventDefault();query.value="";updateQuery(); }
  });
  window.addEventListener("popstate",sync);
  contrast.addEventListener("click",()=>requestAnimationFrame(()=>{sync();if(!panel.hidden)title.focus();}));
  window.addEventListener("hashchange",sync);sync();
});
