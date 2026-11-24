/* The catalogue supplies format membership and explicitly curated reading links. */
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
    const sections = new Map();
    for (const link of page.querySelectorAll('a[data-briefing]')) {
      const href = link.getAttribute('href') || '';
      const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)\/$/.exec(href);
      const title = link.textContent.trim();
      if (!match || !title || seen.has(href)) throw new Error('Ogiltig post i formatkatalogen.');
      seen.add(href);
      const slug = 'briefing-' + match[1];
      nodes.push({slug, titel:title, kind:'article', id:'Briefing', amne:category, href:catalogue+href});
      edges.push({a:nodes[0].slug, b:slug, kind:'format-member', label:'Formattillhörighet', reason:''});
      const related = link.closest('article')?.querySelectorAll('a[data-briefing-related]') || [];
      const targets = new Set();
      for (const other of related) {
        const target = other.getAttribute('href') || '';
        const section = /^\.\.\/([a-z0-9]+(?:-[a-z0-9]+)*)\/index\.html#([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(target);
        const label = other.dataset.briefingRelated.trim();
        const id = other.dataset.essayId || '';
        const name = other.textContent.trim();
        if (!section || !label || !name || !/^EXP#\d+$/.test(id) || targets.has(target)) {
          throw new Error('Ogiltig ämneskoppling i formatkatalogen.');
        }
        targets.add(target);
        if (!sections.has(target)) {
          const node = {slug:'essay-section:' + section[1] + ':' + section[2], titel:name,
            kind:'essay-section', id, amne:'Essäavsnitt', href:target};
          sections.set(target,node);
          nodes.push(node);
        }
        edges.push({a:slug, b:sections.get(target).slug, kind:'briefing-reading', label, reason:'Vidareläsning i ett essäavsnitt.'});
      }
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
  byId('natverk').setAttribute('aria-label','Vetenskaplig briefing och länkade essäavsnitt');
  document.querySelector('.natverk-sidebar').setAttribute('aria-label','Briefingar och nodinformation');
  byId('essaListaTitel').textContent = 'Noder';
  byId('essaAntal').textContent = '0';
  document.querySelector('label.essa-sok span').textContent = 'Sök i kategorin';
  byId('essaSok').placeholder = 'Sök bland kategorins texter';
  byId('essaSokHjalp').textContent = 'Välj en briefing i listan för att se formattillhörighet och eventuell ämneskoppling till ett essäavsnitt.';
  byId('essayRelationHelp').hidden = true;
  const labels = [['legend-nod','Nod'], ['legend-kopplad','Kopplad nod'], ['legend-linje','Koppling']];
  for (const [name, label] of labels) {
    const icon = document.querySelector('.natverk-legend .' + name);
    icon.parentElement.replaceChildren(icon, label);
  }
  byId('relationspanelTom').textContent = 'Välj en nod i listan för att se dess kopplingar. Textnoder i grafen öppnar respektive text.';
  byId('relationspanelTitel').textContent = 'Vald nod';
  byId('relationspanelRelationerTitel').textContent = 'Kopplingar';
  window.ExplorationsBriefingNetwork = {load};
})();
