// Primitives + shared animation CSS for the Stream scene generator.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const C = {
  blue: '#4463FF', blue2: '#8FA2FF', blue3: '#DCE3FF', blue4: '#EEF1FF', navy: '#1B2A8F',
  ink: '#1C1C1C', ink2: '#3A3D4A', mute: '#8A8FA3', line: '#E6E9F3', white: '#FFFFFF',
  mint: '#19C8A0', mint2: '#D8F7EE', amber: '#FFB020', amber2: '#FFF1D0',
  pink: '#FF5C8A', pink2: '#FFE1EA', violet: '#8B5CF6', violet2: '#EDE6FF',
};

// Lucide-style 24px stroke icons (inner markup only). Also exported to icons.json for PHP.
export const ICONS = {
  board: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  opportunities: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2 13h20"/>',
  proposals: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l2 2 4-4"/>',
  calls: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.8 19.8 0 0 1 11.2 18.8 19.5 19.5 0 0 1 5.2 12.8 19.8 19.8 0 0 1 2.08 4.11 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.9.34 1.79.65 2.64a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6.27 6.27l1.26-1.26a2 2 0 0 1 2.11-.45c.85.31 1.74.53 2.64.65A2 2 0 0 1 22 16.92z"/>',
  inbound: '<path d="M20 17V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10"/><path d="M4 17h16"/><path d="M12 3v10"/><path d="m8 9 4 4 4-4"/>',
  waves: '<path d="M2 6c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2"/><path d="M2 12c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2"/><path d="M2 18c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2"/>',
  reports: '<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7" rx="1"/><rect x="12" y="6" width="3" height="11" rx="1"/><rect x="17" y="13" width="3" height="4" rx="1"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  market: '<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  podium: '<path d="M9 21V9h6v12"/><path d="M3 21v-7h6"/><path d="M15 21v-5h6v5"/><path d="M2 21h20"/><path d="m12 3 .9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  trophy: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3a2 2 0 0 1-2 3.5"/><path d="M7 5H4a2 2 0 0 0 2 3.5"/>',
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M17 8.5a3 3 0 0 1 0 5"/><path d="M18.5 20a5.2 5.2 0 0 0-2.5-4.4"/>',
  insights: '<path d="M12 3v6"/><path d="M5.6 7.2 9.8 10"/><path d="M18.4 7.2 14.2 10"/><circle cx="12" cy="14" r="7"/><path d="m9 14 2 2 4-4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  campaigns: '<path d="M3 11l19-9-9 19-2-8-8-2z"/>',
  studio: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 13h5M8 16h8"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  plug: '<path d="M9 2v6"/><path d="M15 2v6"/><path d="M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  rocket: '<path d="M12 2c3 2 5 6 5 10l-2 3H9l-2-3c0-4 2-8 5-10z"/><circle cx="12" cy="9" r="1.6"/><path d="M9 15l-3 4 4-1"/><path d="M15 15l3 4-4-1"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  route: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.5"/>',
  dedupe: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  webhook: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 17a10 10 0 1 1 17.4 0"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 5 5 10-10"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lifebuoy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.5 3.5M14.9 14.9l3.5 3.5M18.4 5.6l-3.5 3.5M9.1 14.9l-3.5 3.5"/>',
  news: '<path d="M4 4h13v16H6a2 2 0 0 1-2-2z"/><path d="M17 8h3v10a2 2 0 0 1-2 2"/><path d="M8 8h5M8 12h5M8 16h5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r=".8"/><circle cx="3.5" cy="12" r=".8"/><circle cx="3.5" cy="18" r=".8"/>',
  building: '<rect x="4" y="3" width="10" height="18" rx="1"/><path d="M14 9h6v12h-6"/><path d="M8 7h2M8 11h2M8 15h2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="17" y="14" width="4" height="6" rx="1"/>',
  dollar: '<path d="M12 3v18"/><path d="M16 7.5c-.8-1.2-2.2-2-4-2-2.4 0-4 1.2-4 3s1.6 2.6 4 3 4 1.2 4 3-1.6 3-4 3c-1.8 0-3.2-.8-4-2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  code: '<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m14 5-4 14"/>',
  flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  handshake: '<path d="m11 17 2 2a1.4 1.4 0 0 0 2-2"/><path d="m14 14 2.5 2.5a1.4 1.4 0 0 0 2-2l-3.8-3.8a2.5 2.5 0 0 0-3.5 0L9 13"/><path d="M3 11l4-4 5 1"/><path d="M21 11l-4-4-3.5 1"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
};

// Brand mark (icon only) lifted from the real container logo so scenes stay on-brand.
const containerSvg = fs.readFileSync(path.join(here, '../../brand/stream-container.svg'), 'utf8');
const MARK_PATHS = [...containerSvg.matchAll(/<path d="([^"]+)" fill="white"\/>/g)].map((m) => m[1]);
const CLEAN_SVG = fs.readFileSync(path.join(here, '../../brand/stream-clean.svg'), 'utf8');
export const MARK_BLUE_PATHS = [...CLEAN_SVG.matchAll(/<path d="([^"]+)" fill="#4463FF"\/>/g)].map((m) => m[1]);

const ANIM_CSS = `
.a{transform-box:fill-box;transform-origin:center}.b{transform-origin:50% 100%}.l{transform-origin:0% 50%}.t{transform-origin:50% 0%}.d{stroke-dasharray:1}
.pop{animation:s-pop var(--dur,7s) cubic-bezier(.2,.8,.2,1) var(--delay,0s) infinite both}
.rise{animation:s-rise var(--dur,7s) cubic-bezier(.2,.8,.2,1) var(--delay,0s) infinite both}
.slide{animation:s-slide var(--dur,7s) cubic-bezier(.2,.8,.2,1) var(--delay,0s) infinite both}
.fade{animation:s-fade var(--dur,7s) ease var(--delay,0s) infinite both}
.grow{animation:s-grow var(--dur,7s) cubic-bezier(.2,.8,.2,1) var(--delay,0s) infinite both}
.growx{animation:s-growx var(--dur,7s) cubic-bezier(.2,.8,.2,1) var(--delay,0s) infinite both}
.draw{animation:s-draw var(--dur,7s) ease-in-out var(--delay,0s) infinite both}
.float{animation:s-float var(--dur,4s) ease-in-out var(--delay,0s) infinite alternate}
.ping{animation:s-ping var(--dur,2.4s) ease-out var(--delay,0s) infinite}
.pulse{animation:s-pulse var(--dur,2s) ease-in-out var(--delay,0s) infinite}
.spin{animation:s-spin var(--dur,20s) linear var(--delay,0s) infinite}
.blink{animation:s-blink var(--dur,1.2s) steps(1,end) var(--delay,0s) infinite}
.flow{animation:s-flow var(--dur,1.2s) linear infinite}
.wave{animation:s-wave var(--dur,6s) linear var(--delay,0s) infinite}
.eq{animation:s-eq var(--dur,1s) ease-in-out var(--delay,0s) infinite}
.conv{animation:s-conv var(--dur,6s) linear var(--delay,0s) infinite both}
.twinkle{animation:s-twinkle var(--dur,2.6s) ease-in-out var(--delay,0s) infinite}
.fall{animation:s-fall var(--dur,5s) ease-in var(--delay,0s) infinite both}
.rev{animation-direction:reverse}
@keyframes s-pop{0%{opacity:0;transform:scale(.6)}7%{opacity:1;transform:scale(1.06)}11%{transform:scale(1)}88%{opacity:1;transform:scale(1)}96%,100%{opacity:0;transform:scale(.96)}}
@keyframes s-rise{0%{opacity:0;transform:translateY(var(--dy,16px))}8%{opacity:1;transform:translateY(0)}88%{opacity:1;transform:translateY(0)}96%,100%{opacity:0;transform:translateY(0)}}
@keyframes s-slide{0%{opacity:0;transform:translateX(var(--dx,-24px))}8%{opacity:1;transform:translateX(0)}88%{opacity:1;transform:translateX(0)}96%,100%{opacity:0;transform:translateX(0)}}
@keyframes s-fade{0%{opacity:0}8%{opacity:1}88%{opacity:1}96%,100%{opacity:0}}
@keyframes s-grow{0%{transform:scaleY(0)}18%{transform:scaleY(1)}88%{transform:scaleY(1)}96%,100%{transform:scaleY(0)}}
@keyframes s-growx{0%{transform:scaleX(0)}18%{transform:scaleX(1)}88%{transform:scaleX(1)}96%,100%{transform:scaleX(0)}}
@keyframes s-draw{0%{stroke-dashoffset:1;opacity:1}22%{stroke-dashoffset:0}88%{stroke-dashoffset:0;opacity:1}96%,100%{stroke-dashoffset:0;opacity:0}}
@keyframes s-float{from{transform:translateY(0)}to{transform:translateY(var(--dy,-8px))}}
@keyframes s-ping{0%{opacity:.55;transform:scale(.5)}100%{opacity:0;transform:scale(1.9)}}
@keyframes s-pulse{0%,100%{transform:scale(1)}50%{transform:scale(var(--sc,1.12))}}
@keyframes s-spin{to{transform:rotate(360deg)}}
@keyframes s-blink{0%,45%{opacity:1}55%,100%{opacity:.15}}
@keyframes s-flow{to{stroke-dashoffset:-24}}
@keyframes s-wave{from{transform:translateX(0)}to{transform:translateX(var(--w,-120px))}}
@keyframes s-eq{0%,100%{transform:scaleY(.25)}50%{transform:scaleY(1)}}
@keyframes s-conv{0%{opacity:0;transform:translateX(0)}8%{opacity:1}88%{opacity:1}100%{opacity:0;transform:translateX(var(--dx,240px))}}
@keyframes s-twinkle{0%,100%{opacity:.25;transform:scale(.7)}50%{opacity:1;transform:scale(1.15)}}
@keyframes s-fall{0%{opacity:0;transform:translateY(-20px) rotate(0)}10%{opacity:1}100%{opacity:0;transform:translateY(var(--dy,120px)) rotate(240deg)}}
@media (prefers-reduced-motion:reduce){.a,.flow{animation:none!important}}
`.trim();

const FONT = "'Plus Jakarta Sans',Inter,system-ui,sans-serif";
const n = (v) => Math.round(v * 10) / 10;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const at = (o) => Object.entries(o).map(([k, v]) => (v === undefined || v === null || v === false ? '' : ` ${k}="${v}"`)).join('');

export const rect = (x, y, w, h, r, fill, o = {}) => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${r}" fill="${fill}"${at(o)}/>`;
export const circ = (cx, cy, r, fill, o = {}) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${r}" fill="${fill}"${at(o)}/>`;
export const path_ = (d, o = {}) => `<path d="${d}"${at(o)}/>`;
export const G = (inner, attrs = '') => `<g${attrs ? ` ${attrs}` : ''}>${inner}</g>`;

// A(name, delay, dur, vars) -> class + style attrs for the shared animation lib.
export const A = (name, delay = 0, dur = null, vars = {}) => {
  const v = [`--delay:${delay}s`];
  if (dur) v.push(`--dur:${dur}s`);
  Object.entries(vars).forEach(([k, val]) => v.push(`--${k}:${val}`));
  return `class="a ${name}" style="${v.join(';')}"`;
};

export const card = (x, y, w, h, o = {}) => rect(x, y, w, h, o.r ?? 14, o.fill ?? '#fff', { stroke: o.stroke ?? C.line, 'stroke-width': 1, filter: `url(#${o.sh ?? 's-sh'})`, ...(o.extra || {}) });
export const bar = (x, y, w, h = 6, fill = C.line, o = {}) => rect(x, y, w, h, h / 2, fill, o);
export const text = (x, y, s, o = {}) => `<text x="${n(x)}" y="${n(y)}" font-family="${FONT}" font-size="${o.s ?? 12}" font-weight="${o.w ?? 600}" fill="${o.f ?? C.ink}" text-anchor="${o.a ?? 'start'}"${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${esc(s)}</text>`;
export const avatar = (cx, cy, r, fill, label) => circ(cx, cy, r, fill) + (label ? text(cx, cy + r * 0.34, label, { s: n(r * 0.92), w: 700, f: '#fff', a: 'middle' }) : '');
export const icon = (name, x, y, size = 20, color = C.ink, sw = 2) => `<g transform="translate(${n(x)} ${n(y)}) scale(${n(size / 24)})" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`;
export const chip = (x, y, label, o = {}) => {
  const h = o.h ?? 22;
  const w = o.w ?? Math.round(label.length * (o.s ?? 10.5) * 0.58 + (o.icon ? 30 : 20));
  const ix = o.icon ? 8 : 0;
  return rect(x, y, w, h, h / 2, o.fill ?? C.blue4, o.stroke ? { stroke: o.stroke } : {})
    + (o.icon ? icon(o.icon, x + 7, y + (h - 12) / 2, 12, o.color ?? C.blue, 2.4) : '')
    + text(x + (o.icon ? 22 : w / 2), y + h / 2 + (o.s ?? 10.5) * 0.35, label, { s: o.s ?? 10.5, w: 700, f: o.color ?? C.blue, a: o.icon ? 'start' : 'middle' });
};
export const streamMark = (x, y, size, bg = C.blue) => `<g transform="translate(${n(x)} ${n(y)}) scale(${n(size / 120)})"><rect width="120" height="120" rx="26" fill="${bg}"/>${MARK_PATHS.map((d) => `<path d="${d}" fill="#fff"/>`).join('')}</g>`;
export const markOnly = (x, y, size, fill = C.blue) => `<g transform="translate(${n(x)} ${n(y)}) scale(${n(size / 126)})">${MARK_BLUE_PATHS.slice(0, 3).map((d) => `<path d="${d}" fill="${fill}"/>`).join('')}</g>`;

const DEFS = `<defs>
<filter id="s-sh" x="-20%" y="-20%" width="140%" height="155%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#14143A" flood-opacity=".10"/></filter>
<filter id="s-sh2" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#14143A" flood-opacity=".10"/></filter>
<radialGradient id="s-bg"><stop offset="0" stop-color="#DCE3FF" stop-opacity=".95"/><stop offset="1" stop-color="#EEF1FF" stop-opacity="0"/></radialGradient>
<linearGradient id="s-g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6B83FF"/><stop offset="1" stop-color="#3049E6"/></linearGradient>
<linearGradient id="s-g2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4463FF"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient>
<linearGradient id="s-g3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFB020"/><stop offset="1" stop-color="#FF5C8A"/></linearGradient>
</defs>`;

export function svgDoc({ w = 480, h = 360, title, body, css = '' }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
${DEFS}
<style>${ANIM_CSS}${css ? `\n${css}` : ''}</style>
${body}
</svg>
`;
}

// SMIL packet travelling along a path (kept as SMIL so it also works inside <img>).
export const packet = (d, { r = 4, fill = C.blue, dur = 3, begin = 0, rotate = false } = {}) =>
  `<g><circle r="${r}" fill="${fill}">${rotate ? '' : ''}<animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" path="${d}"${rotate ? ' rotate="auto"' : ''}/></circle></g>`;
export const plane = (d, { fill = C.blue, dur = 4, begin = 0 } = {}) =>
  `<g><path d="M-6 -5 L8 0 L-6 5 L-3 0Z" fill="${fill}"><animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" path="${d}" rotate="auto"/></path></g>`;

export const blob = () => '';

// Attach animation attrs to the first tag of any element string.
export const an = (el, anim) => el.replace(/^<(\w+)/, `<$1 ${anim}`);
// Standard list row: avatar + two text bars.
export const row = (x, y, w, col, o = {}) =>
  rect(x, y, w, 36, 10, o.fill ?? '#fff', o.hi ? { stroke: C.blue, 'stroke-width': 1.5 } : { stroke: C.line })
  + avatar(x + 20, y + 18, 11, col, o.label)
  + bar(x + 38, y + 11, w * 0.45, 7, C.ink2) + bar(x + 38, y + 24, w * 0.3, 5, C.line);
// SMIL transform helper for a group moving between points on a loop.
export const travel = (inner, values, { dur = 7, keyTimes, begin = 0 } = {}) =>
  `<g><animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="${keyTimes}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>${inner}</g>`;
