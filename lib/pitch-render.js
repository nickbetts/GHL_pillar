/** Pitch Sites renderer: turns the stored design system + sections into one HTML document for a sandboxed iframe. Pure (no I/O). */

export const GATE_FRACTION = 0.75;
export const DEFAULT_GATE = {
  eyebrow: 'Your preview',
  headline: 'Like what you see? This is your new website.',
  sub: 'The rest of the page is built and waiting. Book a quick walkthrough with {rep} to see it all, or get started today.',
  bookLabel: 'Book a 15-min walkthrough',
  signupLabel: 'Start for £149/month',
  price: '£149',
};

const LIBS = {
  tailwind: 'https://cdn.tailwindcss.com/3.4.16?plugins=forms,typography,aspect-ratio',
  gsap: 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js',
  scrollTrigger: 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js',
  lenis: 'https://cdn.jsdelivr.net/npm/lenis@1.1.13/dist/lenis.min.js',
  lenisCss: 'https://cdn.jsdelivr.net/npm/lenis@1.1.13/dist/lenis.css',
  swiper: 'https://cdn.jsdelivr.net/npm/swiper@11.1.15/swiper-bundle.min.js',
  swiperCss: 'https://cdn.jsdelivr.net/npm/swiper@11.1.15/swiper-bundle.min.css',
  lucide: 'https://cdn.jsdelivr.net/npm/lucide@0.460.0/dist/umd/lucide.min.js',
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Strips scripts, inline handlers and javascript: URLs from AI/crawled markup. The frame is sandboxed too; this is belt and braces. */
export function sanitizeFragment(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<\/?(?:iframe|object|embed|base|meta|link)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|action|formaction)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

// ── Quality guards (also applied to sites built before the rules existed) ─────

const PATTERN_GRADIENT = /gradient/i;
const PATTERN_STOP = /transparent\s+[0-3](?:\.\d+)?px|[0-3](?:\.\d+)?px\s*,\s*transparent/i;
const isPatternValue = (v) => PATTERN_GRADIENT.test(v) && PATTERN_STOP.test(v);

/** Drops grid/dot "pattern" backgrounds (a tell-tale AI look) from a CSS declaration block. */
function cleanDecls(body) {
  const decls = String(body).split(';');
  let dropped = false;
  const kept = decls.filter((d) => {
    const [prop, ...rest] = d.split(':');
    const name = String(prop || '').trim().toLowerCase();
    if ((name === 'background' || name === 'background-image') && isPatternValue(rest.join(':'))) { dropped = true; return false; }
    return true;
  });
  return dropped ? kept.filter((d) => String(d.split(':')[0] || '').trim().toLowerCase() !== 'background-size').join(';') : body;
}

const GENERIC_SEL = /^(?:h[1-6]|p|strong|b|a|li|span|em|small|\.font-heading|\.font-body|\.heading|\.display[\w-]*)$/i;

const ELEMENT_START = /^(?:h[1-6]|p|a|ul|ol|li|img|button|input|textarea|select|label|blockquote|figure|figcaption|table|th|td|strong|b|em|small|hr|section|footer|header|nav|main|article|aside|span|details|summary|address|dl|dt|dd)(?=$|[\s:.[>+~#])/i;

/**
 * Global CSS clean-up:
 * - no pattern backgrounds, and no text colour forced on generic selectors (causes dark-on-dark);
 * - bare element selectors (h1, p ...) are raised to `html h1` so Tailwind's reset (loaded later) can't flatten
 *   them, while utility classes on the element still win.
 */
export function cleanDesignCss(css) {
  return String(css || '').replace(/([^{}]*)\{([^{}]*)\}/g, (m, sel, body) => {
    let b = cleanDecls(body);
    const lead = /^\s*/.exec(sel)[0];
    const parts = sel.split(',').map((x) => x.trim()).filter(Boolean);
    if (!parts.length || parts.some((x) => x.startsWith('@') || /^(?:from|to|\d+%)$/.test(x))) return `${sel}{${b}}`;
    if (parts.every((x) => GENERIC_SEL.test(x))) b = b.split(';').filter((d) => String(d.split(':')[0] || '').trim().toLowerCase() !== 'color').join(';');
    const raised = parts.map((x) => (ELEMENT_START.test(x) ? `html ${x}` : x)).join(',');
    return `${lead}${raised}{${b}}`;
  });
}

/** Section/header/footer markup clean-up: pattern backgrounds in style="" and Tailwind arbitrary classes. */
export function cleanMarkup(html) {
  return String(html || '')
    .replace(/\sstyle\s*=\s*"([^"]*)"/gi, (m, v) => ` style="${cleanDecls(v)}"`)
    .replace(/\sclass\s*=\s*"([^"]*)"/gi, (m, v) => {
      const tokens = v.split(/\s+/);
      const bad = (t) => /gradient/i.test(t) && /transparent_[0-3](?:\.\d+)?px|[0-3](?:\.\d+)?px_?,_?transparent/i.test(t);
      if (!tokens.some(bad) && !tokens.some((t) => /^bg-(?:grid|dots?|blueprint|pattern)\b/i.test(t))) return m;
      const kept = tokens.filter((t) => !bad(t) && !/^bg-(?:grid|dots?|blueprint|pattern)\b/i.test(t) && !/^(?:bg-\[(?:size|length):|\[background-size:)/i.test(t));
      return ` class="${kept.join(' ')}"`;
    });
}

/** Sections must never carry their own site header/nav bar (the shared header is rendered once). */
export function stripNestedHeaders(html) {
  return String(html || '').replace(/<header\b[\s\S]*?<\/header\s*>/gi, '');
}

const PLACEHOLDER_RE = /\b(?:to confirm|tbc|tbd|lorem ipsum|placeholder|label from|insert [a-z ]+ here|your logo here|xx+)\b|\d+\s*['’]?s\s+of\b|\d+['’]s\b|\[[^\]<>]{2,40}\]/i;

/** Quality problems in one section, phrased as fix instructions for the AI. */
export function lintSection(html, key = '') {
  const h = String(html || '');
  const text = h.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&');
  const issues = [];
  if (/<header\b/i.test(h) || /<nav\b/i.test(h) || /data-menu-toggle/.test(h)) issues.push('It contains a header, navigation menu or menu button. Remove it completely: the site header is rendered separately and the section must start with its own content.');
  const ph = PLACEHOLDER_RE.exec(text);
  if (ph) issues.push(`It contains placeholder or vague text ("${ph[0].trim()}"). Replace it with real content from the crawl, or remove that element entirely.`);
  if (cleanMarkup(h) !== h || /bg-(?:grid|dots?|blueprint|pattern)\b/i.test(h)) issues.push('It uses a grid, dot or line pattern background. Remove it and use a solid colour, a subtle tonal gradient or a real photo.');
  if (/data-split[\s\S]{0,1200}?(?:text-gradient|bg-clip-text|text-transparent)/i.test(h)) issues.push('A data-split headline contains gradient or transparent text. Make the headline a single solid colour.');
  if (/text-stroke|text-outline|stroke-text|outline-text/i.test(h)) issues.push('It uses outlined/stroked (hollow) text. Use solid text instead.');
  if (/[\u{1F300}-\u{1FAFF}\u2728\u2B50]/u.test(text)) issues.push('It uses emojis. Replace them with Lucide icons or remove them.');
  const root = /^\s*<section\b([^>]*)>/i.exec(h);
  const cls = root ? (/class\s*=\s*"([^"]*)"/i.exec(root[1])?.[1] || '') : '';
  if (key && key !== 'hero' && root && !/(?:^|\s)section(?:\s|$)/.test(cls)) issues.push('The section root is missing the shared "section" spacing class. Add class="section" to the root and remove any other outer padding (py-*/pt-*/pb-*) from it.');
  if (key === 'hero' && !/<h1\b/i.test(h)) issues.push('The hero has no <h1>. Make the main headline an <h1 class="h-display"> containing the main service and location.');
  if (key && key !== 'hero' && /<h1\b/i.test(h)) issues.push('Only the hero may contain an <h1>. Change this section\'s <h1> to <h2 class="h2">.');
  if ((/<h1\b/gi.exec(h) && (h.match(/<h1\b/gi) || []).length > 1)) issues.push('There is more than one <h1>. Keep one and make the others <h2>.');
  if (/(?:^|\s)-m[tby]-/.test(cls)) issues.push('The section root uses a negative margin. Remove it so sections never overlap.');
  return issues;
}

export function logoMarkup(brand, name) {
  const logo = brand?.logo;
  if (logo?.url && /^https?:\/\//i.test(logo.url)) return `<img class="pitch-logo" src="${esc(logo.url)}" alt="${esc(name)}" />`;
  if (logo?.svg) return `<span class="pitch-logo pitch-logo-svg">${sanitizeFragment(logo.svg)}</span>`;
  return `<span class="pitch-logo pitch-logo-text font-heading">${esc(name)}</span>`;
}

function applyTokens(html, { logo, year }) {
  return String(html || '')
    .replace(/\{\{\s*logo\s*\}\}/g, logo)
    .replace(/\{\{\s*year\s*\}\}/g, String(year))
    .replace(/\{\{\s*page:home\s*\}\}/g, '#pitch-page-home')
    .replace(/\{\{\s*page:secondary\s*\}\}/g, '#pitch-page-secondary');
}

/** How many sections a client sees before the gate. */
export function visibleCount(total, fraction = GATE_FRACTION) {
  if (total <= 1) return total;
  return Math.max(1, Math.min(total - 1, Math.ceil(total * fraction)));
}

function fontsHref(fonts) {
  const fams = [...new Set([fonts?.heading, fonts?.body].filter(Boolean))];
  if (!fams.length) return '';
  return `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@300;400;500;600;700;800`).join('&')}&display=swap`;
}

function tailwindConfig(design) {
  const p = design?.palette || {};
  const extend = { ...(design?.tailwindExtend || {}) };
  extend.colors = { ...(extend.colors || {}), brand: { primary: p.primary, secondary: p.secondary, accent: p.accent, dark: p.dark, light: p.light } };
  extend.fontFamily = { ...(extend.fontFamily || {}), heading: [design?.fonts?.heading || 'Inter', 'sans-serif'], body: [design?.fonts?.body || 'Inter', 'sans-serif'] };
  return JSON.stringify({ theme: { extend } }).replace(/</g, '\\u003c');
}

const BASE_CSS = `
:root{--brand-primary:VAR_P;--brand-secondary:VAR_S;--brand-accent:VAR_A;--brand-dark:VAR_D;--brand-light:VAR_L}
html,body{margin:0}body{font-family:var(--font-body),system-ui,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.pitch-logo{display:block;height:100%;width:auto;max-width:240px;object-fit:contain}
header[data-sticky]:not([class*="flex"]):not([class*="grid"]){display:flow-root}
.pitch-ph{outline:2px dashed #ef4444!important;outline-offset:2px}
.pitch-logo-svg svg{height:100%;width:auto}
.pitch-logo-text{display:flex;align-items:center;height:100%;font-weight:800;font-size:1.35rem;letter-spacing:-.02em;white-space:nowrap}
.logo-on-dark,.logo-on-light{display:inline-flex;align-items:center;height:100%;padding:.35rem .7rem;border-radius:.75rem;box-sizing:border-box}
.logo-on-dark{background:#fff}.logo-on-light{background:#0f172a}
html.pitch-anim [data-reveal]:not([data-reveal=stagger]){opacity:0}
html.pitch-anim [data-reveal=stagger]>*{opacity:0}
.pw{display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.08em;margin-bottom:-.08em}.pwi{display:inline-block;will-change:transform}
[data-marquee]{overflow:hidden}
[data-mega]{position:relative}
[data-mega-panel]{position:absolute;left:50%;top:100%;z-index:60;opacity:0;visibility:hidden;transform:translate(-50%,10px);transition:opacity .2s ease,transform .25s ease,visibility 0s linear .25s;pointer-events:none}
[data-mega].open [data-mega-panel]{opacity:1;visibility:visible;transform:translate(-50%,0);transition:opacity .2s ease,transform .25s ease;pointer-events:auto}
[data-mega-panel].mega-full{position:fixed;left:0;right:0;transform:translateY(10px);top:var(--pitch-header-h,80px)}
[data-mega].open [data-mega-panel].mega-full{transform:none}
[data-menu]:not(.open){display:none}
.pitch-building{margin:24px auto;max-width:1100px;border-radius:28px;min-height:320px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;
  background:linear-gradient(110deg,#f1f5f9 8%,#e2e8f0 18%,#f1f5f9 33%);background-size:200% 100%;animation:pitchShimmer 1.4s linear infinite;color:#64748b;font:600 15px/1.4 system-ui,sans-serif}
.pitch-building small{font-weight:500;opacity:.8}
.pitch-failed{margin:24px auto;max-width:1100px;border-radius:20px;padding:28px;background:#fef2f2;color:#991b1b;font:500 14px/1.4 system-ui,sans-serif;text-align:center}
@keyframes pitchShimmer{to{background-position-x:-200%}}
body.pitch-select [data-section]{cursor:pointer}
body.pitch-select [data-section]:hover{outline:3px solid #6366f1;outline-offset:-3px}
[data-section].pitch-picked{outline:3px solid #6366f1!important;outline-offset:-3px}
#pitch-gate{position:relative;z-index:30;margin-top:-62vh;min-height:62vh;display:flex;align-items:flex-end;justify-content:center;padding:0 20px 9vh;pointer-events:none}
#pitch-gate .pg-fade{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(255,255,255,0) 0%,rgba(255,255,255,.75) 38%,#fff 70%);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);-webkit-mask-image:linear-gradient(to bottom,transparent 0%,#000 45%);mask-image:linear-gradient(to bottom,transparent 0%,#000 45%)}
#pitch-gate .pg-ghost{position:absolute;left:50%;transform:translateX(-50%);bottom:0;width:min(1100px,92vw);height:40%;display:grid;grid-template-columns:repeat(3,1fr);gap:18px;filter:blur(18px);opacity:.35}
#pitch-gate .pg-ghost i{border-radius:26px;background:linear-gradient(160deg,var(--brand-primary),var(--brand-accent))}
#pitch-gate .pg-panel{position:relative;pointer-events:auto;width:min(680px,100%);text-align:center;padding:38px 34px 30px;border-radius:30px;
  background:rgba(255,255,255,.72);-webkit-backdrop-filter:blur(22px) saturate(1.4);backdrop-filter:blur(22px) saturate(1.4);border:1px solid rgba(255,255,255,.9);
  box-shadow:0 30px 80px -20px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.04);font-family:Inter,system-ui,sans-serif;color:#0f172a}
#pitch-gate .pg-panel:before{content:"";position:absolute;inset:-1px;border-radius:31px;padding:1.5px;background:linear-gradient(130deg,var(--brand-primary),var(--brand-accent),var(--brand-primary));
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:.8;pointer-events:none}
#pitch-gate .pg-eyebrow{display:inline-flex;align-items:center;gap:8px;font:700 11.5px/1 Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--brand-primary);background:rgba(255,255,255,.8);padding:8px 12px;border-radius:999px;border:1px solid rgba(15,23,42,.06)}
#pitch-gate .pg-eyebrow b{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 4px rgba(34,197,94,.18);animation:pgPulse 1.8s ease-in-out infinite}
@keyframes pgPulse{50%{box-shadow:0 0 0 8px rgba(34,197,94,.05)}}
#pitch-gate h2{margin:16px 0 10px;font:800 clamp(26px,4vw,40px)/1.08 var(--font-heading),Inter,system-ui,sans-serif;letter-spacing:-.025em}
#pitch-gate p{margin:0 auto;max-width:520px;color:#475569;font-size:16px;line-height:1.55}
#pitch-gate .pg-btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:24px}
#pitch-gate button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:9px;padding:15px 22px;border-radius:999px;font:700 15px/1 Inter,system-ui,sans-serif;transition:transform .15s ease,box-shadow .15s ease}
#pitch-gate button:hover{transform:translateY(-2px)}
#pitch-gate .pg-book{background:var(--brand-dark);color:#fff;box-shadow:0 12px 30px -10px rgba(15,23,42,.55)}
#pitch-gate .pg-signup{background:linear-gradient(135deg,var(--brand-primary),var(--brand-accent));color:#fff;box-shadow:0 12px 30px -10px var(--brand-primary)}
#pitch-gate .pg-small{margin-top:16px;font-size:13px;color:#64748b}
#pitch-gate .pg-small a{color:inherit;font-weight:600}
`;

const RUNTIME_JS = `
(function(){
  var D=document,W=window,reduce=W.matchMedia&&W.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function each(sel,fn){Array.prototype.forEach.call(D.querySelectorAll(sel),fn)}
  try{W.lucide&&W.lucide.createIcons()}catch(e){}
  var header=D.querySelector('header[data-sticky]');function onScroll(){if(header)header.classList.toggle('is-scrolled',(W.scrollY||0)>24)}W.addEventListener('scroll',onScroll,{passive:true});onScroll();
  function headerH(){if(header)D.documentElement.style.setProperty('--pitch-header-h',header.getBoundingClientRect().bottom+'px')}headerH();W.addEventListener('resize',headerH);W.addEventListener('scroll',headerH,{passive:true});
  each('[data-mega]',function(m){var t=m.querySelector('[data-mega-trigger]'),timer;function open(){clearTimeout(timer);each('[data-mega].open',function(o){if(o!==m)o.classList.remove('open')});m.classList.add('open');if(t)t.setAttribute('aria-expanded','true');headerH()}
    function close(){timer=setTimeout(function(){m.classList.remove('open');if(t)t.setAttribute('aria-expanded','false')},140)}
    m.addEventListener('mouseenter',open);m.addEventListener('mouseleave',close);m.addEventListener('focusin',open);m.addEventListener('focusout',function(e){if(!m.contains(e.relatedTarget))close()});
    if(t)t.addEventListener('click',function(e){e.preventDefault();m.classList.contains('open')?(m.classList.remove('open'),t.setAttribute('aria-expanded','false')):open()})});
  D.addEventListener('keydown',function(e){if(e.key==='Escape')each('[data-mega].open',function(o){o.classList.remove('open')})});
  each('[data-accordion] > button, [data-accordion-trigger]',function(b){b.addEventListener('click',function(){var p=b.closest('[data-accordion]')||b.parentNode;var o=p.classList.toggle('open');b.setAttribute('aria-expanded',o?'true':'false')})});
  each('[data-menu-toggle]',function(b){b.addEventListener('click',function(){var m=D.querySelector('[data-menu]');if(!m)return;var o=m.classList.toggle('open');b.setAttribute('aria-expanded',o?'true':'false')})});
  each('.swiper',function(el){var o={};try{o=JSON.parse(el.getAttribute('data-swiper')||'{}')}catch(e){}var pg=el.querySelector('.swiper-pagination'),nx=el.querySelector('.swiper-button-next'),pv=el.querySelector('.swiper-button-prev');
    try{new W.Swiper(el,Object.assign({slidesPerView:1.15,spaceBetween:20,grabCursor:true,pagination:pg?{el:pg,clickable:true}:undefined,navigation:nx&&pv?{nextEl:nx,prevEl:pv}:undefined},o))}catch(e){}});
  // Gradient-clipped text can't be split into word spans (it turns invisible), so it is left whole.
  function clipped(n,stop){for(;n&&n.nodeType===1;n=n.parentElement){var c=getComputedStyle(n);if(c.webkitBackgroundClip==='text'||c.backgroundClip==='text')return true;if(n===stop)break}return false}
  // Safety net for dark-on-dark / light-on-light text: works out each text element's real background and fixes unreadable colours.
  function rgba(s){var m=/rgba?\\(([^)]+)\\)/.exec(s||'');if(!m)return null;var p=m[1].split(/[\\s,\\/]+/).filter(Boolean).map(parseFloat);return [p[0],p[1],p[2],p.length>3?p[3]:1]}
  function L(c){var a=[c[0],c[1],c[2]].map(function(v){v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*a[0]+.7152*a[1]+.0722*a[2]}
  function bgFor(el){for(var n=el;n&&n.nodeType===1&&n!==D.documentElement;n=n.parentElement){var c=getComputedStyle(n),b=rgba(c.backgroundColor);if(b&&b[3]>=.55)return {c:b,sure:n!==D.body};
      if(c.backgroundImage&&c.backgroundImage!=='none'){if(/url\\(/.test(c.backgroundImage))return null;var cols=c.backgroundImage.match(/rgba?\\([^)]+\\)/g);if(!cols)return null;var sum=[0,0,0],k=0;cols.forEach(function(x){var v=rgba(x);if(v&&v[3]>.4){sum[0]+=v[0];sum[1]+=v[1];sum[2]+=v[2];k++}});if(k)return {c:[sum[0]/k,sum[1]/k,sum[2]/k,1],sure:true};return null}}
    return null}
  function contrast(){var all=D.body.querySelectorAll('*');for(var i=0;i<all.length;i++){var el=all[i];if(/^(SCRIPT|STYLE|SVG|PATH|IMG|INPUT|TEXTAREA|SELECT|OPTION|BR|I)$/i.test(el.tagName)||el.closest('#pitch-gate'))continue;
      var own=false;for(var j=0;j<el.childNodes.length;j++){var x=el.childNodes[j];if(x.nodeType===3&&x.nodeValue.trim()){own=true;break}}if(!own)continue;
      var cs=getComputedStyle(el),fg=rgba(cs.color);if(!fg||fg[3]<.3||cs.webkitBackgroundClip==='text'||cs.backgroundClip==='text')continue;
      var bg=bgFor(el);if(!bg||!bg.sure)continue;var lf=L(fg),lb=L(bg.c),r=(Math.max(lf,lb)+.05)/(Math.min(lf,lb)+.05);
      if(r<2.2)el.style.setProperty('color',lb<.35?'#ffffff':'#0f172a','important')}}
  function placeholders(){var re=${PLACEHOLDER_RE.toString()},client=D.documentElement.getAttribute('data-pitch-mode')==='client';
    each('main *',function(el){if(el.children.length>3)return;var t='';for(var j=0;j<el.childNodes.length;j++)if(el.childNodes[j].nodeType===3)t+=el.childNodes[j].nodeValue;if(!t.trim()||!re.test(t))return;
      if(client)el.style.setProperty('display','none','important');else{el.classList.add('pitch-ph');el.title='Placeholder text: ask the AI to replace it'}})}
  try{contrast()}catch(e){}try{placeholders()}catch(e){}
  W.addEventListener('load',function(){try{contrast()}catch(e){}});
  function finish(){D.documentElement.classList.remove('pitch-anim');each('[data-counter]',function(el){el.textContent=(el.getAttribute('data-prefix')||'')+Number(el.getAttribute('data-counter')).toLocaleString('en-GB')+(el.getAttribute('data-suffix')||'')})}
  if(reduce||!W.gsap||!W.ScrollTrigger){finish();return}
  var gsap=W.gsap;gsap.registerPlugin(W.ScrollTrigger);
  var lenis=null;try{lenis=new W.Lenis({lerp:.1,smoothWheel:true});lenis.on('scroll',W.ScrollTrigger.update);gsap.ticker.add(function(t){lenis.raf(t*1000)});gsap.ticker.lagSmoothing(0)}catch(e){lenis=null}
  W.__pitchLenis=lenis;
  var from={up:{y:46,opacity:0},left:{x:-70,opacity:0},right:{x:70,opacity:0},zoom:{scale:.9,opacity:0},fade:{opacity:0}};
  each('[data-split]',function(el){var walker=D.createTreeWalker(el,NodeFilter.SHOW_TEXT,null),nodes=[],n;while((n=walker.nextNode()))nodes.push(n);
    nodes.forEach(function(t){if(!t.nodeValue.trim()||clipped(t.parentNode,el))return;var f=D.createDocumentFragment();t.nodeValue.split(/(\\s+)/).forEach(function(w){if(!w)return;if(/^\\s+$/.test(w)){f.appendChild(D.createTextNode(w));return}var o=D.createElement('span');o.className='pw';var i=D.createElement('span');i.className='pwi';i.textContent=w;o.appendChild(i);f.appendChild(o)});t.parentNode.replaceChild(f,t)});
    gsap.from(el.querySelectorAll('.pwi'),{yPercent:115,duration:1,ease:'power4.out',stagger:.045,scrollTrigger:{trigger:el,start:'top 90%'}})});
  each('[data-reveal]',function(el){var t=el.getAttribute('data-reveal')||'up';
    if(t==='stagger'){gsap.fromTo(el.children,{y:34,opacity:0},{y:0,opacity:1,duration:.85,ease:'power3.out',stagger:.09,scrollTrigger:{trigger:el,start:'top 86%'}});return}
    var f=from[t]||from.up;gsap.fromTo(el,f,{x:0,y:0,scale:1,opacity:1,duration:1,ease:'power3.out',scrollTrigger:{trigger:el,start:'top 90%'}})});
  each('[data-parallax]',function(el){var s=parseFloat(el.getAttribute('data-parallax'))||.15;gsap.to(el,{yPercent:-s*100,ease:'none',scrollTrigger:{trigger:el,start:'top bottom',end:'bottom top',scrub:true}})});
  each('[data-counter]',function(el){var to=Number(el.getAttribute('data-counter'))||0,o={v:0},pre=el.getAttribute('data-prefix')||'',suf=el.getAttribute('data-suffix')||'';el.textContent=pre+'0'+suf;
    gsap.to(o,{v:to,duration:2,ease:'power2.out',scrollTrigger:{trigger:el,start:'top 92%'},onUpdate:function(){el.textContent=pre+Math.round(o.v).toLocaleString('en-GB')+suf}})});
  each('[data-marquee]',function(el){var row=el.firstElementChild;if(!row)return;row.style.display='flex';row.style.width='max-content';Array.prototype.slice.call(row.children).forEach(function(c){row.appendChild(c.cloneNode(true))});
    gsap.to(row,{xPercent:-50,repeat:-1,ease:'none',duration:parseFloat(el.getAttribute('data-speed'))||32})});
  W.addEventListener('load',function(){W.ScrollTrigger.refresh()});
  setTimeout(function(){W.ScrollTrigger.refresh()},1200);
})();`;

function bridgeJs(mode, page) {
  return `
(function(){
  var P=window.parent,D=document,mode=${JSON.stringify(mode)},page=${JSON.stringify(page)};
  function send(m){m.pitch=1;m.page=page;try{P.postMessage(m,'*')}catch(e){}}
  var CTA=/contact|quote|book|call|enquir|get started|start|consult|appointment|free|estimate|talk|speak/i;
  D.addEventListener('click',function(e){
    var cta=e.target.closest&&e.target.closest('[data-pitch-cta]');
    if(cta){e.preventDefault();send({type:'cta',action:cta.getAttribute('data-pitch-cta'),source:'gate'});return}
    if(mode==='studio'&&D.body.classList.contains('pitch-select')){var s=e.target.closest('[data-section],header,footer');if(s){e.preventDefault();e.stopPropagation();
      Array.prototype.forEach.call(D.querySelectorAll('.pitch-picked'),function(x){x.classList.remove('pitch-picked')});s.classList.add('pitch-picked');
      send({type:'select',part:s.tagName==='HEADER'?'header':s.tagName==='FOOTER'?'footer':s.getAttribute('data-section')});return}}
    var a=e.target.closest&&e.target.closest('a');if(!a)return;var h=a.getAttribute('href')||'';
    if(h.indexOf('#pitch-page-')===0){e.preventDefault();send({type:'nav',to:h.slice(12)});return}
    if(h.charAt(0)==='#'&&h.length>1){var t=null;try{t=D.querySelector(h)}catch(x){}if(t){e.preventDefault();if(window.__pitchLenis)window.__pitchLenis.scrollTo(t,{offset:-80});else t.scrollIntoView({behavior:'smooth'});return}}
    e.preventDefault();
    if(mode==='client'&&CTA.test((a.textContent||'')+' '+h))send({type:'cta',action:'book',source:'site'});
  },true);
  D.addEventListener('submit',function(e){e.preventDefault();if(mode==='client')send({type:'cta',action:'book',source:'form'})},true);
  var max=0,last=0;function depth(){var h=D.documentElement.scrollHeight-window.innerHeight;var d=h>0?Math.round((window.scrollY/h)*100):100;if(d>max){max=d;if(max-last>=5||max===100){last=max;send({type:'depth',value:max})}}}
  window.addEventListener('scroll',depth,{passive:true});
  var g=D.getElementById('pitch-gate');if(g&&window.IntersectionObserver){var seen=false;new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting&&!seen){seen=true;send({type:'gate'})}})},{threshold:.35}).observe(g)}
  window.addEventListener('message',function(e){var m=e.data||{};if(e.source!==P||!m.pitchParent)return;
    if(m.type==='selectMode')D.body.classList.toggle('pitch-select',!!m.on);
    if(m.type==='scrollTo'){var t=D.querySelector('[data-section="'+String(m.part).replace(/"/g,'')+'"]')||D.querySelector(m.part==='footer'?'footer':'header');if(t){if(window.__pitchLenis)window.__pitchLenis.scrollTo(t,{offset:-40});else t.scrollIntoView()}}});
  window.addEventListener('load',function(){send({type:'ready',height:D.documentElement.scrollHeight});depth()});
})();`;
}

const stripTags = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/** LocalBusiness + FAQPage structured data built from the crawl and the page's own <details> FAQs. */
export function structuredData(site, sectionsHtml) {
  const b = site.brand || {};
  const out = [];
  const biz = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: b.name || site.client_name, url: b.url || site.source_url };
  if (b.contact?.phones?.[0]) biz.telephone = b.contact.phones[0];
  if (b.contact?.emails?.[0]) biz.email = b.contact.emails[0];
  if (b.contact?.address) biz.address = b.contact.address;
  if (site.brief?.seo?.areaServed?.length) biz.areaServed = site.brief.seo.areaServed;
  if (b.logo?.url) biz.logo = b.logo.url;
  if (b.socials?.length) biz.sameAs = b.socials.map((x) => x.url);
  out.push(biz);
  const faqs = [];
  for (const m of String(sectionsHtml).matchAll(/<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi)) {
    const q = stripTags(m[1]);
    const a = stripTags(m[2]);
    if (q && a) faqs.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } });
  }
  if (faqs.length >= 2) out.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.slice(0, 12) });
  return out;
}

function gateMarkup(gate, repName) {
  const g = { ...DEFAULT_GATE, ...(gate || {}) };
  const sub = esc(g.sub).replace(/\{rep\}/g, esc(repName || 'us'));
  return `<div id="pitch-gate" aria-label="Preview ends here"><div class="pg-ghost" aria-hidden="true"><i></i><i></i><i></i></div><div class="pg-fade" aria-hidden="true"></div>
<div class="pg-panel"><span class="pg-eyebrow"><b></b>${esc(g.eyebrow)}</span><h2>${esc(g.headline)}</h2><p>${sub}</p>
<div class="pg-btns"><button type="button" class="pg-book" data-pitch-cta="book">${esc(g.bookLabel)}</button><button type="button" class="pg-signup" data-pitch-cta="signup">${esc(g.signupLabel)}</button></div>
<div class="pg-small">Prepared for you by ${esc(repName || 'i3MEDIA')} at i3MEDIA</div></div></div>`;
}

/**
 * @param {object} p
 * @param {object} p.site       pitch_sites row (brand, design, pages, client_name)
 * @param {'home'|'secondary'} p.page
 * @param {'studio'|'client'} p.mode
 * @param {boolean} p.gated     cut the page at GATE_FRACTION and show the CTA panel
 * @param {object} [p.gate]     gate copy overrides
 * @param {string} [p.repName]
 * @param {Array}  [p.steps]    build steps (studio, while building) to show placeholders
 */
export function renderPage({ site, page = 'home', mode = 'studio', gated = false, gate = null, repName = '', steps = [], now = new Date() }) {
  const design = site.design || {};
  const pal = design.palette || {};
  const plan = site.pages?.[page] || { sections: [], html: {} };
  const name = site.brand?.name || site.client_name || 'Your business';
  const logo = logoMarkup(site.brand, name);
  const tokens = { logo, year: now.getUTCFullYear() };
  const stepFor = (key) => steps.find((s) => s.page === page && s.section_key === key);
  let sections = (plan.sections || []).map((s) => {
    const html = plan.html?.[s.key];
    if (html) return { key: s.key, html: applyTokens(cleanMarkup(stripNestedHeaders(sanitizeFragment(html))), tokens) };
    if (mode === 'client') return null;
    const st = stepFor(s.key);
    if (st?.status === 'failed') return { key: s.key, html: `<div class="pitch-failed" data-section="${esc(s.key)}">Couldn't build “${esc(s.name)}”: ${esc(st.error || 'unknown error')}. Use Retry in the studio.</div>` };
    return { key: s.key, html: `<div class="pitch-building" data-section="${esc(s.key)}">${st?.status === 'running' ? 'Designing' : 'Queued'}: ${esc(s.name)}<small>${esc(String(s.brief || '').slice(0, 120))}</small></div>` };
  }).filter(Boolean);
  const cut = gated && sections.length > 1;
  if (cut) sections = sections.slice(0, visibleCount(sections.length));
  const header = design.headerHtml ? applyTokens(cleanMarkup(sanitizeFragment(design.headerHtml)), tokens) : '';
  const footer = !cut && design.footerHtml ? applyTokens(cleanMarkup(sanitizeFragment(design.footerHtml)), tokens) : '';
  const fonts = fontsHref(design.fonts);
  const base = BASE_CSS.replace('VAR_P', pal.primary || '#2563eb').replace('VAR_S', pal.secondary || '#0f172a').replace('VAR_A', pal.accent || '#f59e0b')
    .replace('VAR_D', pal.dark || '#0b1220').replace('VAR_L', pal.light || '#f8fafc');
  const fontVars = `:root{--font-heading:'${String(design.fonts?.heading || 'Inter').replace(/'/g, '')}';--font-body:'${String(design.fonts?.body || 'Inter').replace(/'/g, '')}'}`;
  const seo = site.brief?.seo || {};
  const title = (page === 'secondary' ? seo.secondaryTitle : seo.homeTitle) || (page === 'secondary' ? `${site.pages?.secondary?.title || 'Services'} | ${name}` : name);
  const description = (page === 'secondary' ? seo.secondaryDescription : seo.homeDescription) || site.brief?.positioning || '';
  const ld = structuredData(site, sections.map((x) => x.html).join('\n')).map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('');
  const css = cleanDesignCss(design.css).replace(/<\/style/gi, '<\\/style');
  return `<!DOCTYPE html>
<html lang="en-GB" class="pitch-anim" data-pitch-mode="${mode === 'client' ? 'client' : 'studio'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<meta name="robots" content="noindex, nofollow" />
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}" />` : ''}
${ld}
${fonts ? `<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /><link rel="stylesheet" href="${fonts}" />` : ''}
<link rel="stylesheet" href="${LIBS.swiperCss}" />
<link rel="stylesheet" href="${LIBS.lenisCss}" />
<script>setTimeout(function(){document.documentElement.classList.remove('pitch-anim')},4500)</script>
<script src="${LIBS.tailwind}"></script>
<script>tailwind.config=${tailwindConfig(design)};</script>
<style>${base}${fontVars}</style>
<style>${css}</style>
</head>
<body class="font-body bg-white text-slate-900 antialiased">
${header}
<main id="pitch-main">
${sections.map((s) => s.html).join('\n')}
</main>
${cut ? gateMarkup(gate, repName) : ''}
${footer}
<script src="${LIBS.gsap}"></script>
<script src="${LIBS.scrollTrigger}"></script>
<script src="${LIBS.lenis}"></script>
<script src="${LIBS.swiper}"></script>
<script src="${LIBS.lucide}"></script>
<script>${RUNTIME_JS}</script>
<script>${bridgeJs(mode, page)}</script>
</body>
</html>`;
}

/** Section keys in render order for a page (header/footer/styles are the extra editable parts). */
export function editableParts(site, page) {
  return [
    { key: 'header', name: 'Header' },
    ...((site.pages?.[page]?.sections) || []).map((s) => ({ key: s.key, name: s.name })),
    { key: 'footer', name: 'Footer' },
    { key: 'styles', name: 'Colours, fonts & global styles' },
  ];
}
