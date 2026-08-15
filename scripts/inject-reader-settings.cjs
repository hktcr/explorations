const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const version = "20260815-mobile-reader-panel-1";
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const articlePaths = [...index.matchAll(/href="([^"/]+)\/index\.html"/g)]
  .map(match => path.join(root, match[1], "index.html"));

if (articlePaths.length === 0) {
  throw new Error("No published exploration paths found in index.html.");
}

for (const articlePath of articlePaths) {
  let html = fs.readFileSync(articlePath, "utf8");
  html = html.replace(/\s*<link\b[^>]*href="\.\.\/reader-settings\.css[^>]*>\s*/gi, "\n");
  html = html.replace(/\s*<script\b[^>]*src="\.\.\/reader-settings\.js[^>]*><\/script>\s*/gi, "\n");
  const style = `<link rel="stylesheet" href="../reader-settings.css?v=${version}" data-reader-settings-asset="style">`;
  const runtime = `<script src="../reader-settings.js?v=${version}" data-reader-settings-asset="runtime" defer></script>`;
  if (!/<\/head>/i.test(html) || !/<\/body>/i.test(html)) {
    throw new Error(`Missing head or body boundary: ${path.relative(root, articlePath)}`);
  }
  html = html.replace(/<\/head>/i, `${style}\n</head>`);
  html = html.replace(/<\/body>/i, `${runtime}\n</body>`);
  fs.writeFileSync(articlePath, html);
}

console.log(`Unified reader assets injected into ${articlePaths.length} articles.`);
