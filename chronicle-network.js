/* Keep the curated essay graph intact; group chronicles by editorial collection. */
document.addEventListener("DOMContentLoaded",() => {
  "use strict";
  const api=window.ExplorationsChronicles, panel=document.getElementById("kronikor");
  if (!api || !panel) return;
  const essay=document.getElementById("xrEssayNetwork"), contrast=document.getElementById("xrShowChronicles");
  const reset=document.getElementById("natverkAterstall"), title=document.getElementById("xrChronicleTitle");
  const branches=document.getElementById("xrChronicleBranches"), status=document.getElementById("xrChronicleStatus");
  const topics=document.getElementById("xrChronicleTopics"), query=document.getElementById("xrChronicleQuery"), results=document.getElementById("xrChronicleMatches");
  let data, selection=null, term=null, limit=12, loading;
  const matches=()=>[...data.entries.values()].filter(row=>!selection||row.series===selection);
  function renderRows() {
    if(!data)return;
    const rows=api.search(data,query.value).filter(row=>(!selection||selection===row.series)&&(!term||row.terms.includes(term)));
    status.textContent=rows.length===1?"1 publicerat inlägg":rows.length+" publicerade inlägg";
    if(term)status.textContent+=" · "+term;
    results.replaceChildren();
    if (!rows.length) results.append(api.item("p",query.value||term?"Inga inlägg matchar filtret.":"Inga inlägg är publicerade i den här samlingen."));
    for (const item of rows.slice(0,limit)) results.append(api.card(item,data,"../"));
    if (rows.length>limit) {
      const more=api.item("button","Visa fler inlägg",{type:"button",class:"xr-chronicle-more"});
      more.addEventListener("click",()=>{const index=limit;limit+=12;renderRows();results.querySelectorAll("article h3 a")[index]?.focus();});
      results.append(more);
    }
  }
  function buttons() {
    branches.replaceChildren();
    for (const col of [{id:null,title:"Alla krönikor",count:data.entries.size},...data.collections.values()]) {
      const b=api.item("button",col.title+" · "+col.count,{type:"button",class:"xr-collection-button","aria-pressed":String(selection===col.id)});
      b.addEventListener("click",()=>{
        selection=col.id;term=null;limit=12;
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
    for(const [label,count] of [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"sv")).slice(0,10)) {
      const b=api.item("button",label+" · "+count,{type:"button",class:"xr-topic-button","aria-pressed":"false"});
      b.addEventListener("click",()=>{
        term=term===label?null:label;limit=12;
        for(const btn of topics.children)btn.setAttribute("aria-pressed",String(btn===b && term===label));
        renderRows();
      });
      topics.append(b);
    }
  }
  function get() {
    if (loading || data) return;
    loading=api.load("../").then(value=>{ data=value; buttons();renderRows(); })
      .catch(()=>{
        status.textContent="Krönikeindexet kunde inte hämtas.";
        const b=api.item("button","Försök igen",{type:"button",class:"xr-chronicle-more"});
        b.addEventListener("click",()=>{ status.textContent="Läser krönikorna …";get(); });
        results.replaceChildren(b);
      }).finally(()=>{loading=null;});
  }
  const sync=()=>{
    const open=location.hash==="#kronikor";panel.hidden=!open;essay.hidden=open;reset.hidden=open;
    contrast.textContent=open?"Essäer":"Krönikor";contrast.href=open?"#essaer":"#kronikor";
    if(open)get();
  }
  query.addEventListener("input",()=>{limit=12;renderRows();});
  contrast.addEventListener("click",()=>requestAnimationFrame(()=>{sync();if(!panel.hidden)title.focus();}));
  window.addEventListener("hashchange",sync);sync();
});
