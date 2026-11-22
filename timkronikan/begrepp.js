/* The HTML index is complete without JavaScript. This only adds filtering and selection. */
(() => {
  'use strict';
  const search = document.getElementById('begrepp-search');
  if (!search) return;
  const query = document.getElementById('begrepp-query');
  const status = document.getElementById('begrepp-status');
  const chips = Array.from(document.querySelectorAll('[data-concept]'));
  const sections = Array.from(document.querySelectorAll('[data-result]'));
  const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('sv').trim();
  const itemText = new Map(chips.map(el => [el.dataset.concept, fold(el.querySelector('a').firstChild.textContent)]));
  const fromURL = () => sections.some(el => '#' + el.id === location.hash) ? location.hash.slice(5) : '';
  function render() {
    const needle = fold(query.value);
    const selected = fromURL();
    const matching = new Set([...itemText].filter(([key, value]) => !needle || value.includes(needle) || key.includes(needle)).map(([key]) => key));
    chips.forEach(el => {
      el.hidden = !matching.has(el.dataset.concept);
      const link = el.querySelector('a');
      if (el.dataset.concept === selected) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    sections.forEach(el => {
      el.hidden = needle ? !matching.has(el.dataset.result) : Boolean(selected && selected !== el.dataset.result);
    });
    status.textContent = needle ? (matching.size ? (matching.size === 1 ? '1 begrepp matchar.' : matching.size + ' begrepp matchar.') : 'Inget begrepp matchar sökningen.') : '';
  }
  search.hidden = false;
  query.addEventListener('input', render);
  window.addEventListener('hashchange', () => {
    if (fromURL()) query.value = '';
    render();
    if (fromURL()) {
      const target = document.getElementById('ord-' + fromURL());
      requestAnimationFrame(() => { target.focus({preventScroll:true}); target.scrollIntoView({block:'start'}); });
    }
  });
  render();
  if (fromURL()) requestAnimationFrame(() => document.getElementById('ord-' + fromURL()).scrollIntoView({block:'start'}));
})();
