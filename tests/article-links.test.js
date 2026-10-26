const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const cwd = path.join(__dirname, '..');

test('alla publicerade fragment och ID kontrolleras; endast dokumenterad EXP8-skuld tolereras', () => {
  const result = spawnSync('python3', ['scripts/audit_article_links.py', '--check-baseline'], {cwd, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /WARNING: two known EXP8 source targets remain unresolved/);
});

test('strikt länkkontroll fortsätter vara röd tills EXP8-källorna faktiskt återställts', () => {
  const result = spawnSync('python3', ['scripts/audit_article_links.py'], {cwd, encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stdout, /"target": "src-14"/);
  assert.match(result.stdout, /"target": "src-15"/);
});

test('fragmentkontrollen upptäcker nya fel, dubbletter och avkodar URL-fragment', () => {
  const code = `from scripts.audit_article_links import inspect_html
missing, duplicate = inspect_html('<p id="å"></p><a href="#%C3%A5">ok</a><a href="#missing">bad</a><i id="same"></i><b id="same"></b>', 'fixture.html')
assert missing == [{"path":"fixture.html", "target":"missing"}]
assert duplicate == [{"path":"fixture.html", "id":"same", "count":2}]
`;
  const result = spawnSync('python3', ['-c', code], {cwd, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
});
