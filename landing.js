(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded',function(){
    const chronicles=window.ExplorationsChronicles, engine=window.ExplorationsSearch, input=document.getElementById('searchInput'), grid=document.getElementById('articlesGrid');
    if(!engine || !input || !grid)return; // Unenhanced page remains the existing overview.
    const results=document.getElementById('traffar'), status=document.getElementById('natverkStatus'), form=document.getElementById('searchForm');
    const all=document.getElementById('showAll'), home=document.getElementById('showSearch'), clear=document.getElementById('clearSearch'), retry=document.getElementById('retrySearch');
    const cards=Array.from(grid.querySelectorAll('.article-card')), slugs=cards.map(c=>c.getAttribute('href').split('/')[0]);
    input.placeholder=chronicles?'Sök i essäer, Redaktionen och vetenskapliga briefingar…':'Sök i essäer och vetenskapliga briefingar…';
    const fallback=engine.prepare({schemaVersion:1,articles:cards.map(c=>({slug:c.getAttribute('href').split('/')[0],id:c.dataset.explorationId,title:c.querySelector('.card-title').textContent,subject:c.dataset.subject,excerpt:c.dataset.excerpt,language:c.closest('[lang]')?.lang||'',blocks:[],references:[]}))});
    let index=null, loading=null, broken=false, timer=null, generation=0, mode='home', relations=null;
    const readState=()=>window.explorationsReadFilter?.getState?.() || {hideRead:false,slugs:[]};
    const isHidden=slug=>readState().hideRead && readState().slugs.includes(slug);
    const show=(el,on)=>{el.hidden=!on;el.classList.toggle('dold',!on);};
    function setMode(next){mode=next;document.body.dataset.view=next;show(grid,next==='all');show(results,next==='results');home.hidden=next==='home';clear.hidden=!input.value;}
    function setURL(view,push=false){
      const url=new URL(location.href); const q=input.value.trim();
      if(q)url.searchParams.set('q',q);else url.searchParams.delete('q');
      url.hash=view==='all'?'alla-essaer':'';
      history[push?'pushState':'replaceState']({explorationsView:view},'',url);
    }
    function overview(){
      let visible=0;
      for(const card of cards){const on=!isHidden(card.getAttribute('href').split('/')[0]);show(card,on);if(on)visible++;}
      let empty=grid.querySelector('.no-results');
      if(!visible&&!empty){empty=document.createElement('p');empty.className='no-results';grid.appendChild(empty);}
      if(empty){empty.textContent='Alla essäer är dolda av läsfiltret. Välj Visa lästa för att visa dem.';empty.hidden=!!visible;}
      status.textContent=(readState().hideRead?visible+' av '+cards.length+' essäer visas (lästa dolda).':cards.length+' essäer.')+(relations!==null?' '+relations+' granskade samband.':'');
      all.textContent='Alla essäer ('+cards.length+')';
    }
    function load(){
      if(index)return Promise.resolve(index);if(loading)return loading;
      loading=fetch('landing-search-index.json?v=20261124-briefing-1').then(r=>{if(!r.ok)throw new Error('Index '+r.status);return r.json();}).then(data=>{
        if(data.releaseId!=='20261109-teaching-1'||data.articles?.length!==slugs.length||!slugs.every(s=>data.articles.some(a=>a.slug===s)))throw new Error('Index matchar inte biblioteket');
        const essays=engine.prepare(data);
        let briefings=null;
        try{briefings=engine.prepare({schemaVersion:1,articles:data.briefings});}
        catch{/* Earlier indexes contain only the essay corpus. Keep that search available. */}
        index={essays,briefings};
        broken=false;return index;
      }).catch(error=>{broken=true;throw error;}).finally(()=>{loading=null;});
      return loading;
    }
    function addText(parent,text,tag='span',className,language){const n=document.createElement(tag);if(className)n.className=className;if(language!==undefined)n.lang=language;n.textContent=text;parent.appendChild(n);return n;}
    function render(found,briefings,limited,archive,chronicleFound,chronicleLimited){
      results.replaceChildren();const visible=found.filter(r=>!isHidden(r.slug));
      const total=found.length;
      status.textContent=(readState().hideRead?visible.length+' av '+total+' träffade essäer visas (lästa dolda).':total===1?'1 essä träffad.':total+' essäer träffade.')+(limited?' Fulltextsökningen kunde inte hämtas; endast essätitlar söks.':' Sorterade efter relevans.');
      if(briefings) status.textContent+=' '+(briefings.length===1?'1 träff':briefings.length+' träffar')+' i Vetenskaplig briefing.';
      else if(!limited) status.textContent+=' Sökuppgifter för Vetenskaplig briefing saknas.';
      retry.hidden=!limited && !!briefings;
      if(archive || chronicleLimited) {
        if(chronicleLimited) {
          addText(results,'Redaktionens index kunde inte hämtas. Essäerna kan fortfarande sökas.','p','search-empty');
          retry.hidden=false;
        } else status.textContent+=' '+chronicleFound.length+' träffar i Redaktionen.';
      }
      if(archive && chronicleFound.length) {
        addText(results,'Redaktionen','h2','xr-search-group');
        for(const row of chronicleFound.slice(0,24)) results.appendChild(chronicles.card(row,archive));
        if(chronicleFound.length>24) addText(results,'De första 24 visas. Begränsa sökningen för fler relevanta träffar.','p','result-reason');
      }
      if(briefings?.length){
        addText(results,'Vetenskaplig briefing','h2','xr-search-group');
        renderArticles(briefings,true);
      }
      if(!visible.length){
        if(total || (!chronicleFound?.length && !briefings?.length)) addText(results,total?'Essäträffarna är dolda av läsfiltret. Välj Visa lästa.':'Ingen träff. Prova färre ord eller en annan formulering.','p','search-empty');
        return;
      }
      if(archive || briefings?.length) addText(results,'Essäer','h2','xr-search-group');
      renderArticles(visible,false);
    }
    function renderArticles(found,isBriefing){
      const list=document.createElement('ol');list.className='search-results';results.appendChild(list);
      for(const result of found){
        const item=document.createElement('li');item.className='search-result';list.appendChild(item);
        if(!isBriefing)addText(item,result.id+' · '+result.subject,'p','result-kicker',result.language);
        const href=isBriefing?'vetenskaplig-briefing/'+result.slug+'/':result.slug+'/index.html';
        const heading=document.createElement('h2');item.appendChild(heading);const link=document.createElement('a');link.href=href;link.lang=result.language;link.textContent=result.title;heading.appendChild(link);
        const kinds=[...new Set(result.hits.map(h=>({title:isBriefing?'titel':'essä­titel',heading:'rubrik',body:isBriefing?'text':'essätext',reference:'källtitelrad'})[h.kind]))];
        addText(item,'Träff i '+kinds.join(', ')+(result.occurrences?' · '+result.occurrences+' ord-/frasträffar':''),'p','result-reason');
        const hits=result.hits.filter(h=>h.kind!=='title').slice(0,2);
        if(!hits.length)addText(item,result.excerpt||result.title,'p','result-snippet',result.language);
        for(const hit of hits){
          const p=document.createElement('p');p.className='result-snippet';item.appendChild(p);
          if(hit.kind==='reference')addText(p,hit.titleSource==='metadata'?'Källtitel från bibliografiska metadata: ':'Källtitelrad: ','strong');
          else if(hit.heading)addText(p,hit.heading+' — ','span','snippet-heading',result.language);
          const evidence=document.createElement('span');evidence.className='snippet-evidence';evidence.lang=hit.kind==='reference'?'':result.language;p.appendChild(evidence);
          for(const segment of engine.snippet(hit.text,result.query))addText(evidence,segment.text,segment.match?'mark':'span');
          if(hit.anchor&&/^[\w:.-]+$/.test(hit.anchor)){const jump=document.createElement('a');jump.href=href+'#'+encodeURIComponent(hit.anchor);jump.className='snippet-jump';jump.textContent=hit.kind==='reference'?'Till referensen →':'Till avsnittet →';jump.setAttribute('aria-label',(hit.kind==='reference'?'Till källreferensen':'Till avsnittet')+' i sökträff '+(isBriefing?result.title:result.id)+', utdrag '+(hits.indexOf(hit)+1));p.appendChild(jump);}
        }
      }
    }
    async function run(token){
      const query=input.value.trim();
      if(token!==generation)return;
      if(!query){setMode(mode==='all'?'all':'home');overview();results.replaceChildren();retry.hidden=true;return;}
      setMode('results');retry.hidden=true;status.textContent='Söker…';
      const [essay,chronicle]=await Promise.allSettled([load(),chronicles?chronicles.load():Promise.resolve(null)]);
      const limited=essay.status!=='fulfilled',corpus=limited?fallback:essay.value.essays;
      const archive=chronicle.status==='fulfilled'?chronicle.value:null;
      if(token!==generation || input.value.trim()!==query)return;
      const briefings=!limited && essay.value.briefings ? engine.search(essay.value.briefings,query) : null;
      render(engine.search(corpus,query),briefings,limited,archive,archive?chronicles.search(archive,query):[],chronicle.status==='rejected');
    }
    function schedule(immediate=false){
      clearTimeout(timer);const token=++generation;clear.hidden=!input.value;
      if(input.value.trim()){setMode('results');status.textContent='Söker…';}
      setURL(input.value.trim()?'results':mode==='all'?'all':'home');
      if(immediate)run(token);else timer=setTimeout(()=>run(token),120);
    }
    function navigate(view,push=true){
      clearTimeout(timer);++generation;input.value='';setMode(view);results.replaceChildren();retry.hidden=true;overview();setURL(view,push);
      if(view==='all')document.getElementById('overviewHeading').focus();else input.focus();
    }
    input.addEventListener('input',()=>schedule());
    form.addEventListener('submit',event=>{event.preventDefault();schedule(true);});
    all.addEventListener('click',()=>navigate('all'));
    home.addEventListener('click',()=>navigate('home'));
    clear.addEventListener('click',()=>navigate('home',false));
    retry.addEventListener('click',()=>{if(!index?.briefings)index=null;broken=false;schedule(true);});
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape' && (input.value || mode==='results')){event.preventDefault();navigate('home',false);}
      if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)&&!event.target.isContentEditable){event.preventDefault();input.focus();}
    });
    document.addEventListener('explorations:read-filter-change',()=>{if(mode==='results')schedule(true);else overview();});
    function restore(){clearTimeout(timer);++generation;retry.hidden=true;const url=new URL(location.href);input.value=(url.searchParams.get('q')||'').slice(0,240);setMode(input.value?'results':url.hash==='#alla-essaer'?'all':'home');overview();if(input.value)run(generation);else results.replaceChildren();}
    window.addEventListener('popstate',restore);
    document.body.dataset.searchReady='true';restore();
    fetch('natverk-index.json?v=20261109-teaching-1').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{relations=window.ExplorationsLibraryCore.reviewedRelationCount(data,slugs);if(mode!=='results')overview();}).catch(()=>{});
  });
})();
