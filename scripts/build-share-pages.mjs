// Rebuilds b/<key>/index.html and sitemap.xml from the BUILDINGS array in index.html.
// Run from the repo root after adding or editing a building:
//   node scripts/build-share-pages.mjs
import fs from "fs";
import path from "path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const a = html.indexOf("const BUILDINGS = [");
const b = html.indexOf("].map((b,i)=>", a);
if (a < 0 || b < 0) throw new Error("BUILDINGS array not found");
const buildings = eval(html.slice(a + "const BUILDINGS = ".length, b + 1));
const eras = {
  eclectic: "אקלקטי",
  intl: "סגנון בינלאומי",
  brutal: "מודרניזם וברוטליזם",
  contemp: "עכשווי",
  future: "בתכנון ובביצוע",
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const urls = ["https://seantassa.github.io/tlv-atlas/"];
const keep = new Set();
for (const bld of buildings) {
  if (!/^[a-z0-9_]+$/.test(bld.k)) throw new Error("unsafe key " + bld.k);
  const dir = path.join(root, "b", bld.k);
  fs.mkdirSync(dir, { recursive: true });
  keep.add(bld.k);
  const year = bld.year ? " · " + bld.year : (bld.era === "future" ? " · בתכנון" : "");
  const desc = `רוב האנשים עוברים ליד ${bld.he} ולא יודעים מי תכנן אותו. ${bld.arch}${year}. ${eras[bld.era] || ""}.`;
  const url = `https://seantassa.github.io/tlv-atlas/b/${bld.k}/`;
  const dest = `/tlv-atlas/?b=${encodeURIComponent(bld.k)}`;
  const page = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(bld.he)} · אדריכלות תל אביבית</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="STS ARCH">
<meta property="og:locale" content="he_IL">
<meta property="og:title" content="${esc(bld.he)} · אדריכלות תל אביבית">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="https://seantassa.github.io/tlv-atlas/promo/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(bld.he)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="https://seantassa.github.io/tlv-atlas/promo/og.jpg">
<meta http-equiv="refresh" content="0;url=${dest}">
</head>
<body>
<p><a href="${dest}">${esc(bld.he)}</a></p>
<script>location.replace(${JSON.stringify(dest)});</script>
</body>
</html>
`;
  fs.writeFileSync(path.join(dir, "index.html"), page);
  urls.push(url);
}
for (const name of fs.readdirSync(path.join(root, "b"))) {
  if (!keep.has(name)) fs.rmSync(path.join(root, "b", name), { recursive: true, force: true });
}
fs.writeFileSync(path.join(root, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u}</loc></url>`).join("\n")}
</urlset>
`);
console.log("share pages", buildings.length);
