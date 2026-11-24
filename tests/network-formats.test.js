const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const read = file => fs.readFileSync(file,'utf8');

// An entry-point regression: use the same modules, catalogues and deep link as the portal.
test('portal query, combined types, month, series, selected node, reset and empty projection', async () => {
  const dom = new JSDOM(read('natverk/index.html'), {url:'https://example.test/explorations/natverk/?q=elektricitet',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window, d=w.document;
  try {
    await new Promise(resolve=>setImmediate(resolve));
    w.matchMedia=()=>({matches:true,addEventListener(){}});
    w.requestAnimationFrame=()=>1;
    w.HTMLCanvasElement.prototype.getContext=()=>({setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){}});
    w.HTMLElement.prototype.scrollIntoView=function(){};
    w.fetch=async path=>{
      const file=new URL(path,w.location).pathname.replace('/explorations/','').replace(/\/$/,'/index.html');
      return {ok:true,json:async()=>JSON.parse(read(file)),text:async()=>read(file)};
    };
    for(const script of d.querySelectorAll('script[defer]')) {
      const file=new URL(script.src,w.location).pathname.replace('/explorations/','');
      w.eval(read(file));
    }
    d.dispatchEvent(new w.Event('DOMContentLoaded'));
    const el=id=>d.getElementById(id);
    const byType=kind=>d.querySelectorAll('#natverkNoder [data-node-kind="'+kind+'"]');
    const change=(id,value)=>{el(id).value=value;el(id).dispatchEvent(new w.Event(id==='essaSok'?'input':'change',{bubbles:true}));};
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(el('networkFormats').hidden,false);
    assert.equal(el('essaSok').value,'elektricitet');
    assert.ok(byType('briefing').length>0);
    el('natverkAterstall').click();
    assert.equal(el('networkAll').getAttribute('aria-pressed'),'true');
    assert.equal(byType('essay').length,JSON.parse(read('natverk-index.json')).artiklar.length);
    assert.equal(byType('editorial').length,JSON.parse(read('kronikor-index-v2.json')).entries.length);
    d.querySelector('[value=briefing]').click();
    assert.ok(byType('briefing').length>0);assert.equal(byType('essay').length+byType('editorial').length,0);
    byType('briefing')[0].click();const chosen=el('relationspanelTitel').textContent;
    d.querySelector('[value=editorial]').click();
    assert.equal(el('relationspanelTitel').textContent,chosen);assert.ok(byType('editorial').length);
    assert.equal(byType('essay').length,0);
    change('networkSeries','reportage');
    assert.deepEqual([...byType('editorial')].map(el=>el.dataset.nodeKey.startsWith('reportage-')).filter(b=>!b),[]);
    assert.deepEqual([...d.querySelectorAll('#relationspanelLista .relationspanel-relationstitel')].map(el=>el.textContent),['Vetenskaplig briefing']);
    change('networkMonth','2026-07');
    assert.equal(el('natverkNoder').children.length,0);assert.ok(el('relationspanelInnehall').hidden);
    assert.match(el('essaSokStatus').textContent,/Inga texter/);
    el('natverkAterstall').click();assert.ok(byType('essay').length&&byType('briefing').length&&byType('editorial').length);
    change('essaSok','nonsensordxz');assert.equal(el('natverkNoder').children.length,0);
    assert.equal(d.querySelector('.natverk-huvud-actions a[href="../kallor/"]').href,'https://example.test/explorations/kallor/');
  } finally {dom.window.close();}
});
