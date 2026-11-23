const { test }=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {JSDOM}=require("jsdom");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const script=(w,file)=>w.eval(read(file));
const corpus=()=>JSON.parse(read("kronikor-index.json"));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function setup(html, url, source=corpus(), extra) {
 const dom=new JSDOM(html,{url,runScripts:"outside-only",pretendToBeVisual:true});
 const w=dom.window;
 w.fetch=async url=>({ok:true,json:async()=>url.startsWith("landing-search-index")?JSON.parse(read("landing-search-index.json")):source});
 w.ExplorationsLibraryCore={reviewedRelationCount:()=>51};
 script(w,"search-engine.js");script(w,"chronicle-discovery.js");
 if(extra)script(w,extra);
 return w;
}
test("chronicle search finds explicit concept and uses a stable local exact post link",async()=>{
 const w=setup("<html><body></body></html>","https://example.test/explorations/");
 try{
  const api=w.ExplorationsChronicles, data=await api.load();
  const found=api.search(data,"rättvis omställning");
  assert.equal(found.length,1);
  assert.equal(found[0].title,"Regnrocken utan dragkedja");
  const a=api.card(found[0],data).querySelector("a");
  assert.equal(a.getAttribute('href'),found[0].href);assert.match(found[0].anchorUrl,/2026-11\.html#inlagg-2026-11-22-2100$/);
 }finally{w.close();}
});
test("mismatched host, anchor or index count fail closed",async()=>{
 for(const edit of [
  x=>x.entries[0].href="//outside.test/",
  x=>x.entries[0].anchorUrl+="-wrong",
  x=>x.collections[0].count++
 ]){
  const source=corpus();edit(source);
  const w=setup("<html><body></body></html>","https://example.test/explorations/",source);
  try{await assert.rejects(w.ExplorationsChronicles.load());}finally{w.close();}
 }
});
test("landing preserves search results and displays separate chronicle group",async()=>{
 const w=setup(read("index.html"),"https://example.test/explorations/?q=partierna","", "landing.js");
 const input=w.document.getElementById("searchInput");w.fetch=async url=>({ok:true,json:async()=>url.startsWith("landing-search-index")?JSON.parse(read("landing-search-index.json")):corpus()});
 try{
  await wait(180);
  input.value="partierna";
  input.dispatchEvent(new w.Event("input",{bubbles:true}));
  await wait(240);
  const titles=[...w.document.querySelectorAll(".xr-search-group")].map(e=>e.textContent);
  assert.ok(titles.includes("Krönikor"));
  assert.ok(titles.includes("Essäer"));
  assert.ok(w.document.querySelector(".xr-chronicle-hit a"));
 }finally{w.close();}
});
test("node network only renders collection branches and exposes topic filter without inferred links", async () => {
  const source = corpus();
  const w = setup(read("natverk/index.html"), "https://example.test/explorations/natverk/#kronikor", source, "chronicle-network.js");
  try {
    await wait(75);
    const doc = w.document;
    assert.equal(doc.getElementById("xrEssayNetwork").hidden, true);
    assert.equal(doc.getElementById("kronikor").hidden, false);
    assert.equal(doc.querySelectorAll(".xr-collection-button").length, source.collections.length + 1);

    // Collection summaries are generated separately from the entries used by the view.
    const totals = new Map();
    for (const collection of source.collections) {
      for (const {label, count} of collection.topics) totals.set(label, (totals.get(label) || 0) + count);
    }
    const expected = [...totals].sort(([a, ca], [b, cb]) => cb - ca || a.localeCompare(b, "sv")).slice(0, 10);
    const buttons = [...doc.querySelectorAll(".xr-topic-button")];
    assert.deepEqual(buttons.map(button => button.textContent), expected.map(([label, count]) => label + " · " + count));
    const [selected] = expected[0];
    buttons[0].click();
    assert.equal(buttons[0].getAttribute("aria-pressed"), "true");
    const expectedLinks = source.entries.filter(row => row.terms.includes(selected)).slice(0, 12).map(row => "../" + row.href);
    assert.deepEqual([...doc.querySelectorAll(".xr-chronicle-hit a")].map(link => link.getAttribute("href")), expectedLinks);
  } finally { w.close(); }
});

test("Dricksvatten remains findable when it moves from tenth to eleventh among all topics", async () => {
  const preceding = ["Alger", "Arkeologi", "Atmosfär", "Atom", "Berg", "Björk", "Bok", "Bär", "Dagvatten"];
  const birds = "Fåglar och naturvård";
  function entry(series, time, terms) {
    const anchor = (series === "timkronikan" ? "inlagg" : "halvtimmen") + "-2026-11-22-" + time;
    const folder = series === "timkronikan" ? "timkronikan/" : "timkronikan/halvtimmen/";
    return {
      series, terms, slug: series + "-2026-11-22-" + time, anchor, anchorUrl: folder + "2026-11.html#" + anchor,
      href: "timkronikan/inlagg/" + anchor + ".html", date: "2026-11-22T" + time.slice(0, 2) + ":" + time.slice(2) + "+01:00",
      title: terms[0], excerpt: "", paragraphs: [], references: []
    };
  }
  const water = entry("timkronikan", "2300", ["Dricksvatten"]);
  const original = [water, entry("halvtimmen", "0830", [...preceding, birds])];
  for (const expanded of [false, true]) {
    const entries = expanded ? [...original, entry("halvtimmen", "0900", [birds])] : original;
    const collections = [
      {id:"timkronikan", title:"Timkrönikan", href:"timkronikan/", count:1, topics:[{label:"Dricksvatten", count:1}]},
      {id:"halvtimmen", title:"Halvtimmen", href:"timkronikan/halvtimmen/", count:entries.length-1,
       topics:[...preceding.map(label => ({label,count:1})), {label:birds,count:expanded ? 2 : 1}]}
    ];
    const w = setup(read("natverk/index.html"), "https://example.test/explorations/natverk/#kronikor",
      {schemaVersion:1, entries, collections}, "chronicle-network.js");
    try {
      await wait(75);
      const doc = w.document;
      const button = (selector, name) => [...doc.querySelectorAll(selector)].find(b => b.textContent === name);
      const topics = [...doc.querySelectorAll(".xr-topic-button")].map(b => b.textContent);
      assert.deepEqual(topics, expanded ? [birds + " · 2", ...preceding.map(t => t + " · 1")] :
        [...preceding.map(t => t + " · 1"), "Dricksvatten · 1"]);
      if (expanded) {
        const input = doc.getElementById("xrChronicleQuery");
        input.value = "Dricksvatten";
        input.dispatchEvent(new w.Event("input", {bubbles:true}));
        await wait(240);
        assert.deepEqual([...doc.querySelectorAll(".xr-chronicle-hit a")].map(a => a.getAttribute("href")), ["../" + water.href]);
        input.value = "";
        input.dispatchEvent(new w.Event("input", {bubbles:true}));
        await wait(240);
        button(".xr-collection-button", "Halvtimmen · 2").click();
        const halfLinks = entries.filter(row => row.series === "halvtimmen").map(row => "../" + row.href);
        assert.deepEqual([...doc.querySelectorAll(".xr-chronicle-hit a")].map(a => a.getAttribute("href")), halfLinks);
        assert.equal(button(".xr-topic-button", "Dricksvatten · 1"), undefined);
        button(".xr-collection-button", "Timkrönikan · 1").click();
      }
      const filter = button(".xr-topic-button", "Dricksvatten · 1");
      assert.ok(filter);
      filter.click();
      assert.equal(filter.getAttribute("aria-pressed"), "true");
      assert.deepEqual([...doc.querySelectorAll(".xr-chronicle-hit a")].map(a => a.getAttribute("href")), ["../" + water.href]);
    } finally { w.close(); }
  }
});
