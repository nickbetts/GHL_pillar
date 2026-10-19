/** Pure helpers for Mockups: password-protected website folders served at /m/<slug>/. */

import crypto from 'crypto';
import { scopedHmac } from '../api/session.js';

export const CHUNK_BYTES = 2 * 1024 * 1024;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_SITE_BYTES = 120 * 1024 * 1024;
export const MAX_FILES = 3000;
export const ACCESS_TTL_SECONDS = 7 * 24 * 3600;
export const MIN_PASSWORD = 6;

export function slugify(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'site';
}
export const makeSlug = (name) => `${slugify(name)}-${crypto.randomBytes(3).toString('hex')}`;
export const validSlug = (slug) => /^[a-z0-9][a-z0-9-]{0,60}$/.test(String(slug || ''));

/** A clean relative path with forward slashes, or null if it could escape the site or is junk. */
export function normalizePath(raw) {
  let p = String(raw ?? '');
  try { p = decodeURIComponent(p); } catch { /* keep as given */ }
  if (p.includes('\0') || p.length > 400) return null;
  const parts = p.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.');
  if (parts.some((s) => s === '..')) return null;
  return parts.join('/');
}

const IGNORED_DIRS = new Set(['.git', 'node_modules', '__macosx', '.svn', '.idea', '.vscode']);
export function shouldIgnore(path) {
  const parts = String(path).split('/');
  const base = parts[parts.length - 1].toLowerCase();
  if (parts.slice(0, -1).some((s) => IGNORED_DIRS.has(s.toLowerCase()))) return true;
  return base === '.ds_store' || base === 'thumbs.db' || base === 'desktop.ini' || base.startsWith('.env');
}

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', map: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8', xml: 'application/xml; charset=utf-8', csv: 'text/csv; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  pdf: 'application/pdf', webmanifest: 'application/manifest+json', wasm: 'application/wasm',
};
export function mimeFor(path) {
  const ext = String(path).split('.').pop().toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}
export const isRewritable = (mime) => /^text\/(html|css)/.test(mime);

/** Root-absolute URLs ("/css/app.css") would escape /m/<slug>/, so point them back inside the site. */
export function rewriteAbsoluteUrls(text, prefix) {
  const withPrefix = (u) => (u.startsWith('/') && !u.startsWith('//') && !u.startsWith(`${prefix}/`) ? `${prefix}${u}` : u);
  return String(text)
    .replace(/(\s(?:src|href|action|poster|data-src|data-href|data-background)\s*=\s*)(["'])(\/(?!\/)[^"']*)\2/gi, (_m, a, q, u) => `${a}${q}${withPrefix(u)}${q}`)
    .replace(/(\ssrcset\s*=\s*)(["'])([^"']*)\2/gi, (_m, a, q, v) => `${a}${q}${v.split(',').map((c) => c.replace(/^(\s*)(\S+)/, (_x, sp, u) => sp + withPrefix(u))).join(',')}${q}`)
    .replace(/url\(\s*(["']?)(\/(?!\/)[^"')\s]*)/gi, (_m, q, u) => `url(${q}${withPrefix(u)}`)
    .replace(/@import\s+(["'])(\/(?!\/)[^"']*)/gi, (_m, q, u) => `@import ${q}${withPrefix(u)}`);
}

/** Which stored path to serve for a request. `has` says whether a path exists in the live version. */
export function pickFile(requestPath, entry, has) {
  const p = normalizePath(requestPath);
  if (p === null) return { type: 'notfound' };
  if (p === '') return has(entry) ? { type: 'file', path: entry } : { type: 'notfound' };
  if (has(p)) return { type: 'file', path: p };
  if (has(`${p}/index.html`)) return { type: 'redirect', path: `${p}/` };
  if (has(`${p}.html`)) return { type: 'file', path: `${p}.html` };
  return { type: 'notfound' };
}
export const candidatePaths = (requestPath, entry) => {
  const p = normalizePath(requestPath);
  if (p === null) return [];
  return p === '' ? [entry, '404.html'] : [p, `${p}/index.html`, `${p}.html`, '404.html'];
};

/** Best entry page for an uploaded set of paths. */
export function pickEntry(paths) {
  if (paths.includes('index.html')) return 'index.html';
  const nested = paths.filter((p) => /(^|\/)index\.html$/.test(p)).sort((a, b) => a.length - b.length);
  if (nested[0]) return nested[0];
  return paths.filter((p) => /\.html?$/i.test(p)).sort((a, b) => a.length - b.length)[0] || 'index.html';
}

// ── Access cookie: proves the viewer entered the right password for this site ──

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fingerprint = (hash) => String(hash || '').slice(0, 12);

export function signAccess(slug, passwordHash, now = Date.now()) {
  const payload = b64url(JSON.stringify({ s: slug, f: fingerprint(passwordHash), e: Math.floor(now / 1000) + ACCESS_TTL_SECONDS }));
  return `${payload}.${scopedHmac('mockup-access', payload)}`;
}

/** Changing the password changes the fingerprint, so every old cookie stops working. */
export function verifyAccess(token, slug, passwordHash, now = Date.now()) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = Buffer.from(scopedHmac('mockup-access', payload));
  const given = Buffer.from(sig || '');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return data.s === slug && data.f === fingerprint(passwordHash) && data.e > Math.floor(now / 1000);
  } catch { return false; }
}

export const accessCookieName = (slug) => `mk_${slug}`;

export function readCookie(req, name) {
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

export function loginPage({ siteName, error = '', slug }) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(siteName)} | Private preview</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F6F6F3;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0B0B0F}
.card{width:min(400px,92vw);padding:34px 30px;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(11,11,15,.08)}
.lock{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:#EEF1FF;color:#4463FF;margin-bottom:16px}
h1{margin:0 0 4px;font-size:20px;letter-spacing:-.01em}p{margin:0 0 20px;color:#5b5f6b;font-size:14px}
input{width:100%;height:44px;padding:0 14px;border:1.5px solid #dfe1e8;border-radius:10px;font:inherit}input:focus{outline:none;border-color:#4463FF;box-shadow:0 0 0 3px rgba(68,99,255,.15)}
button{width:100%;height:44px;margin-top:12px;border:0;border-radius:10px;background:#4463FF;color:#fff;font:inherit;font-weight:600;cursor:pointer}button:hover{background:#3149E8}
.err{margin:10px 0 0;color:#b91c1c;font-size:13px;font-weight:600}.foot{margin-top:18px;text-align:center;color:#9aa0ad;font-size:12px}</style></head>
<body><form class="card" method="POST" action="/m/${esc(slug)}" autocomplete="off"><div class="lock"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>
<h1>${esc(siteName)}</h1><p>This preview is private. Enter the password you were given to view it.</p>
<input type="password" name="password" placeholder="Password" autofocus required aria-label="Password">${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
<button type="submit">View preview</button><div class="foot">Shared by i3MEDIA</div></form></body></html>`;
}

export const notFoundPage = () => '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Not found</title><body style="font:15px system-ui;display:grid;place-items:center;min-height:100vh;background:#F6F6F3;color:#0B0B0F"><div style="text-align:center"><h1 style="font-size:20px">Page not found</h1><p style="color:#5b5f6b">This link may have changed or been removed.</p></div></body>';
