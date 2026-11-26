(() => {
  const cloud=[...document.querySelectorAll('[data-tag]')], cards=[...document.querySelectorAll('[data-story]')];
  const input=document.getElementById('novell-sok'), status=document.getElementById('count'), svg=document.getElementById('tema-nat');
  if(!input||!svg||!status) return;
  const ns='http://www.w3.org/2000/svg';
  const norm=s=>s.toLocaleLowerCase('sv-SE').normalize('NFD').replace(/\p{Diacritic}/gu,'');
  const candidates=new Set(cloud.map(x=>x.dataset.tag));
  let tag=new URL(location.href).searchParams.get('tag');
  if(!candidates.has(tag)) tag=null;
  let rows=[];
  const node=(kind, attrs={})=>{const e=document.createElementNS(ns,kind);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;};
  function choose(next) {
    tag=tag===next?null:next;
    const u=new URL(location.href);if(tag) u.searchParams.set('tag',tag);else u.searchParams.delete('tag');
    history.replaceState(null,'',u); paint();
  }
  function paint(){
    const q=norm(input.value.trim()).split(/\s+/).filter(Boolean);
    const shown=rows.filter(row=>(!tag||row.tags.includes(tag))&&q.every(x=>row.search.includes(x)));
    const visible=new Set(shown.map(row=>row.slug));
    cards.forEach(card=>{card.hidden=!visible.has(card.dataset.story);});
    cloud.forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.tag===tag)));
    status.textContent=shown.length===1?'1 novell':shown.length+' noveller';
    graph(shown);
  }
  function graph(shown) {
    svg.replaceChildren();
    if(!shown.length)return;
    const terms=[...new Set(shown.flatMap(row=>row.tags))].sort((a,b)=>a.localeCompare(b,'sv'));
    const spine=Math.max(shown.length,terms.length), h=48+spine*40, W=676;
    svg.setAttribute('viewBox','0 0 '+W+' '+h);
    const y=(i,n)=>h/2+(i-(n-1)/2)*40;
    const left=shown.map((row,i)=>({...row,y:y(i,shown.length)}));
    const right=new Map(terms.map((t,i)=>[t,y(i,terms.length)]));
    for(const row of left)for(const t of row.tags)svg.append(node('path',{class:'wire',fill:'none',d:'M266 '+row.y+' C333 '+row.y+', 343 '+right.get(t)+', 410 '+right.get(t)}));
    function add(label,x,Y,href,t) {
      const a=node('a',{href, class:'graph-node'+(t&&tag===t?' active':''),'aria-label':label});
      a.append(node('rect',{x,y:Y-15,width:243,height:30,rx:4}));
      const tx=node('text',{x:x+9,y:Y+5});tx.textContent=label.length>31?label.slice(0,30)+'…':label;a.append(tx);
      const title=node('title');title.textContent=label;a.append(title);
      if(t)a.onclick=e=>{e.preventDefault();choose(t);cloud.find(b=>b.dataset.tag===t)?.focus();};svg.append(a);
    }
    for(const row of left)add(row.title,23,row.y,row.slug+'.html');
    for(const t of terms)add(t,410,right.get(t),'?'+new URLSearchParams({tag:t}),t);
  }
  cloud.forEach(el=>el.addEventListener('click',()=>choose(el.dataset.tag)));
  input.addEventListener('input',paint);
  fetch('index.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{
    rows=data.filter(row=>/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug)).map(row=>({...row,search:norm([row.title,row.deck,...row.tags,...row.paragraphs].join(' '))}));paint();
  }).catch(()=>{status.textContent='Sökningen kunde inte laddas. Novellerna går fortfarande att öppna.';cloud.forEach(el=>el.disabled=true);input.disabled=true;});
})();
