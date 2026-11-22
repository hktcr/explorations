/* Core word cloud, thematic links and article list are complete without JS. */
(() => {
  'use strict';
  const search = document.getElementById('begrepp-search');
  if (!search) return;
  const query = document.getElementById('begrepp-query');
  const status = document.getElementById('begrepp-status');
  const threshold = document.getElementById('begrepp-threshold');
  const minimum = document.getElementById('begrepp-min');
  const number = document.getElementById('begrepp-min-value');
  const chips = Array.from(document.querySelectorAll('[data-concept]'));
  const sections = Array.from(document.querySelectorAll('[data-result]'));
  const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('sv').trim();
  const itemText = new Map(chips.map(el => [el.dataset.concept, fold(el.querySelector('a').firstChild.textContent)]));
  const fromURL = () => sections.some(el => '#' + el.id === location.hash) ? location.hash.slice(5) : '';
  function render() {
    const needle = fold(query.value);
    const least = minimum ? Number(minimum.value) : 1;
    const selected = fromURL();
    const matching = new Set([...itemText].filter(([key, value]) => !needle || value.includes(needle) || key.includes(needle)).map(([key]) => key));
    const visible = new Set();
    let literalVisible = 0;
    chips.forEach(el => {
      const n = Number(el.dataset.literal);
      const key = el.dataset.concept;
      el.hidden = !matching.has(key) || (n > 0 && n < least);
      if (!el.hidden) {
        visible.add(key);
        if (n > 0) ++literalVisible;
      }
      const link = el.querySelector('a');
      if (key === selected) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    sections.forEach(el => {
      el.hidden = needle ? !visible.has(el.dataset.result) : selected ? selected !== el.dataset.result : !visible.has(el.dataset.result);
    });
    let next = '';
    if (minimum) {
      const total = minimum.max;
      number.value = least + ' av ' + total;
      minimum.setAttribute('aria-valuetext', 'Minst ' + least + (least === 1 ? ' ordagrann träff' : ' ordagranna träffar'));
      if (least > 1) next = literalVisible === 1 ? '1 begrepp i ordmolnet.' : literalVisible + ' begrepp i ordmolnet.';
    }
    if (needle) {
      next = visible.size ? (visible.size === 1 ? '1 begrepp matchar.' : visible.size + ' begrepp matchar.') : 'Inget begrepp matchar sökningen och den valda gränsen.';
      if (minimum && least === 1 && !visible.size) next = 'Inget begrepp matchar sökningen.';
    }
    if (status.textContent !== next) status.textContent = next;
  }
  search.hidden = false;
  if (minimum) {
    threshold.hidden = false;
    minimum.addEventListener('input', render);
  }
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
