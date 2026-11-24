const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const editorial = join(__dirname, '..', 'timkronikan');

function openPage(path) {
  return new JSDOM(readFileSync(join(editorial, path), 'utf8'));
}

test('new individual editions keep the entire figure before the heading in reading order', () => {
  for (const folder of ['inlagg', 'reportage']) {
    for (const file of readdirSync(join(editorial, folder))) {
      if (!file.endsWith('.html') || file === 'index.html') continue;
      const priorReport = folder === 'reportage' && ['2026-11-23-lunch.html', '2026-11-24-varlden.html'].includes(file);
      const slot = file.match(/(\d{4}-\d{2}-\d{2})-(\d{4})\.html$/);
      if (priorReport || (folder === 'inlagg' && (!slot || slot[1] + slot[2] < '2026-11-240700'))) continue;
      const page = openPage(join(folder, file));
      try {
        const { document, Node } = page.window;
        const article = document.querySelector('article');
        const heading = article.querySelector('h1');
        assert(heading && heading.textContent.trim(), file);
        const image = article.querySelector('figure img');
        if (!image) continue;
        const figure = image.closest('figure');
        assert(figure.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING, file);
        assert(figure.querySelector('figcaption') && image.alt.trim(), file);
      } finally { page.window.close(); }
    }
  }
});

test('the server-rendered live opening matches the latest edition and its permanent link', () => {
  const { entry } = JSON.parse(readFileSync(join(editorial, 'senaste.json'), 'utf8'));
  if (!entry) return;
  const page = openPage('skarm.html');
  const detail = openPage('inlagg/' + entry.id + '.html');
  try {
    const opening = page.window.document.querySelector('#skarm-post');
    assert.equal(opening.dataset.id, entry.id);
    assert.equal(opening.querySelector('h1').textContent, entry.title);
    assert.deepEqual([...opening.querySelectorAll('.skarm-lead')].map(p => p.textContent), [entry.paragraphs[0]]);
    assert.equal(opening.querySelector('.skarm-source a').getAttribute('href'), 'inlagg/' + entry.id + '.html');
    assert.equal(detail.window.document.querySelector('h1').textContent, entry.title);
    if (entry.image) {
      assert.equal(opening.querySelector('figure img').alt, entry.image.alt);
      const caption = 'AI-genererad redaktionell illustration.' + (entry.previewCaption ? ' ' + entry.previewCaption : '');
      assert.equal(opening.querySelector('figcaption').textContent, caption);
    }
  } finally { page.window.close(); detail.window.close(); }
});
