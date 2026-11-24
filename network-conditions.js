/* Share the search-term controls between the essay and editorial networks. */
window.ExplorationsNetworkConditions = function (field, add, list, parameter) {
  const values = new Map();
  const key = term => term.normalize('NFKC').toLocaleLowerCase('sv').replace(/\s+/g,' ').trim();
  function update() {
    const url = new URL(location.href);
    url.searchParams.delete(parameter);
    for (const term of values.values()) url.searchParams.append(parameter, term);
    if (url.href !== location.href) history.replaceState(history.state, '', url);
    field.dispatchEvent(new Event('input', {bubbles:true}));
  }
  function chips() {
    list.replaceChildren();
    list.hidden = !values.size;
    for (const [id, term] of values) {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.textContent = 'Ta bort: '+term;
      button.addEventListener('click', () => { values.delete(id);chips();update();field.focus(); });
      item.append(button);list.append(item);
    }
  }
  function sync() {
    values.clear();
    for (const text of new URL(location.href).searchParams.getAll(parameter)) {
      const term = text.slice(0,240).trim();
      if (term) values.set(key(term),term);
    }
    chips();
  }
  add.addEventListener('click', () => {
    const term = field.value.trim();
    if (!term || add.hidden || values.has(key(term))) return;
    values.set(key(term),term);field.value='';chips();update();field.focus();
  });
  return {
    sync,
    query: () => [...values.values(),field.value].filter(Boolean).join(' '),
    refresh: hasHits => {add.hidden = !field.value.trim() || values.has(key(field.value)) || !hasHits;},
    clear: () => {values.clear();chips();update();}
  };
};
