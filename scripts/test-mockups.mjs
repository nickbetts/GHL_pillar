import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  candidatePaths, isRewritable, makeSlug, mimeFor, normalizePath, pickEntry, pickFile, rewriteAbsoluteUrls,
  shouldIgnore, signAccess, slugify, validSlug, verifyAccess,
} from '../lib/mockup.js';

test('slugs are safe and unguessable', () => {
  assert.equal(slugify('Northwind: Home Page Redesign!'), 'northwind-home-page-redesign');
  assert.equal(slugify('***'), 'site');
  const slug = makeSlug('Acme Ltd');
  assert.match(slug, /^acme-ltd-[0-9a-f]{6}$/);
  assert.ok(validSlug(slug));
  assert.equal(validSlug('../etc'), false);
  assert.notEqual(makeSlug('Acme'), makeSlug('Acme'));
});

test('paths cannot escape the site, and junk files are ignored', () => {
  assert.equal(normalizePath('css\\app.css'), 'css/app.css');
  assert.equal(normalizePath('/a//b/./c.html'), 'a/b/c.html');
  assert.equal(normalizePath('a%20b/c.png'), 'a b/c.png');
  assert.equal(normalizePath('../secret'), null);
  assert.equal(normalizePath('a/../../b'), null);
  assert.equal(normalizePath('a%2e%2e/b') === null || normalizePath('a%2e%2e/b') === 'a../b', true);
  assert.equal(normalizePath('%2e%2e/x'), null);
  assert.equal(normalizePath(''), '');
  assert.equal(shouldIgnore('.DS_Store'), true);
  assert.equal(shouldIgnore('js/node_modules/x.js'), true);
  assert.equal(shouldIgnore('.git/config'), true);
  assert.equal(shouldIgnore('.env.local'), true);
  assert.equal(shouldIgnore('css/app.css'), false);
});

test('mime types come from the extension, never from the client', () => {
  assert.equal(mimeFor('index.html'), 'text/html; charset=utf-8');
  assert.equal(mimeFor('a/b/app.JS'), 'text/javascript; charset=utf-8');
  assert.equal(mimeFor('font.woff2'), 'font/woff2');
  assert.equal(mimeFor('mystery.bin'), 'application/octet-stream');
  assert.equal(isRewritable('text/css; charset=utf-8'), true);
  assert.equal(isRewritable('image/png'), false);
});

test('root-absolute URLs are pointed back inside the site', () => {
  const html = '<link href="/css/a.css"><script src=\'/js/app.js\'></script><a href="/">Home</a><img src="//cdn.x.com/i.png"><a href="https://x.com/y"><a href="page.html"><img srcset="/a.png 1x, /b.png 2x"><form action="/send">';
  const out = rewriteAbsoluteUrls(html, '/m/demo-1a2b3c');
  assert.match(out, /href="\/m\/demo-1a2b3c\/css\/a\.css"/);
  assert.match(out, /src='\/m\/demo-1a2b3c\/js\/app\.js'/);
  assert.match(out, /<a href="\/m\/demo-1a2b3c\/">Home/);
  assert.match(out, /src="\/\/cdn\.x\.com\/i\.png"/);
  assert.match(out, /href="https:\/\/x\.com\/y"/);
  assert.match(out, /href="page\.html"/);
  assert.match(out, /srcset="\/m\/demo-1a2b3c\/a\.png 1x, \/m\/demo-1a2b3c\/b\.png 2x"/);
  assert.match(out, /action="\/m\/demo-1a2b3c\/send"/);
  const css = "body{background:url(/img/bg.jpg)}@font-face{src:url('/f/x.woff2')}@import '/base.css';.x{background:url(//cdn/y.png)}.y{background:url(img/z.png)}";
  const cssOut = rewriteAbsoluteUrls(css, '/m/demo-1a2b3c');
  assert.match(cssOut, /url\(\/m\/demo-1a2b3c\/img\/bg\.jpg\)/);
  assert.match(cssOut, /url\('\/m\/demo-1a2b3c\/f\/x\.woff2'\)/);
  assert.match(cssOut, /@import '\/m\/demo-1a2b3c\/base\.css'/);
  assert.match(cssOut, /url\(\/\/cdn\/y\.png\)/);
  assert.match(cssOut, /url\(img\/z\.png\)/);
  assert.equal(rewriteAbsoluteUrls('<a href="/m/demo-1a2b3c/x">', '/m/demo-1a2b3c'), '<a href="/m/demo-1a2b3c/x">');
});

test('requests resolve to files, clean URLs and trailing-slash redirects', () => {
  const files = new Set(['index.html', 'about/index.html', 'pricing.html', 'css/app.css', '404.html']);
  const has = (p) => files.has(p);
  assert.deepEqual(pickFile('', 'index.html', has), { type: 'file', path: 'index.html' });
  assert.deepEqual(pickFile('css/app.css', 'index.html', has), { type: 'file', path: 'css/app.css' });
  assert.deepEqual(pickFile('about', 'index.html', has), { type: 'redirect', path: 'about/' });
  assert.deepEqual(pickFile('about/', 'index.html', has), { type: 'redirect', path: 'about/' });
  assert.deepEqual(pickFile('pricing', 'index.html', has), { type: 'file', path: 'pricing.html' });
  assert.deepEqual(pickFile('nope', 'index.html', has), { type: 'notfound' });
  assert.deepEqual(pickFile('../x', 'index.html', has), { type: 'notfound' });
  assert.deepEqual(candidatePaths('about', 'index.html'), ['about', 'about/index.html', 'about.html', '404.html']);
  assert.deepEqual(candidatePaths('', 'home.html'), ['home.html', '404.html']);
  assert.deepEqual(candidatePaths('../x', 'index.html'), []);
});

test('the entry page is the root index.html, else the shallowest one', () => {
  assert.equal(pickEntry(['a.css', 'index.html', 'x/index.html']), 'index.html');
  assert.equal(pickEntry(['css/a.css', 'site/deep/index.html', 'site/index.html']), 'site/index.html');
  assert.equal(pickEntry(['about.html', 'css/a.css']), 'about.html');
});

test('the access cookie is bound to the site and the current password', () => {
  const token = signAccess('demo-1a2b3c', 'hashAAAAAAAAAAAAAAAA');
  assert.equal(verifyAccess(token, 'demo-1a2b3c', 'hashAAAAAAAAAAAAAAAA'), true);
  assert.equal(verifyAccess(token, 'other-site', 'hashAAAAAAAAAAAAAAAA'), false);
  assert.equal(verifyAccess(token, 'demo-1a2b3c', 'hashBBBBBBBBBBBBBBBB'), false, 'a new password signs everyone out');
  assert.equal(verifyAccess(token + 'x', 'demo-1a2b3c', 'hashAAAAAAAAAAAAAAAA'), false);
  assert.equal(verifyAccess('', 'demo-1a2b3c', 'hashAAAAAAAAAAAAAAAA'), false);
  assert.equal(verifyAccess(token, 'demo-1a2b3c', 'hashAAAAAAAAAAAAAAAA', Date.now() + 8 * 24 * 3600 * 1000), false, 'expires after a week');
});

test('folder prep: strips the wrapper, ignores junk, finds nested build folders, flags big files', () => {
  const ctx = { document: { getElementById: () => ({ addEventListener() {}, hidden: false }) }, window: {}, SQ: { init() {} }, location: { origin: 'https://x.test' }, fetch: async () => ({}), crypto: {} };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(new URL('../mockups.js', import.meta.url), 'utf8'), ctx);
  const prepare = ctx.__mockupsPrepare;
  const limits = { maxFileBytes: 1000, maxSiteBytes: 10000 };
  const f = (path, size = 10) => ({ file: { size }, path });

  const a = prepare([f('mysite/index.html'), f('mysite/css/a.css'), f('mysite/.DS_Store'), f('mysite/node_modules/x/y.js'), f('mysite/big.mp4', 5000)], limits);
  assert.equal(a.folderName, 'mysite');
  assert.deepEqual(a.items.map((i) => i.path).sort(), ['css/a.css', 'index.html']);
  assert.equal(a.hasIndex, true);
  assert.equal(a.skipped.length, 1);
  assert.match(a.skipped[0].reason, /size limit|over/);
  assert.equal(a.totalBytes, 20);

  const b = prepare([f('proj/dist/index.html'), f('proj/dist/app.js'), f('proj/README.md')], limits);
  assert.deepEqual(b.items.map((i) => i.path).sort(), ['app.js', 'index.html']);
  assert.equal(b.hasIndex, true);

  const c = prepare([f('only.html')], limits);
  assert.equal(c.folderName, '');
  assert.equal(c.hasIndex, false);

  const d = prepare([f('site/pages/a.html'), f('site/pages/b.html')], limits);
  assert.equal(d.hasIndex, false);
  assert.equal(d.items.length, 2);
});
