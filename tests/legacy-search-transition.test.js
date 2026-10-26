const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const runtime = fs.readFileSync(path.join(__dirname, '../reader-settings.js'), 'utf8');
const expression = runtime.match(/const retireLegacySearch = (\(toolbar, content\) => \{[\s\S]*?\n  \});/)[1];

function mark(text, attributes = []) {
  const childNodes = [{textContent: text, savedIdentity: true}];
  const parentNode = {normalizations: 0, normalize() { this.normalizations += 1; }};
  return {textContent: text, attributes, childNodes, parentNode,
    replaceWith(...nodes) { this.replacement = nodes; }
  };
}
function popup() {
  const classes = new Set(['show', 'visible']);
  return {classes, hidden: false, dataset: {}, classList: {remove(...names) { names.forEach(name => classes.delete(name)); }}};
}
function run({id = 'EXP#16', query = 'Berry', focus = true, bare = [], owned = []} = {}) {
  const input = {value: query, disabled: false};
  const oldPopup = popup(), standardPopup = popup();
  const document = {activeElement: focus ? input : {}, getElementById: name => name === 'popup' ? oldPopup : standardPopup};
  const retire = vm.runInNewContext('(' + expression + ')', {document, root: {dataset: {explorationId: id}}});
  const result = retire({querySelector: () => input}, {querySelectorAll: selector => selector === 'mark.search-highlight' ? owned : bare});
  return {result, input, oldPopup, standardPopup};
}

test('fördröjt gemensamt läslager stänger Cranberries gamla popup och bevarar nodidentitet', () => {
  const legacyMark = mark('Berry');
  const nestedAnchor = {id: 'private-comment-anchor', listener: () => true};
  legacyMark.childNodes.push(nestedAnchor);
  const state = run({bare: [legacyMark]});
  assert.equal(state.input.disabled, true);
  assert.equal(state.input.value, '');
  assert.equal(state.oldPopup.hidden, true);
  assert.equal(state.oldPopup.classes.size, 0);
  assert.equal(state.result.query, 'Berry');
  assert.equal(state.result.hadFocus, true);
  assert.equal(legacyMark.replacement[0], legacyMark.childNodes[0]);
  assert.equal(legacyMark.replacement[1], nestedAnchor);
  assert.equal(nestedAnchor.listener(), true);
  assert.equal(legacyMark.parentNode.normalizations, 1);
});

test('övergången rör inte författarmarkeringar, privata markeringar eller andra mallars nakna marks', () => {
  const authored = mark('Berry', [{name: 'class', value: 'authored'}]);
  const privateMark = mark('Berry', [{name: 'data-xr-anchor', value: 'private'}]);
  const unrelated = mark('Other');
  run({bare: [authored, privateMark, unrelated]});
  for (const item of [authored, privateMark, unrelated]) assert.equal(item.replacement, undefined);
  const otherTemplate = mark('Berry');
  const state = run({id: 'EXP#8', bare: [otherTemplate], focus: false});
  assert.equal(otherTemplate.replacement, undefined);
  assert.equal(state.oldPopup.hidden, false);
  assert.equal(state.result.hadFocus, false);
});

test('vanliga gamla sökmarkeringar avvecklas utan att återställa hela artikelns HTML', () => {
  const legacy = mark('Protein', [{name: 'class', value: 'search-highlight'}]);
  const state = run({id: 'EXP#8', query: 'Protein', owned: [legacy]});
  assert.equal(legacy.replacement[0], legacy.childNodes[0]);
  assert.equal(state.standardPopup.hidden, true);
  assert.equal(state.standardPopup.classes.size, 0);
  assert.doesNotMatch(expression, /\.innerHTML\s*=|dispatchEvent|createTextNode/);
});

test('en längre gemensam sökning kan gå över den gamla markeringens textgräns', () => {
  const text = nodeValue => ({nodeValue, parentElement: {}});
  const first = text('cran'), second = text('berries'), third = text(' are red');
  const anchor = {id: 'private-anchor', listener: () => 'preserved'};
  let nodes = [];
  const parentNode = {normalize() {
    // Minimal DOM double for merging adjacent text nodes; element identity stays.
    const merged = [];
    for (const node of nodes) {
      const previous = merged.at(-1);
      if (node.nodeValue !== undefined && previous?.nodeValue !== undefined) previous.nodeValue += node.nodeValue;
      else merged.push(node);
    }
    nodes = merged;
  }};
  const legacy = {attributes: [], textContent: 'cran', childNodes: [first], parentNode,
    replaceWith(...children) { nodes.push(...children, second, third, anchor); }};
  run({query: 'cran', bare: [legacy]});
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].nodeValue, 'cranberries are red');
  assert.equal(nodes[1], anchor);
  assert.equal(anchor.listener(), 'preserved');
  const searchExpression = runtime.match(/const searchWithHighlights = (\(nodes, query\) => \{[\s\S]*?\n  \});/)[1];
  const find = vm.runInNewContext('(' + searchExpression + ')', {
    SEARCH_HIGHLIGHT: 'test', CSS: {highlights: {set() {}}}, Highlight: class {},
    Range: class {setStart(node) {this.startContainer = node;} setEnd() {}}
  });
  const textNodes = nodes.filter(node => node.nodeValue !== undefined);
  assert.equal(find(textNodes, 'cranberries').count, 1);
  assert.equal(find(textNodes, 'cranberries are').count, 1);
});

test('Cranberries författade text innehåller inga nakna mark-element som kan blandas ihop med sökmarkeringar', () => {
  const html = fs.readFileSync(path.join(__dirname, '../cranberries/index.html'), 'utf8');
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/)[1];
  assert.doesNotMatch(article, /<mark\b/i);
});
