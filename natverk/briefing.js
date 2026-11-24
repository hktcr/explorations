/* Only the published catalogue supplies membership edges in this view. */
(() => {
  'use strict';
  if (new URL(location.href).searchParams.get('format') !== 'vetenskaplig-briefing') return;
  const category = 'Vetenskaplig briefing';
  const catalogue = '../vetenskaplig-briefing/';
  const byId = id => document.getElementById(id);

  async function load() {
    const response = await fetch(catalogue);
    if (!response.ok) throw new Error('Formatkatalogen kunde inte hämtas.');
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    const nodes = [{slug:'vetenskaplig-briefing', titel:category, kind:'category',
      id:'Format', amne:'', href:catalogue}];
    const edges = [];
    const seen = new Set();
    for (const link of page.querySelectorAll('a[data-briefing]')) {
      const href = link.getAttribute('href') || '';
      const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)\/$/.exec(href);
      const title = link.textContent.trim();
      if (!match || !title || seen.has(href)) throw new Error('Ogiltig post i formatkatalogen.');
      seen.add(href);
      const slug = 'briefing-' + match[1];
      nodes.push({slug, titel:title, kind:'article', id:'Briefing', amne:category, href:catalogue+href});
      edges.push({a:nodes[0].slug, b:slug, kind:'format-member', label:'Formattillhörighet', reason:''});
    }
    return {nodes, edges};
  }

  document.title = category + ' · Nodnätverket · Explorations';
  document.querySelector('.natverk-huvud h1').textContent = category;
  const switchView = byId('xrBriefingNetwork');
  switchView.textContent = 'Essäer';
  switchView.setAttribute('href','./');
  byId('xrShowChronicles').setAttribute('href','./#kronikor');
  byId('natverkStatus').textContent = 'Läser formatkatalogen …';
  byId('natverk').setAttribute('aria-label','Kategorin Vetenskaplig briefing och dess texter');
  document.querySelector('.natverk-sidebar').setAttribute('aria-label','Briefingar och nodinformation');
  byId('essaListaTitel').textContent = 'Noder';
  byId('essaAntal').textContent = '0';
  document.querySelector('label.essa-sok span').textContent = 'Sök i kategorin';
  byId('essaSok').placeholder = 'Sök bland kategorins texter';
  byId('essaSokHjalp').textContent = 'Linjen från kategorin till en text visar att texten ingår i formatet.';
  byId('essayRelationHelp').hidden = true;
  const labels = [['legend-nod','Nod'], ['legend-kopplad','Kopplad nod'], ['legend-linje','Formattillhörighet']];
  for (const [name, label] of labels) {
    const icon = document.querySelector('.natverk-legend .' + name);
    icon.parentElement.replaceChildren(icon, label);
  }
  byId('relationspanelTom').textContent = 'Välj kategorin för att se tillhörande texter. En textnod öppnar briefingen.';
  byId('relationspanelTitel').textContent = 'Vald nod';
  byId('relationspanelRelationerTitel').textContent = 'Formattillhörighet';
  window.ExplorationsBriefingNetwork = {load};
})();
