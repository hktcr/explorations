(() => {
  'use strict';
  const nav=document.querySelector('[data-editor-reader]');
  if (!nav) return;
  const q=n=>nav.querySelector('[data-editor-'+n+']');
  const root=new URL('./',document.currentScript.src);
  const screen=document.getElementById('skarm-post');
  const article=document.querySelector('.kr-detail-story');
  const key='redaktionen:snooze:v1', period=45000;
  const idOk=/^(?:inlagg|halvtimmen|reportage)-\d{4}-\d{2}-\d{2}(?:-[0-2]\d[0-5]\d)?$/;
  const monthOk=/^\d{4}-(?:0[1-9]|1[0-2])$/;
  let current=article?.id||screen?.dataset.id, archived=!!article, baseline=null;
  let months=[], cache=new Map(), limit=40, epoch=0, lastOffer='', timer, pending=false, localUntil=0;
  const date=new Intl.DateTimeFormat('sv-SE',{month:'long',year:'numeric',timeZone:'UTC'});
  const live=new URL('skarm.html',root).href;
  const which=id=>id?.match(/\d{4}-\d{2}/)?.[0];
  const reader=id=>new URL('skarm.html?las='+encodeURIComponent(id),root).href;
  const detail=id=>new URL((id.startsWith('reportage-')?'reportage/':'inlagg/')+id+'.html',root).href;
  async function fetchJson(path) {
    const u=new URL(path,root);
    if(u.origin!==location.origin || !u.pathname.startsWith(root.pathname)) throw Error('Ogiltig adress');
    const r=await fetch(u,{cache:'no-store',redirect:'error'});
    if(!r.ok || !/^application\/json\b/i.test(r.headers.get('content-type')||'')) throw Error('Ogiltigt arkiv');
    const raw=await r.text();
    if(raw.length>1400000) throw Error('Arkivet är för stort');
    const body=JSON.parse(raw);
    if(body.schema!==1) throw Error('Ogiltig version');
    return body;
  }
  function link(a,id) {
    if(!id || !idOk.test(id)){a.hidden=true; a.removeAttribute('href');delete a.dataset.id;return;}
    a.href=screen?reader(id):detail(id);a.dataset.id=id;a.hidden=false;
  }
  async function readMonth(month) {
    if(!monthOk.test(month))return [];
    if(!cache.has(month)){
      const d=await fetchJson('visning/'+month+'.json');
      cache.set(month,Array.isArray(d.entries)?d.entries.filter(x=>x && idOk.test(x.id) && x.date?.slice(0,7)===month && typeof x.title==='string' && x.title.length<=240 && typeof x.series==='string' && typeof x.time==='string'):[]);
    }
    return cache.get(month);
  }
  async function render(){
    const token=++epoch, active=which(current), i=months.indexOf(active);
    if(!months.length || !idOk.test(current||'')) return;
    try{
      const [list,here,newer,older]=await Promise.all([readMonth(q('month').value||months[0]),readMonth(active),i>0?readMonth(months[i-1]):[],i>=0&&i+1<months.length?readMonth(months[i+1]):[]]);
      if(token!==epoch)return;
      const at=here.findIndex(x=>x.id===current);
      link(q('newer'),at>=0?(here[at-1]??newer.at(-1))?.id:null);
      link(q('older'),at>=0?(here[at+1]??older[0])?.id:null);
      const frag=document.createDocumentFragment();
      for(const row of list.slice(0,limit)){
        const li=document.createElement('li'),a=document.createElement('a'),small=document.createElement('small');
        link(a,row.id);if(row.id===current)a.setAttribute('aria-current','page');
        small.textContent=row.date.slice(8)+'/'+row.date.slice(5,7)+(row.time?' · '+row.time:'')+' · '+row.series;
        a.append(small,document.createTextNode(row.title));li.append(a);frag.append(li);
      }
      q('items').replaceChildren(frag);q('more').hidden=list.length<=limit;
    }catch(_){/* Generated detail links remain available. */}
  }
  async function init(){
    const data=await fetchJson('visning/index.json');
    months=[...new Set((Array.isArray(data.months)?data.months:[]).filter(x=>monthOk.test(x)))].sort().reverse();
    if(!months.length)return;
    const selected=q('month').value||which(current);
    q('month').replaceChildren(...months.map(x=>{const o=document.createElement('option');o.value=x;o.textContent=date.format(new Date(x+'-01T00:00:00Z'));return o;}));
    q('month').value=months.includes(selected)?selected:months[0];nav.hidden=false;await render();
  }
  const storeBaseline= value=>{try{sessionStorage.setItem('redaktionen:lastSeen',value||'');}catch(_){}};
  const readBaseline=()=>{try{return sessionStorage.getItem('redaktionen:lastSeen')||'';}catch(_){return '';}};
  if(archived || new URL(location.href).searchParams.has('las'))baseline=readBaseline()||null;
  const storageUntil=()=>{try{return Number(localStorage.getItem(key))||0;}catch(_){return 0;}};
  async function check(){
    if(pending)return;
    pending=true;
    try{
      const {entry}=await fetchJson('senaste.json');
      if(!entry || !idOk.test(entry.id) || !entry.id.startsWith('inlagg-') || typeof entry.title!=='string' || entry.title.length>240)return;
      if(baseline===null){baseline=entry.id;storeBaseline(baseline);}
      if(entry.id>baseline){
        if(!cache.has('fresh:'+entry.id)){cache.clear();cache.set('fresh:'+entry.id,true);await init().catch(()=>{});}
        if(archived && entry.id!==lastOffer && Date.now()>=Math.max(localUntil,storageUntil())){
          lastOffer=entry.id;q('notice').hidden=false;q('message').textContent='Nytt i Timmen: '+entry.title;
        }
      }
    }catch(_){}finally{
      pending=false;clearTimeout(timer);
      const left=Math.max(localUntil,storageUntil())-Date.now();
      timer=setTimeout(check,left>0?Math.min(period,left):period);
    }
  }
  q('live').href=live;q('return').href=live;
  nav.addEventListener('click',e=>{
    const a=e.target.closest('a'); if(!screen||!a||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    if(a.dataset.id||a.matches('[data-editor-live],[data-editor-return]')){
      e.preventDefault();const id=a.dataset.id||'';
      history.pushState(null,'',id?reader(id):live);window.dispatchEvent(new CustomEvent('redaktionen:select',{detail:{id}}));
    }
  });
  window.addEventListener('redaktionen:status',e=>{
    if(!screen)return;
    const {id,manual}=e.detail;const changed=id!==current;
    current=id;archived=manual;
    if(!manual){baseline=id;storeBaseline(id);lastOffer='';q('notice').hidden=true;}
    if(changed){q('month').value=months.includes(which(id))?which(id):(months[0]||'');render();}
    if(changed||!manual)check();
  });
  q('month').addEventListener('change',()=>{limit=40;render();});
  q('more').addEventListener('click',()=>{const n=limit;limit+=40;render().then(()=>q('items').querySelectorAll('a')[n]?.focus());});
  q('snooze').addEventListener('click',()=>{
    localUntil=Date.now()+600000;lastOffer='';q('notice').hidden=true;q('live').focus();
    try{localStorage.setItem(key,String(localUntil));}catch(_){}
    clearTimeout(timer);timer=setTimeout(check,600000);
  });
  window.addEventListener('pageshow',e=>{if(e.persisted)check();});
  window.addEventListener('pagehide',()=>clearTimeout(timer));
  init().catch(()=>{}).finally(check);
})();
