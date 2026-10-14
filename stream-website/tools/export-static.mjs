// Exports the running WordPress site (npm run serve) to browsable static HTML in preview/.
// Usage: node tools/export-static.mjs [origin]   (default http://127.0.0.1:9410)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = (process.argv[2] || 'http://127.0.0.1:9410').replace(/\/$/, '');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'preview');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const get = async (u) => { const r = await fetch(u, { redirect: 'follow' }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || '' }; };

const links = new Set(['/']);
for (const kind of ['pages', 'posts']) {
  for (let page = 1; page < 10; page++) {
    const r = await fetch(`${ORIGIN}/wp-json/wp/v2/${kind}?per_page=100&page=${page}&_fields=link`);
    if (!r.ok) break;
    const arr = await r.json();
    if (!arr.length) break;
    arr.forEach((p) => links.add(new URL(p.link).pathname));
  }
}
links.add('/page-that-does-not-exist/');

const assets = new Set();

function toRel(depth, urlPath) {
  const clean = urlPath.split('?')[0].split('#')[0];
  const hash = urlPath.includes('#') ? urlPath.slice(urlPath.indexOf('#')) : '';
  const rel = depth ? '../'.repeat(depth) : './';
  if (/\.(css|js|woff2?|svg|png|jpe?g|gif|webp|ico|json|map|mp4)$/i.test(clean)) { assets.add(clean); return rel + clean.replace(/^\//, ''); }
  if (clean.startsWith('/wp-json') || clean.startsWith('/wp-admin') || clean.endsWith('.php') || clean.includes('xmlrpc') || clean.startsWith('/feed')) return rel + 'index.html';
  return rel + clean.replace(/^\//, '') + (clean.endsWith('/') ? 'index.html' : '/index.html') + hash;
}

let count = 0;
for (const p of links) {
  const is404 = p.includes('page-that-does-not-exist');
  const r = await get(ORIGIN + p);
  if (!r.type.includes('html')) continue;
  const depth = is404 ? 0 : p.split('/').filter(Boolean).length;
  let html = r.buf.toString('utf8');
  html = html.replace(new RegExp(`${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/[^"'\\s)<>]*)?`, 'g'), (_, u) => toRel(depth, u || '/'));
  html = html.replace(/<link[^>]+(rel=["'](?:https:\/\/api\.w\.org\/|EditURI|alternate|shortlink)["'])[^>]*>\n?/g, '');
  const dest = is404 ? path.join(OUT, '404.html') : path.join(OUT, p === '/' ? '' : p, 'index.html');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html);
  count++;
}

// Theme assets are copied straight from source, the rest is fetched from WordPress.
const themeDir = path.join(root, 'theme/stream/assets');
fs.cpSync(themeDir, path.join(OUT, 'wp-content/themes/stream/assets'), { recursive: true });
let fetched = 0;
for (const a of assets) {
  if (a.startsWith('/wp-content/themes/stream/')) continue;
  const r = await get(ORIGIN + a);
  if (r.status !== 200) continue;
  const dest = path.join(OUT, a);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, r.buf);
  fetched++;
}
console.log(`exported ${count} pages, ${fetched} WordPress assets + theme assets -> ${path.relative(process.cwd(), OUT)}`);
