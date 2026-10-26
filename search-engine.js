(function (root) {
  'use strict';
  const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase('sv');
  const words = value => (normalize(value).match(/[\p{L}\p{M}\p{N}]+/gu) || []);
  function wordSpans(value) {
    // Tokenize compatibility-normalized text like retrieval does, but map every
    // normalized code unit back to the unchanged original text for highlighting.
    const raw=String(value), positions=[];let comparable='',offset=0;
    for(const character of raw){const normalized=character.normalize('NFKC');comparable+=normalized;for(let i=0;i<normalized.length;i++)positions.push({start:offset,end:offset+character.length});offset+=character.length;}
    return Array.from(comparable.matchAll(/[\p{L}\p{M}\p{N}]+/gu),m=>({word:normalize(m[0]),start:positions[m.index].start,end:positions[m.index+m[0].length-1].end}));
  }
  function parseQuery(value) {
    const raw=String(value || '').slice(0,240), clauses=[], seen=new Set();
    const pattern=/"([^"]+)"|([^"\s]+)|"([^"$]*)$/g;
    for (const match of raw.replace(/[“”„]/g,'"').matchAll(pattern)) {
      const tokens=words(match[1] || match[2] || match[3]);
      if (!tokens.length) continue;
      if (match[1]) { const key='phrase:'+tokens.join(' ');if(!seen.has(key)){clauses.push({words:tokens,phrase:true});seen.add(key);} }
      else tokens.forEach(word=>{if(!seen.has(word)){clauses.push({words:[word],phrase:false});seen.add(word);}});
    }
    return {raw,clauses,sequence:clauses.flatMap(c=>c.words),words:[...new Set(clauses.flatMap(c=>c.words))]};
  }
  function phraseCount(tokens, phrase) {
    let count=0;
    for(let i=0;i<=tokens.length-phrase.length;i++) if(phrase.every((w,j)=>tokens[i+j]===w)) count++;
    return count;
  }
  function prepare(data) {
    if (!data || data.schemaVersion!==1 || !Array.isArray(data.articles)) throw new Error('Ogiltigt sökindex');
    const seen=new Set();
    const articles=data.articles.map(a=>{
      if (!a || !/^[a-z0-9-]+$/.test(a.slug) || seen.has(a.slug) || typeof a.title!=='string' || !Array.isArray(a.blocks) || !Array.isArray(a.references)) throw new Error('Ogiltig artikel');
      seen.add(a.slug);
      const fields=[{kind:'title',text:a.title,anchor:'',heading:''},...a.blocks,...a.references.map(r=>({kind:'reference',text:r.title,anchor:r.anchor,heading:'Källreferens',titleSource:r.kind==='metadata-title'?'metadata':'authored'}))];
      fields.forEach(f=>{if(!['title','heading','body','reference'].includes(f.kind)||typeof f.text!=='string'||typeof(f.anchor||'')!=='string')throw new Error('Ogiltigt sökfält');});
      const prepared=fields.map(f=>({...f,tokens:words(f.text)}));
      const lengths={title:0,heading:0,body:0,reference:0};
      prepared.forEach(f=>lengths[f.kind]+=f.tokens.length);
      return {...a,fields:prepared,lengths};
    });
    const averages={};
    for(const kind of ['title','heading','body','reference']) averages[kind]=Math.max(1,articles.reduce((n,a)=>n+a.lengths[kind],0)/Math.max(1,articles.length));
    return {articles,averages};
  }
  function search(index,value) {
    const query=parseQuery(value);
    if (!query.clauses.length) return [];
    const weights={title:6,heading:3,body:1,reference:1.6}, results=[];
    for (const article of index.articles) {
      const found=query.clauses.map(()=>false), fieldHits=[];
      const tf={title:0,heading:0,body:0,reference:0}; let occurrences=0, exactPhrases=0;
      for (const field of article.fields) {
        let hit=0;
        query.clauses.forEach((clause,i)=>{
          let n;
          if(clause.phrase) n=phraseCount(field.tokens,clause.words);
          else n=field.tokens.reduce((sum,w)=>sum+(w===clause.words[0]?1:(clause.words[0].length>=2 && w.startsWith(clause.words[0])?.65:0)),0);
          if(n){found[i]=true;hit+=n;occurrences+=clause.phrase?n:field.tokens.filter(w=>w===clause.words[0]||(clause.words[0].length>=2&&w.startsWith(clause.words[0]))).length;tf[field.kind]+=n;}
          if(clause.phrase) exactPhrases+=n;
        });
        const alreadyQuoted=query.clauses.some(c=>c.phrase && c.words.join(' ')===query.sequence.join(' '));
        const contiguous=query.sequence.length>1&&!alreadyQuoted?phraseCount(field.tokens,query.sequence):0;
        if (hit) fieldHits.push({...field,hit,priority:hit*weights[field.kind]+contiguous*4});
        exactPhrases+=contiguous;
      }
      if (!found.every(Boolean)) continue;
      let score=0;
      for(const kind of Object.keys(weights)) {
        const normalizer=1.2*(.25+.75*article.lengths[kind]/index.averages[kind]);
        score+=weights[kind]*(tf[kind]*2.2/(tf[kind]+normalizer));
      }
      score+=Math.min(4,exactPhrases)*2;
      fieldHits.sort((a,b)=>b.priority-a.priority || a.text.localeCompare(b.text,'sv'));
      results.push({slug:article.slug,id:article.id,title:article.title,subject:article.subject,excerpt:article.excerpt,language:article.language||'',score,occurrences,exactPhrases,hits:fieldHits.slice(0,3),query});
    }
    return results.sort((a,b)=>b.score-a.score || (a.slug<b.slug?-1:a.slug>b.slug?1:0));
  }
  function snippet(text,query,max=230) {
    const plain=String(text||'').replace(/\s+/g,' ').trim(), spans=wordSpans(plain);
    const phraseSpans=[], termSpans=[];
    for(const clause of query.clauses){
      if(clause.phrase){
        for(let i=0;i<=spans.length-clause.words.length;i++)if(clause.words.every((w,j)=>spans[i+j].word===w))phraseSpans.push({start:spans[i].start,end:spans[i+clause.words.length-1].end});
      }else for(const s of spans)if(s.word===clause.words[0]||(clause.words[0].length>=2&&s.word.startsWith(clause.words[0])))termSpans.push(s);
    }
    const matches=[];
    for(const m of [...phraseSpans,...termSpans].sort((a,b)=>a.start-b.start||b.end-a.end)){
      const last=matches[matches.length-1];if(last&&m.start<=last.end)last.end=Math.max(last.end,m.end);else matches.push({start:m.start,end:m.end});
    }
    const focus=phraseSpans[0]||matches[0];
    let start=Math.max(0,(focus?.start||0)-65), end=Math.min(plain.length,Math.max(start+max,focus?.end||0));
    if(start){const boundary=plain.indexOf(' ',start);if(boundary>=0&&boundary<start+25)start=boundary+1;}
    if(end<plain.length){const boundary=plain.lastIndexOf(' ',end);if(boundary>start&&boundary>=(focus?.end||0))end=boundary;}
    const segments=[]; let cursor=start;
    for(const m of matches){if(m.end<=start||m.start>=end)continue;if(m.start>cursor)segments.push({text:plain.slice(cursor,m.start),match:false});segments.push({text:plain.slice(Math.max(cursor,m.start),Math.min(end,m.end)),match:true});cursor=Math.min(end,m.end);}
    if(cursor<end)segments.push({text:plain.slice(cursor,end),match:false});
    if(start)segments.unshift({text:'…',match:false});if(end<plain.length)segments.push({text:'…',match:false});
    return segments;
  }
  const api={normalize,words,wordSpans,parseQuery,phraseCount,prepare,search,snippet};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.ExplorationsSearch=api;
})(typeof window!=='undefined'?window:null);
