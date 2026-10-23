/** Crawls a client's website for brand context: logo, colours, fonts, copy, images, contacts and pages. */
import { parse } from 'parse5';
import { fetchPublic, validateReferenceUrl } from './campaign-reference-crawler.js';

const HTML_BYTES = 1_500_000;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const CSS_BYTES = 600_000;
const MAX_STYLESHEETS = 4;
const PAGE_TEXT_CHARS = 6000;
const TRACKING_IMG = /(?:pixel|tracking|analytics|spacer|1x1|gravatar|facebook\.com\/tr|doubleclick|googletagmanager|hotjar)/i;
const SOCIALS = [
  ['facebook', /facebook\.com/i], ['instagram', /instagram\.com/i], ['linkedin', /linkedin\.com/i], ['x', /(?:twitter|x)\.com/i],
  ['youtube', /youtube\.com|youtu\.be/i], ['tiktok', /tiktok\.com/i], ['pinterest', /pinterest\./i],
];
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', '-apple-system',
  'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica neue', 'helvetica', 'arial', 'noto sans', 'sans', 'apple color emoji', 'segoe ui emoji', 'segoe ui symbol',
  'noto color emoji', 'inherit', 'initial', 'times new roman', 'times', 'courier new', 'courier', 'georgia', 'verdana', 'tahoma', 'liberation sans', 'dashicons', 'fontawesome',
  'font awesome 5 free', 'font awesome 5 brands', 'font awesome 6 free', 'font awesome 6 brands', 'eicons', 'default', 'icons', 'icon', 'fa', 'material icons', 'material symbols outlined', 'star', 'swiper-icons', 'icomoon', 'revicons', 'var']);

export function normalizeSiteUrl(raw) {
  let value = String(raw || '').trim();
  if (!value) throw new Error('Enter the client\u2019s website');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const { url } = validateReferenceUrl(value);
  url.search = '';
  return url;
}

const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value || '';
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
function textOf(node) {
  if (node.nodeName === '#text') return node.value || '';
  if (['script', 'style', 'noscript', 'svg', 'template'].includes(node.tagName)) return '';
  return (node.childNodes || []).map(textOf).join(' ');
}
function serialize(node, depth = 0) {
  if (depth > 40) return '';
  if (node.nodeName === '#text') return (node.value || '').replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
  if (!node.tagName) return '';
  const attrs = (node.attrs || []).filter((a) => !/^on/i.test(a.name)).map((a) => ` ${a.name}="${String(a.value).replace(/"/g, '&quot;')}"`).join('');
  return `<${node.tagName}${attrs}>${(node.childNodes || []).map((c) => serialize(c, depth + 1)).join('')}</${node.tagName}>`;
}
function abs(href, base) {
  try { const u = new URL(href, base); return ['http:', 'https:'].includes(u.protocol) ? u : null; } catch { return null; }
}

// ── Colours ─────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  let h = hex.replace('#', '').toLowerCase();
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6 || /[^0-9a-f]/.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
export const rgbToHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
function hsl([r, g, b]) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B); const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}
function parseColor(raw) {
  const v = String(raw).trim().toLowerCase();
  if (v.startsWith('#')) return hexToRgb(v);
  const m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    if (m[4] != null) { const a = m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]); if (a < 0.6) return null; }
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return null;
}
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

/** Scores colours found in CSS text. Brand-ish declarations (buttons, links, custom properties) count more. */
export function scoreCss(css, tally, weight = 1) {
  const text = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let rule;
  let found = false;
  while ((rule = ruleRe.exec(text))) {
    found = true;
    const selector = rule[1].toLowerCase();
    const body = rule[2];
    const boost = /btn|button|cta|primary|accent|brand|highlight|nav|header|a:hover|\ba\b|link|badge|hero/.test(selector) ? 3 : 1;
    for (const decl of body.split(';')) {
      const [prop, ...rest] = decl.split(':');
      if (!rest.length) continue;
      const p = prop.trim().toLowerCase();
      const value = rest.join(':');
      if (!/color|background|border|fill|stroke|^--/.test(p)) continue;
      const vboost = /^--.*(primary|brand|accent|secondary|main|theme)/.test(p) ? 8 : (p.startsWith('--') ? 2 : 1);
      for (const c of value.match(COLOR_RE) || []) addColor(tally, c, weight * boost * vboost);
    }
  }
  if (!found) for (const c of text.match(COLOR_RE) || []) addColor(tally, c, weight);
}
// Framework defaults (Bootstrap, WordPress block palette) are rarely the brand, so they count for very little.
const FRAMEWORK_COLORS = new Set(['#0d6efd', '#6c757d', '#198754', '#0dcaf0', '#ffc107', '#dc3545', '#f8f9fa', '#212529', '#6610f2', '#6f42c1', '#d63384', '#fd7e14', '#20c997',
  '#e9ecef', '#007bff', '#28a745', '#17a2b8', '#343a40', '#cf2e2e', '#ff6900', '#fcb900', '#7bdcb5', '#00d084', '#8ed1fc', '#0693e3', '#9b51e0', '#abb8c3', '#f78da7',
  '#0a58ca', '#157347', '#bb2d3b', '#ffca2c', '#31d2f2', '#5c636a', '#86b7fe', '#3d8bfd', '#e685b5', '#a370f7', '#b02a37', '#146c43']);
function addColor(tally, raw, weight) {
  const rgb = parseColor(raw);
  if (!rgb) return;
  const hex = rgbToHex(rgb);
  const w = FRAMEWORK_COLORS.has(hex) ? weight * 0.04 : weight;
  tally.set(hex, (tally.get(hex) || 0) + w);
}
const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

/** Brand colours (saturated, clustered) and neutrals from a colour tally. */
export function pickPalette(tally) {
  const entries = [...tally.entries()].map(([hex, w]) => ({ hex, w, rgb: hexToRgb(hex) })).filter((e) => e.rgb).sort((a, b) => b.w - a.w);
  const brand = [];
  const neutrals = [];
  for (const e of entries) {
    const { s, l } = hsl(e.rgb);
    const isNeutral = s < 0.14 || l > 0.94 || l < 0.07;
    const bucket = isNeutral ? neutrals : brand;
    const near = bucket.find((b) => dist(b.rgb, e.rgb) < 38);
    if (near) near.w += e.w; else bucket.push({ ...e });
  }
  brand.sort((a, b) => b.w - a.w);
  neutrals.sort((a, b) => b.w - a.w);
  const dark = neutrals.filter((n) => hsl(n.rgb).l < 0.3)[0]?.hex || '#111827';
  const light = neutrals.filter((n) => hsl(n.rgb).l > 0.9)[0]?.hex || '#ffffff';
  return { colors: brand.slice(0, 6).map((b) => b.hex), dark, light };
}

// ── Fonts ───────────────────────────────────────────────────────────────────
export function fontsFromCss(css, tally) {
  for (const m of String(css || '').matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const first = m[1].split(',')[0].replace(/["']/g, '').replace(/!important/i, '').trim();
    if (first && !GENERIC_FONTS.has(first.toLowerCase()) && !first.startsWith('var(') && first.length < 40) tally.set(first, (tally.get(first) || 0) + 1);
  }
}
export function fontsFromGoogleHref(href) {
  try {
    const u = new URL(href);
    if (!/fonts\.googleapis\.com/.test(u.hostname)) return [];
    const fam = u.searchParams.getAll('family');
    return fam.flatMap((f) => f.split('|')).map((f) => f.split(':')[0].replace(/\+/g, ' ').trim()).filter(Boolean);
  } catch { return []; }
}

// ── HTML parsing ────────────────────────────────────────────────────────────
export function parseBrandHtml(html, pageUrl) {
  const doc = parse(String(html || ''));
  const base = pageUrl;
  const out = {
    title: '', description: '', siteName: '', themeColor: '', icons: [], logoCandidates: [], styles: [], inlineStyles: [], stylesheets: [], googleFonts: [],
    headings: [], paragraphs: [], navLinks: [], links: [], images: [], phones: [], emails: [], socials: [], testimonials: [], ctas: [], jsonLd: [],
    checks: { viewport: false, h1: 0, imgs: 0, imgsNoAlt: 0, scripts: 0, copyrightYear: null },
  };
  const stack = [];
  const walk = (node) => {
    const tag = node.tagName;
    if (tag) stack.push(node);
    const inHeader = stack.some((n) => n.tagName === 'header' || n.tagName === 'nav' || /header|navbar|masthead|site-nav|menu/i.test(attr(n, 'class') + attr(n, 'id')));
    const inFooter = stack.some((n) => n.tagName === 'footer' || /footer/i.test(attr(n, 'class') + attr(n, 'id')));
    if (tag === 'title') out.title = clean(textOf(node));
    if (tag === 'meta') {
      const key = (attr(node, 'property') || attr(node, 'name')).toLowerCase();
      const content = attr(node, 'content');
      if (key === 'description' || key === 'og:description') out.description = out.description || clean(content);
      if (key === 'og:site_name' || key === 'application-name') out.siteName = out.siteName || clean(content);
      if (key === 'theme-color') out.themeColor = content;
      if (key === 'viewport' && /width\s*=\s*device-width/i.test(content)) out.checks.viewport = true;
      if (key === 'og:image') { const u = abs(content, base); if (u) out.images.push({ url: u.href, alt: 'og', og: true }); }
    }
    if (tag === 'link') {
      const rel = attr(node, 'rel').toLowerCase();
      const href = attr(node, 'href');
      const u = abs(href, base);
      if (u && rel.includes('stylesheet')) { out.stylesheets.push(u.href); out.googleFonts.push(...fontsFromGoogleHref(u.href)); }
      if (u && /icon/.test(rel)) out.icons.push({ url: u.href, rel, sizes: attr(node, 'sizes') });
    }
    if (tag === 'style') out.styles.push(textOf({ childNodes: node.childNodes }) || (node.childNodes || []).map((c) => c.value || '').join(''));
    if (tag && attr(node, 'style')) out.inlineStyles.push(`x{${attr(node, 'style')}}`);
    if (tag === 'script' && /ld\+json/i.test(attr(node, 'type'))) {
      try { out.jsonLd.push(JSON.parse((node.childNodes || []).map((c) => c.value || '').join(''))); } catch { /* ignore bad JSON-LD */ }
    }
    if (tag === 'h1') out.checks.h1 += 1;
    if (tag === 'script' && attr(node, 'src')) out.checks.scripts += 1;
    if (tag === 'img') { out.checks.imgs += 1; if (!attr(node, 'alt').trim()) out.checks.imgsNoAlt += 1; }
    if (node.nodeName === '#text' && inFooter) {
      const y = /(?:©|&copy;|copyright)\D{0,12}(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/i.exec(node.value || '');
      if (y) out.checks.copyrightYear = Number(y[1]);
    }
    if (/^h[1-4]$/.test(tag || '') && !inFooter) { const t = clean(textOf(node)); if (t && t.length < 200) out.headings.push(t); }
    if ((tag === 'p' || tag === 'li') && !inHeader) { const t = clean(textOf(node)); if (t.length > 30 && t.length < 1200) out.paragraphs.push(t); }
    if (tag === 'blockquote' || /testimonial|review|quote/i.test(attr(node, 'class'))) {
      const t = clean(textOf(node));
      if (t.length > 40 && t.length < 900) out.testimonials.push(t);
    }
    if (tag === 'a') {
      const href = attr(node, 'href');
      const label = clean(textOf(node)) || attr(node, 'aria-label') || attr(node, 'title');
      if (/^tel:/i.test(href)) out.phones.push(decodeURIComponent(href.slice(4)).replace(/[^\d+ ]/g, '').trim());
      else if (/^mailto:/i.test(href)) out.emails.push(href.slice(7).split('?')[0].trim());
      else {
        const u = abs(href, base);
        if (u) {
          const social = SOCIALS.find(([, re]) => re.test(u.hostname));
          if (social && !/share|intent|sharer/.test(u.href)) out.socials.push({ network: social[0], url: u.href });
          out.links.push({ url: u.href, label: label.slice(0, 80), inHeader, inFooter });
          if (inHeader && label && label.length < 40) out.navLinks.push({ url: u.href, label });
          if (/btn|button|cta/i.test(attr(node, 'class')) && label && label.length < 50) out.ctas.push(label);
        }
      }
    }
    if (tag === 'button') { const t = clean(textOf(node)); if (t && t.length < 50) out.ctas.push(t); }
    if (tag === 'img') {
      const src = attr(node, 'src') || attr(node, 'data-src') || attr(node, 'data-lazy-src') || (attr(node, 'srcset') || attr(node, 'data-srcset')).split(',').pop()?.trim().split(/\s+/)[0] || '';
      const u = abs(src, base);
      const hint = `${src} ${attr(node, 'alt')} ${attr(node, 'class')} ${attr(node, 'id')}`;
      const parentHint = stack.slice(-3).map((n) => `${attr(n, 'class')} ${attr(n, 'id')}`).join(' ');
      if (u && !TRACKING_IMG.test(u.href) && !u.href.startsWith('data:')) {
        const w = Number.parseInt(attr(node, 'width'), 10) || 0;
        const h = Number.parseInt(attr(node, 'height'), 10) || 0;
        if (/logo/i.test(hint) || (inHeader && /logo|brand/i.test(parentHint))) out.logoCandidates.push({ url: u.href, score: (inHeader ? 5 : 1) + (/logo/i.test(hint) ? 4 : 0), alt: attr(node, 'alt') });
        else if ((!w || w >= 160) && (!h || h >= 100)) out.images.push({ url: u.href, alt: clean(attr(node, 'alt')).slice(0, 140), w, h });
      }
    }
    if (tag === 'svg' && inHeader && /logo|brand/i.test(`${attr(node, 'class')} ${attr(node, 'id')} ${stack.slice(-4).map((n) => `${attr(n, 'class')} ${attr(n, 'id')}`).join(' ')}`)) {
      const markup = serialize(node);
      if (markup.length < 30000 && !/<script/i.test(markup)) out.logoCandidates.push({ svg: markup, score: 6 });
    }
    for (const c of node.childNodes || []) walk(c);
    if (node.content) walk(node.content);
    if (tag) stack.pop();
  };
  walk(doc);
  // Structured data: logo, name, phone, address, sameAs.
  const ld = out.jsonLd.flatMap((x) => (Array.isArray(x) ? x : x?.['@graph'] ? x['@graph'] : [x])).filter((x) => x && typeof x === 'object');
  const org = ld.find((x) => /Organization|LocalBusiness|Corporation|Store|Restaurant|Service|Professional/i.test(String(x['@type'] || '')));
  out.org = null;
  if (org) {
    const logo = typeof org.logo === 'string' ? org.logo : org.logo?.url;
    const lu = logo && abs(logo, base);
    if (lu) out.logoCandidates.push({ url: lu.href, score: 9 });
    const a = org.address;
    out.org = {
      name: clean(org.name),
      phone: clean(org.telephone),
      email: clean(org.email),
      address: typeof a === 'string' ? clean(a) : a ? clean([a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean).join(', ')) : '',
      sameAs: Array.isArray(org.sameAs) ? org.sameAs.filter((s) => typeof s === 'string') : [],
    };
  }
  return out;
}

const PAGE_PRIORITY = /service|solution|product|what-we-do|work|portfolio|project|case|about|our-story|team|pricing|price|menu|treatment|courses|sectors|industr|areas|locations|gallery/i;
const PAGE_EXCLUDE = /login|logout|signin|sign-in|register|privacy|cookie|terms|legal|search|cart|basket|checkout|account|wp-admin|wp-login|feed|author|category|tag\/|\?|\.(?:pdf|zip|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|svg|mp4|mp3)$/i;

export function rankPages(homeUrl, parsed) {
  const origin = new URL(homeUrl).origin;
  const seen = new Map();
  const add = (link, score) => {
    let u;
    try { u = new URL(link.url); } catch { return; }
    if (u.origin !== origin) return;
    u.hash = '';
    u.search = '';
    const key = u.href.replace(/\/$/, '');
    if (key === origin || key === homeUrl.replace(/\/$/, '') || PAGE_EXCLUDE.test(u.pathname)) return;
    if (u.pathname.split('/').filter(Boolean).length > 3) score -= 2;
    const prev = seen.get(key);
    const s = score + (PAGE_PRIORITY.test(u.pathname + ' ' + link.label) ? 4 : 0) + (/blog|news|post|article|\d{4}\//i.test(u.pathname) ? -3 : 0);
    if (!prev || prev.score < s) seen.set(key, { url: u.href, label: link.label || prev?.label || '', score: s });
  };
  for (const l of parsed.navLinks) add(l, 6);
  for (const l of parsed.links) add(l, l.inFooter ? 0 : 1);
  return [...seen.values()].sort((a, b) => b.score - a.score);
}

function pageSummary(url, parsed) {
  const text = [...new Set([...parsed.headings, ...parsed.paragraphs])].join('\n').slice(0, PAGE_TEXT_CHARS);
  return {
    url, path: new URL(url).pathname || '/', title: parsed.title.slice(0, 160), description: parsed.description.slice(0, 400),
    headings: [...new Set(parsed.headings)].slice(0, 24), text,
  };
}

function pickLogo(cands, icons, origin) {
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  const seen = new Set();
  const unique = sorted.filter((c) => { const k = c.url || c.svg.slice(0, 200); if (seen.has(k)) return false; seen.add(k); return true; });
  const touch = icons.find((i) => /apple-touch/.test(i.rel)) || icons.sort((a, b) => (Number.parseInt(b.sizes, 10) || 0) - (Number.parseInt(a.sizes, 10) || 0))[0];
  return { logo: unique[0] || null, candidates: unique.slice(0, 6), icon: touch?.url || `${origin}/favicon.ico` };
}

/**
 * Crawl the homepage plus the best internal pages. Returns a brand object for the brand board and the AI.
 * @param {string} inputUrl
 */
export async function crawlSite(inputUrl, { fetcher = (url, opts) => fetchPublic(url, { ...opts, userAgent: BROWSER_UA }), maxPages = 12, budgetMs = 40_000 } = {}) {
  const started = Date.now();
  const deadline = started + budgetMs;
  const home = normalizeSiteUrl(inputUrl);
  let homeRes;
  const fetchStarted = Date.now();
  try {
    homeRes = await fetcher(home.href, { accept: 'text/html,application/xhtml+xml', maxBytes: HTML_BYTES, deadline: Math.min(deadline, Date.now() + 15000) });
  } catch (error) {
    throw new Error(`Couldn't open ${home.hostname}: ${error.message}`);
  }
  const loadMs = Date.now() - fetchStarted;
  const homeUrl = homeRes.url || home.href;
  const homeHtml = homeRes.bytes.toString('utf8');
  const parsed = parseBrandHtml(homeHtml, homeUrl);
  const colorTally = new Map();
  const fontTally = new Map();
  if (parsed.themeColor) addColor(colorTally, parsed.themeColor, 30);
  for (const css of parsed.styles) { scoreCss(css, colorTally, 2); fontsFromCss(css, fontTally); }
  for (const css of parsed.inlineStyles.slice(0, 400)) { scoreCss(css, colorTally, 1); fontsFromCss(css, fontTally); }

  // Stylesheets (skip big framework/CDN sheets that would drown the brand colours).
  const sheets = parsed.stylesheets.filter((h) => !/fonts\.googleapis|font-awesome|fontawesome|bootstrap(?:\.min)?\.css|cdnjs|jsdelivr|unpkg|wp-includes\/css|block-library|dashicons|elementor\/assets\/lib/i.test(h)).slice(0, MAX_STYLESHEETS);
  const pageCandidates = rankPages(homeUrl, parsed).slice(0, maxPages - 1);
  const sheetJobs = sheets.map(async (href) => {
    try {
      const r = await fetcher(href, { accept: 'text/css,*/*', maxBytes: CSS_BYTES, deadline: Math.min(deadline, Date.now() + 8000) });
      const css = r.bytes.toString('utf8');
      scoreCss(css, colorTally, 1);
      fontsFromCss(css, fontTally);
      for (const m of css.matchAll(/@import\s+url\(["']?([^"')]+)["']?\)/g)) parsed.googleFonts.push(...fontsFromGoogleHref(m[1]));
    } catch { /* a missing stylesheet is fine */ }
  });

  // Pages, four at a time, until the budget runs out.
  const pages = [pageSummary(homeUrl, parsed)];
  const extraImages = [];
  const extraTestimonials = [];
  const extraPhones = [];
  const extraEmails = [];
  const queue = [...pageCandidates];
  const worker = async () => {
    while (queue.length && Date.now() < deadline - 2500) {
      const cand = queue.shift();
      try {
        const r = await fetcher(cand.url, { accept: 'text/html,application/xhtml+xml', maxBytes: HTML_BYTES, deadline: Math.min(deadline, Date.now() + 9000) });
        if (!/html/i.test(String(r.headers?.['content-type'] || 'text/html'))) continue;
        const p = parseBrandHtml(r.bytes.toString('utf8'), r.url || cand.url);
        pages.push({ ...pageSummary(r.url || cand.url, p), navLabel: cand.label });
        extraImages.push(...p.images.slice(0, 8).map((i) => ({ ...i, page: new URL(r.url || cand.url).pathname })));
        extraTestimonials.push(...p.testimonials);
        extraPhones.push(...p.phones);
        extraEmails.push(...p.emails);
        for (const css of p.styles.slice(0, 3)) scoreCss(css, colorTally, 1);
      } catch { /* skip pages that fail */ }
    }
  };
  await Promise.all([...sheetJobs, worker(), worker(), worker(), worker()]);

  const { colors, dark, light } = pickPalette(colorTally);
  const fonts = [...new Set([...parsed.googleFonts, ...[...fontTally.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f)])].slice(0, 4);
  const origin = new URL(homeUrl).origin;
  const { logo, candidates, icon } = pickLogo(parsed.logoCandidates, parsed.icons, origin);
  const imageMap = new Map();
  for (const img of [...parsed.images.map((i) => ({ ...i, page: '/' })), ...extraImages]) if (!imageMap.has(img.url)) imageMap.set(img.url, img);
  const socials = new Map();
  for (const s of [...parsed.socials, ...(parsed.org?.sameAs || []).map((url) => ({ network: (SOCIALS.find(([, re]) => re.test(url)) || ['web'])[0], url }))]) if (!socials.has(s.network)) socials.set(s.network, s.url);
  const host = new URL(homeUrl).hostname.replace(/^www\./, '');
  const guessName = parsed.org?.name || parsed.siteName || (parsed.title.split(/\s[|\-–—:]\s/).map(clean).filter(Boolean).sort((a, b) => a.length - b.length)[0]) || host;

  return {
    url: homeUrl, origin, host,
    name: guessName.slice(0, 80),
    title: parsed.title, description: parsed.description,
    logo: logo ? (logo.url ? { url: logo.url } : { svg: logo.svg }) : null,
    logoCandidates: candidates.map((c) => (c.url ? { url: c.url } : { svg: c.svg })),
    icon,
    colors: colors.length ? colors : ['#2563eb'],
    dark, light,
    fonts,
    nav: [...new Map(parsed.navLinks.map((l) => [l.url, l])).values()].slice(0, 12).map((l) => ({ label: l.label, url: l.url })),
    pages: pages.slice(0, maxPages),
    images: [...imageMap.values()].slice(0, 40),
    contact: {
      phones: [...new Set([parsed.org?.phone, ...parsed.phones, ...extraPhones].filter(Boolean))].slice(0, 3),
      emails: [...new Set([parsed.org?.email, ...parsed.emails, ...extraEmails].filter(Boolean))].slice(0, 3),
      address: parsed.org?.address || '',
    },
    socials: [...socials.entries()].map(([network, url]) => ({ network, url })),
    testimonials: [...new Set([...parsed.testimonials, ...extraTestimonials])].slice(0, 8),
    ctas: [...new Set(parsed.ctas)].slice(0, 10),
    checks: {
      https: homeUrl.startsWith('https:'), mobileViewport: parsed.checks.viewport, metaDescription: !!parsed.description, h1Count: parsed.checks.h1,
      imagesMissingAlt: parsed.checks.imgsNoAlt, images: parsed.checks.imgs, scripts: parsed.checks.scripts, copyrightYear: parsed.checks.copyrightYear,
      homeKb: Math.round(homeRes.bytes.length / 1024), loadMs, phoneOnHome: parsed.phones.length > 0, testimonialsFound: new Set([...parsed.testimonials, ...extraTestimonials]).size,
      ctaCount: parsed.ctas.length,
    },
    crawledAt: new Date().toISOString(),
    stats: { pages: pages.length, ms: Date.now() - started },
  };
}
