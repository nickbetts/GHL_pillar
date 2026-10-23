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
.pitch-logo-svg svg{height:100%;width:auto}
.pitch-logo-text{display:flex;align-items:center;height:100%;font-weight:800;font-size:1.35rem;letter-spacing:-.02em;white-space:nowrap}
.logo-on-dark .pitch-logo{filter:brightness(0) invert(1)}
.logo-on-light .pitch-logo{filter:brightness(0)}
html.pitch-anim [data-reveal]:not([data-reveal=stagger]){opacity:0}
html.pitch-anim [data-reveal=stagger]>*{opacity:0}
.pw{display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.08em;margin-bottom:-.08em}.pwi{display:inline-block;will-change:transform}
[data-marquee]{overflow:hidden}
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
  each('[data-menu-toggle]',function(b){b.addEventListener('click',function(){var m=D.querySelector('[data-menu]');if(!m)return;var o=m.classList.toggle('open');b.setAttribute('aria-expanded',o?'true':'false')})});
  each('.swiper',function(el){var o={};try{o=JSON.parse(el.getAttribute('data-swiper')||'{}')}catch(e){}var pg=el.querySelector('.swiper-pagination'),nx=el.querySelector('.swiper-button-next'),pv=el.querySelector('.swiper-button-prev');
    try{new W.Swiper(el,Object.assign({slidesPerView:1.15,spaceBetween:20,grabCursor:true,pagination:pg?{el:pg,clickable:true}:undefined,navigation:nx&&pv?{nextEl:nx,prevEl:pv}:undefined},o))}catch(e){}});
  function finish(){D.documentElement.classList.remove('pitch-anim');each('[data-counter]',function(el){el.textContent=(el.getAttribute('data-prefix')||'')+Number(el.getAttribute('data-counter')).toLocaleString('en-GB')+(el.getAttribute('data-suffix')||'')})}
  if(reduce||!W.gsap||!W.ScrollTrigger){finish();return}
  var gsap=W.gsap;gsap.registerPlugin(W.ScrollTrigger);
  var lenis=null;try{lenis=new W.Lenis({lerp:.1,smoothWheel:true});lenis.on('scroll',W.ScrollTrigger.update);gsap.ticker.add(function(t){lenis.raf(t*1000)});gsap.ticker.lagSmoothing(0)}catch(e){lenis=null}
  W.__pitchLenis=lenis;
  var from={up:{y:46,opacity:0},left:{x:-70,opacity:0},right:{x:70,opacity:0},zoom:{scale:.9,opacity:0},fade:{opacity:0}};
  each('[data-split]',function(el){var walker=D.createTreeWalker(el,NodeFilter.SHOW_TEXT,null),nodes=[],n;while((n=walker.nextNode()))nodes.push(n);
    nodes.forEach(function(t){if(!t.nodeValue.trim())return;var f=D.createDocumentFragment();t.nodeValue.split(/(\\s+)/).forEach(function(w){if(!w)return;if(/^\\s+$/.test(w)){f.appendChild(D.createTextNode(w));return}var o=D.createElement('span');o.className='pw';var i=D.createElement('span');i.className='pwi';i.textContent=w;o.appendChild(i);f.appendChild(o)});t.parentNode.replaceChild(f,t)});
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
    if (html) return { key: s.key, html: applyTokens(sanitizeFragment(html), tokens) };
    if (mode === 'client') return null;
    const st = stepFor(s.key);
    if (st?.status === 'failed') return { key: s.key, html: `<div class="pitch-failed" data-section="${esc(s.key)}">Couldn't build “${esc(s.name)}”: ${esc(st.error || 'unknown error')}. Use Retry in the studio.</div>` };
    return { key: s.key, html: `<div class="pitch-building" data-section="${esc(s.key)}">${st?.status === 'running' ? 'Designing' : 'Queued'}: ${esc(s.name)}<small>${esc(String(s.brief || '').slice(0, 120))}</small></div>` };
  }).filter(Boolean);
  const cut = gated && sections.length > 1;
  if (cut) sections = sections.slice(0, visibleCount(sections.length));
  const header = design.headerHtml ? applyTokens(sanitizeFragment(design.headerHtml), tokens) : '';
  const footer = !cut && design.footerHtml ? applyTokens(sanitizeFragment(design.footerHtml), tokens) : '';
  const fonts = fontsHref(design.fonts);
  const base = BASE_CSS.replace('VAR_P', pal.primary || '#2563eb').replace('VAR_S', pal.secondary || '#0f172a').replace('VAR_A', pal.accent || '#f59e0b')
    .replace('VAR_D', pal.dark || '#0b1220').replace('VAR_L', pal.light || '#f8fafc');
  const fontVars = `:root{--font-heading:'${String(design.fonts?.heading || 'Inter').replace(/'/g, '')}';--font-body:'${String(design.fonts?.body || 'Inter').replace(/'/g, '')}'}`;
  const title = page === 'secondary' ? `${site.pages?.secondary?.title || 'Services'} | ${name}` : name;
  const css = String(design.css || '').replace(/<\/style/gi, '<\\/style');
  return `<!DOCTYPE html>
<html lang="en-GB" class="pitch-anim">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<meta name="robots" content="noindex, nofollow" />
<title>${esc(title)}</title>
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
