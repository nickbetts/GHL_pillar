// Generates every animated SVG scene into theme/stream/assets/svg and a contact sheet for review.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { svgDoc, ICONS } from './svg-kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '../theme/stream/assets/svg');
fs.mkdirSync(out, { recursive: true });

const batches = [];
for (const f of ['scenes-a.mjs', 'scenes-b.mjs', 'scenes-c.mjs']) {
  if (fs.existsSync(path.join(here, f))) batches.push(Object.values(await import(`./${f}`))[0]);
}

const all = Object.assign({}, ...batches);
const written = [];
for (const [slug, s] of Object.entries(all)) {
  const [w, h] = s.size || [480, 360];
  fs.writeFileSync(path.join(out, `${slug}.svg`), svgDoc({ w, h, title: s.title, body: s.body, css: s.css }));
  written.push(slug);
}
fs.writeFileSync(path.join(here, '../theme/stream/inc/icons.json'), JSON.stringify(ICONS));
console.log(`wrote ${written.length} svgs, ${Object.keys(ICONS).length} icons`);

// Contact sheet (dev only, not shipped in the theme)
const sheet = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#F4F6FF;font:12px system-ui;display:grid;grid-template-columns:repeat(${process.env.COLS || 3},1fr);gap:18px}figure{margin:0;background:#fff;border-radius:18px;padding:10px;box-shadow:0 6px 20px rgba(40,60,150,.08)}figcaption{padding:6px 4px 0;color:#667}svg{width:100%;height:auto;display:block}.a{animation-delay:calc(var(--delay,0s) - var(--t,4s))!important}</style>${written.filter((s) => !process.env.ONLY || process.env.ONLY.split(',').includes(s)).map((s) => `<figure>${fs.readFileSync(path.join(out, s + '.svg'), 'utf8').replace(/<\?xml[^>]*>/, '')}<figcaption>${s}</figcaption></figure>`).join('')}`;
fs.writeFileSync('/tmp/stream-sheet.html', sheet + `<script>document.querySelectorAll('svg').forEach(s=>{try{s.setCurrentTime(${process.env.T || 2.6})}catch(e){}})</script>`);
