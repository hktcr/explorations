const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync, existsSync} = require('node:fs');
const {JSDOM} = require('jsdom');
const text = path => readFileSync(path, 'utf8');
const index = JSON.parse(text('kronikor-index-v2.json'));
const catalog = new Map(index.collections.map(row => [row.id, row]));

test('every editorial page plots only published article tags and preserves the directory destination', () => {
  const {window:w} = new JSDOM('', {runScripts:'outside-only'});
  try {
    w.eval(text('chronicle-topic-graph.js'));
    const plot = w.ExplorationsChronicleTopicGraph.project, seen = new Set();
    for (let page = 0; ; page++) {
      const result = plot(index.entries, index.entries, catalog, new Set(), false, page);
      const articles = result.detail.nodes.filter(node => node.kind === 'article');
      for (const node of articles) {
        assert.ok(!seen.has(node.slug)); seen.add(node.slug);
        const row = index.entries.find(entry => entry.slug === node.slug);
        assert.equal(node.href, row.href);
        assert.ok(existsSync(node.href.split('#')[0]));
        const labels = result.detail.edges.filter(edge => edge.b === node.slug).map(edge => {
          const topic = result.detail.nodes.find(other => other.slug === edge.a);
          assert.equal(topic.kind, 'topic'); return topic.titel;
        });
        assert.deepEqual(Array.from(labels), [...new Set(row.terms.filter(label => label.trim()))]);
      }
      if (page + 1 === result.pages) break;
    }
    assert.equal(seen.size, index.entries.length);
  } finally { w.close(); }
});

test('graph and directory agree when several terms are retained, topics are toggled, or no publication qualifies', async () => {
  const dom = new JSDOM(text('natverk/index.html'), {url:'https://example.test/explorations/natverk/?rc=Norge&rc=Skolstart#kronikor',runScripts:'outside-only'});
  const w = dom.window, d = w.document;
  w.fetch = async () => ({ok:true,json:async () => index});
  try {
    for (const f of ['network-conditions.js','search-engine.js','chronicle-discovery.js','chronicle-topic-graph.js','chronicle-network.js']) w.eval(text(f));
    await new Promise(done => setTimeout(done,40));
    const panel = d.querySelector('#xrTopicCanvas'), frame = d.querySelector('#xrChronicleFrame');
    const graph = frame.contentDocument.createElement('section');
    frame.contentDocument.appendChild(frame.contentDocument.createElement('html')).appendChild(graph);
    graph.id='natverk'; graph.dataset.editorialReady='true';
    let info;
    graph.addEventListener('explorations:editorialgraph', event => {info=event.detail;});
    frame.dispatchEvent(new w.Event('explorations:editorialready'));
    const urls = () => [...d.querySelectorAll('#xrChronicleMatches article a')].map(a => a.getAttribute('href').slice(3));
    const plottedHits = () => Array.from(info.nodes.filter(n => info.hits.includes(n.slug)).map(n => n.href));
    assert.equal(panel.hidden,false);
    assert.equal(info.filtering,true);
    assert.deepEqual(plottedHits(), urls());
    assert.ok(urls().length);
    assert.ok(info.nodes.some(n => n.kind === 'article' && !info.hits.includes(n.slug)));
    assert.equal(d.querySelectorAll('#chronicleTerms button').length,2);
    const topic = info.nodes.find(node => node.titel === 'Skolstart');
    assert.ok(topic);
    frame.dispatchEvent(new w.CustomEvent('explorations:editorialtopic',{detail:topic.titel}));
    assert.match(w.location.search,/rt=Skolstart/);
    assert.deepEqual(plottedHits(), urls());
    const input = d.querySelector('#xrChronicleQuery');
    input.value='qzqzqz'; input.dispatchEvent(new w.Event('input'));
    assert.equal(info.hits.length,0); assert.equal(urls().length,0);
    assert.ok(info.nodes.some(node => node.kind === 'article'));
    d.querySelector('#xrGraphToggle').click();
    assert.equal(panel.hidden,true);
    assert.equal(d.querySelector('#xrChronicleQuery').value,'qzqzqz');
    d.querySelector('#xrGraphToggle').click();
    assert.equal(panel.hidden,false);
  } finally { w.close(); }
});

test('visible published subjects have different, contrasting hues in each theme, including Norway and Ukraine', () => {
  const {window:w} = new JSDOM('',{runScripts:'outside-only'});
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(c => parseInt(c,16)/255)
      .map(c => c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4);
    return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
  };
  const ratio = (a,b) => (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  try {
    w.eval(text('chronicle-topic-graph.js'));
    const project=w.ExplorationsChronicleTopicGraph.project;
    let checkedPair=false;
    for(let p=0;;p++){
      const view=project(index.entries,index.entries,catalog,new Set(),false,p);
      const topics=Array.from(view.detail.nodes).filter(n=>n.kind==='topic');
      const colors=() => topics.map(n=>[n.titel,n.dark,n.light]);
      for(const key of ['dark','light'])assert.equal(new Set(topics.map(n=>n[key])).size,topics.length);
      for(const node of topics) {
        assert.ok(ratio(luminance(node.dark),luminance('#151515'))>=4.5,node.titel+' dark');
        assert.ok(ratio(luminance(node.light),1)>=4.5,node.titel+' light');
      }
      const norway=topics.find(n=>n.titel==='Norge'),ukraine=topics.find(n=>n.titel==='Ukraina');
      if(norway && ukraine){assert.notEqual(norway.dark,ukraine.dark);assert.notEqual(norway.light,ukraine.light);checkedPair=true;}
      const again=project(index.entries,index.entries,catalog,new Set(),false,p);
      assert.deepEqual(Array.from(again.detail.nodes).filter(n=>n.kind==='topic').map(n=>[n.titel,n.dark,n.light]),colors());
      if(p+1===view.pages)break;
    }
    assert.ok(checkedPair);
  } finally {w.close();}
});
