(() => {
  'use strict';
  const validId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const collator = new Intl.Collator('sv', {sensitivity: 'base'});

  function read(params) {
    return new Set(params.getAll('tag').filter(id => id.length <= 80 && validId.test(id)));
  }

  function write(params, selected) {
    params.delete('tag');
    for (const id of [...selected].sort()) params.append('tag', id);
    return params;
  }

  function matches(row, selected) {
    const tags = row.tags || [];
    return [...selected].every(id => tags.includes(id));
  }

  function queryText(row, taxonomy) {
    if (!row.tags?.length) return '';
    return (taxonomy || []).filter(tag => row.tags.includes(tag.id))
      .flatMap(tag => [tag.sv, tag.en, ...tag.aliases]).join(' ');
  }

  function cloud(container, rows, taxonomy, selected, onToggle) {
    const active = new Set();
    const totals = new Map();
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.id) || !matches(row, selected)) continue;
      seen.add(row.id);
      for (const id of new Set(row.tags || [])) totals.set(id, (totals.get(id) || 0) + 1);
    }
    const existing = new Map(Array.from(container.querySelectorAll('button[data-tag-id]'),
      button => [button.dataset.tagId, button]));
    const tags = [...(taxonomy || [])];
    for (const id of selected) {
      if (!tags.some(tag => tag.id === id)) tags.push({id, sv: id});
    }
    tags.sort((a, b) => collator.compare(a.sv, b.sv));
    // Keep surviving buttons in place so toggling a filter preserves keyboard focus.
    let position = container.firstElementChild;
    for (const tag of tags) {
      const count = totals.get(tag.id) || 0;
      if (!count && !selected.has(tag.id)) continue;
      const button = existing.get(tag.id) || document.createElement('button');
      active.add(tag.id);
      button.type = 'button';
      button.dataset.tagId = tag.id;
      button.setAttribute('aria-pressed', String(selected.has(tag.id)));
      button.setAttribute('aria-label', tag.sv + ', ' + count + (count === 1 ? ' källa' : ' källor'));
      button.textContent = tag.sv + ' · ' + count;
      button.onclick = () => onToggle(tag.id);
      if (button !== position) container.insertBefore(button, position);
      position = button.nextElementSibling;
    }
    for (const [id, button] of existing) {
      if (!active.has(id)) button.remove();
    }
    container.hidden = active.size === 0;
  }

  globalThis.ExplorationsSourceTags = {read, write, matches, queryText, cloud};
})();
