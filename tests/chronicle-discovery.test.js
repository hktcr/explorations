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
test("node network only renders collection branches and exposes topic filter without inferred links",async()=>{
 const w=setup(read("natverk/index.html"),"https://example.test/explorations/natverk/#kronikor",corpus(),"chronicle-network.js");
 try{
  await wait(75);
  assert.equal(w.document.getElementById("xrEssayNetwork").hidden,true);
  assert.equal(w.document.getElementById("kronikor").hidden,false);
  assert.equal(w.document.querySelectorAll(".xr-collection-button").length,corpus().collections.length+1);
  const b=[...w.document.querySelectorAll(".xr-topic-button")].find(x=>x.textContent.startsWith("Dricksvatten · "));
  assert.ok(b);b.click();assert.equal(b.getAttribute("aria-pressed"),"true");
  assert.equal(w.document.querySelectorAll(".xr-chronicle-hit").length,1);
  assert.match(w.document.querySelector(".xr-chronicle-hit a").getAttribute("href"),/^\.\.\/timkronikan\//);
 }finally{w.close();}
});
