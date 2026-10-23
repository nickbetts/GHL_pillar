import test from 'node:test';
import assert from 'node:assert/strict';
import { fontsFromGoogleHref, normalizeSiteUrl, parseBrandHtml, pickPalette, rankPages, scoreCss } from '../lib/pitch-crawl.js';
import { normalizeBrief, normalizeDesign } from '../lib/pitch-ai.js';
import { renderPage, sanitizeFragment, visibleCount } from '../lib/pitch-render.js';
import { normalizePitchConfig, DEFAULT_PITCH_CONFIG } from '../lib/pitch-config.js';
import { normalizeSectionHtml } from '../api/pitch-sites.js';

test('normalizeSiteUrl adds https and rejects private hosts', () => {
  assert.equal(normalizeSiteUrl('example.co.uk').href, 'https://example.co.uk/');
  assert.throws(() => normalizeSiteUrl('localhost'));
  assert.throws(() => normalizeSiteUrl('http://10.0.0.1'));
  assert.throws(() => normalizeSiteUrl(''));
});

test('palette favours brand declarations and drops framework defaults and greys', () => {
  const tally = new Map();
  scoreCss('.btn-primary{background:#0a466b;color:#fff}.x{color:#0d6efd}.y{color:#0d6efd}.z{color:#0d6efd}:root{--brand-accent:#ffc720}body{color:#333;background:#fafafa}', tally);
  const { colors, dark, light } = pickPalette(tally);
  assert.deepEqual(colors.slice(0, 2).sort(), ['#0a466b', '#ffc720']);
  assert.ok(!colors.includes('#333333'));
  assert.equal(dark, '#333333');
  assert.equal(light, '#ffffff');
});

test('google font families are read from stylesheet links', () => {
  assert.deepEqual(fontsFromGoogleHref('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&family=Playfair+Display&display=swap'), ['DM Sans', 'Playfair Display']);
  assert.deepEqual(fontsFromGoogleHref('https://example.com/x.css'), []);
});

test('parseBrandHtml finds the header logo, contacts, socials, checks and JSON-LD', () => {
  const html = `<!doctype html><html><head><title>Smiths Plumbing | Peterborough</title><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#123456"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
    <script type="application/ld+json">{"@type":"LocalBusiness","name":"Smiths Plumbing Ltd","telephone":"01733 111222","address":{"streetAddress":"1 High St","addressLocality":"Peterborough"}}</script></head>
    <body><header class="site-header"><a href="/"><img src="/img/logo.png" alt="Smiths logo"></a><nav><a href="/services">Services</a><a href="/about">About us</a></nav></header>
    <h1>Plumbers you can trust</h1><p>We fix leaks, boilers and bathrooms across Peterborough and the surrounding villages.</p>
    <img src="/img/van.jpg" alt="Our van" width="800" height="600"><img src="/img/tiny.jpg">
    <blockquote>Fantastic service, arrived within the hour and fixed our boiler for a fair price.</blockquote>
    <a href="tel:+441733111222">Call us</a><a href="mailto:info@smiths.co.uk">Email</a><a href="https://facebook.com/smiths">Facebook</a>
    <footer>© 2019 Smiths Plumbing</footer></body></html>`;
  const p = parseBrandHtml(html, 'https://smiths.co.uk/');
  assert.equal(p.logoCandidates[0].url, 'https://smiths.co.uk/img/logo.png');
  assert.equal(p.org.name, 'Smiths Plumbing Ltd');
  assert.match(p.org.address, /Peterborough/);
  assert.ok(p.phones.includes('+441733111222'));
  assert.deepEqual(p.emails, ['info@smiths.co.uk']);
  assert.equal(p.socials[0].network, 'facebook');
  assert.equal(p.testimonials.length, 1);
  assert.equal(p.checks.viewport, true);
  assert.equal(p.checks.h1, 1);
  assert.equal(p.checks.copyrightYear, 2019);
  assert.ok(p.images.some((i) => i.url.endsWith('/img/van.jpg')));
  assert.deepEqual(p.googleFonts, ['Inter']);
  const pages = rankPages('https://smiths.co.uk/', p);
  assert.equal(pages[0].url, 'https://smiths.co.uk/services');
});

test('briefs and designs are normalised safely', () => {
  const b = normalizeBrief({
    logoTone: 'nope', palette: { primary: 'red', accent: '#ABCDEF' },
    homepage: { sections: [{ key: 'Hero Section!', name: 'Hero' }, { key: 'hero-section', name: 'Dupe' }] },
    gaps: [1, 2, 3, 4].map((n) => ({ title: `g${n}` })),
  });
  assert.equal(b.logoTone, 'colour');
  assert.equal(b.palette.primary, '#2563eb');
  assert.equal(b.palette.accent, '#abcdef');
  assert.equal(b.homepage.sections[0].key, 'hero-section');
  assert.notEqual(b.homepage.sections[1].key, 'hero-section');
  assert.equal(b.gaps.length, 3);
  const d = normalizeDesign({ tailwindExtend: 'not json', css: '@import url(x.css); body{color:red}' }, b);
  assert.deepEqual(d.tailwindExtend, {});
  assert.ok(!d.css.includes('@import'));
});

test('sanitizeFragment strips scripts, handlers and javascript: links', () => {
  const out = sanitizeFragment('<section onclick="x()"><script>alert(1)</script><a href="javascript:alert(1)">a</a><iframe src="//x"></iframe><img src=x onerror=alert(1)></section>');
  assert.ok(!/script|onclick|onerror|javascript:|iframe/i.test(out));
});

test('normalizeSectionHtml forces id and data-section on one root section', () => {
  const a = normalizeSectionHtml('```html\n<section id="wrong" data-section="nope" class="py-24"><h2>Hi</h2></section>\n```', 'hero');
  assert.match(a, /^<section id="hero" data-section="hero" class="py-24">/);
  const b = normalizeSectionHtml('<div>loose</div>', 'faq');
  assert.match(b, /^<section id="faq" data-section="faq">/);
});

function site(n = 8) {
  const sections = Array.from({ length: n }, (_, i) => ({ key: `s${i + 1}`, name: `S${i + 1}` }));
  return {
    client_name: 'Acme', brand: { name: 'Acme', logo: { url: 'https://acme.test/logo.png' } },
    design: { palette: { primary: '#111111', secondary: '#222222', accent: '#333333', dark: '#000000', light: '#ffffff' }, fonts: { heading: 'Sora', body: 'Inter' }, tailwindExtend: {}, css: '', headerHtml: '<header><a href="{{page:secondary}}">Services</a>{{logo}}</header>', footerHtml: '<footer>© {{year}} Acme</footer>' },
    pages: { home: { sections, html: Object.fromEntries(sections.map((s) => [s.key, `<section id="${s.key}" data-section="${s.key}">${s.name}</section>`])) } },
  };
}

test('the client view only sends the top three quarters and never the footer', () => {
  assert.equal(visibleCount(8), 6);
  assert.equal(visibleCount(5), 4);
  assert.equal(visibleCount(2), 1);
  assert.equal(visibleCount(1), 1);
  const gated = renderPage({ site: site(8), page: 'home', mode: 'client', gated: true, repName: 'Zain' });
  assert.ok(gated.includes('id="pitch-gate"'));
  assert.ok(gated.includes('data-section="s6"'));
  assert.ok(!gated.includes('data-section="s7"'));
  assert.ok(!gated.includes('<footer>'));
  assert.ok(gated.includes('with Zain'));
  const full = renderPage({ site: site(8), page: 'home', mode: 'client', gated: false, now: new Date('2026-10-23T12:00:00Z') });
  assert.ok(full.includes('data-section="s8"'));
  assert.ok(full.includes('<footer>© 2026 Acme</footer>'));
  assert.ok(!full.includes('id="pitch-gate"'));
  assert.ok(full.includes('href="#pitch-page-secondary"'));
  assert.ok(full.includes('<img class="pitch-logo" src="https://acme.test/logo.png"'));
});

test('studio render shows placeholders for sections still building; client render hides them', () => {
  const s = site(3);
  delete s.pages.home.html.s3;
  const steps = [{ page: 'home', section_key: 's3', status: 'running' }];
  assert.ok(renderPage({ site: s, mode: 'studio', steps }).includes('Designing: S3'));
  assert.ok(!renderPage({ site: s, mode: 'client', steps }).includes('S3'));
});

test('pitch config keeps defaults for blanks and clamps expiry', () => {
  const c = normalizePitchConfig({ housePrompt: '  ', gate: { price: '£199', headline: '' }, expiryDays: 999 });
  assert.equal(c.housePrompt, DEFAULT_PITCH_CONFIG.housePrompt);
  assert.equal(c.gate.price, '£199');
  assert.equal(c.gate.headline, DEFAULT_PITCH_CONFIG.gate.headline);
  assert.equal(c.expiryDays, 14);
  assert.equal(normalizePitchConfig({ expiryDays: 0 }).expiryDays, 0);
});
