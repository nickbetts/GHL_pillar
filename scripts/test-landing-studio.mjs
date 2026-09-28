import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createSessionToken } from '../api/session.js';
import studio, { editWithOpus, publishRevision } from '../api/landing-studio.js';
import publicPage from '../api/landing-public.js';
import { LANDING_PAGES, pageFor, sourceHtml, validatePageHtml } from '../lib/landing-pages.js';

function response() {
  return {
    code:200,
    headers:{},
    status(code) { this.code = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    end(body) { this.body = body; return this; },
  };
}

test('studio allowlist and parser preserve existing generated pages', async () => {
  assert.equal(pageFor('../settings'), null);
  for (const slug of Object.keys(LANDING_PAGES)) {
    const html = await sourceHtml(slug);
    assert.equal(validatePageHtml(html, slug), html);
  }
  const home = await sourceHtml('home');
  assert.throws(() => validatePageHtml(home.replace('<!doctype html>', ''), 'home'), /complete, valid/);
  const growth = await sourceHtml('growth');
  assert.throws(() => validatePageHtml(growth.replace('/click-pages/landing.js', '/missing.js'), 'growth'), /retain its lead form/);
});

test('only actual admin sessions can enter Landing Studio', async () => {
  const adminCookie = `sq_session=${createSessionToken({ id:1, email:'admin@example.com', role:'admin' })}`;
  const repCookie = `sq_session=${createSessionToken({ id:2, email:'rep@example.com', role:'rep' })}`;
  for (const cookie of ['', repCookie]) {
    const result = await studio({ method:'GET', headers:{ cookie }, query:{ action:'list' } }, response());
    assert.equal(result.code, 403);
  }
  const allowed = await studio({ method:'GET', headers:{ cookie:adminCookie }, query:{ action:'list' } }, response());
  assert.equal(allowed.code, 200);
  assert.equal(allowed.body.pages.length, 5);
  const unknown = await studio({ method:'GET', headers:{ cookie:adminCookie }, query:{ action:'get', slug:'../settings' } }, response());
  assert.equal(unknown.code, 404);
  const invalidOrigin = await studio({ method:'POST', headers:{ cookie:adminCookie, origin:'https://other.example', host:'crm.example', 'content-type':'application/json' }, body:{ action:'publish' } }, response());
  assert.equal(invalidOrigin.code, 403);
  const unknownPublic = await publicPage({ method:'GET', query:{ slug:'../../settings' } }, response());
  assert.equal(unknownPublic.code, 404);
});

test('AI edits request the real Opus 5.5 model with structured HTML output', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok:true, json:async () => ({ model:'claude-opus-5-5', stop_reason:'tool_use', content:[{ type:'tool_use', name:'edit_page', input:{ html:'<!doctype html><html><head><title>Test</title></head><body>New page</body></html>', summary:'Changed copy' } }] }) };
  };
  try {
    const result = await editWithOpus({ html:'<html>Old page</html>', instruction:'Change copy', history:[] });
    assert.equal(request.model, 'claude-opus-5-5');
    assert.equal(request.tool_choice.name, 'edit_page');
    assert.equal(result.summary, 'Changed copy');
    assert.match(result.html, /New page/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
});

test('publishing is versioned and rejects stale or colliding edits', async () => {
  const revisions = new Map();
  const sql = async (parts, ...values) => {
    if (parts.join('?').includes('SELECT version, html, published_by')) {
      const current = revisions.get(values[0]);
      return current ? [current] : [];
    }
    if (parts.join('?').includes('INSERT INTO landing_page_revisions')) {
      const [slug, version, html, publishedBy] = values;
      if (revisions.has(slug)) return [];
      const revision = { version, html, published_by:publishedBy, published_at:new Date() };
      revisions.set(slug, revision);
      return [revision];
    }
    throw new Error('Unexpected SQL');
  };
  const first = await publishRevision(sql, { slug:'growth', html:'new html', email:'admin@example.com', baseVersion:0 });
  assert.equal(first.version, 1);
  assert.equal(revisions.get('growth').html, 'new html');
  await assert.rejects(() => publishRevision(sql, { slug:'growth', html:'stale html', email:'admin@example.com', baseVersion:0 }), { status:409 });
  await assert.rejects(() => publishRevision(sql, { slug:'growth', html:'other html', email:'admin@example.com', baseVersion:1 }), { status:409 });
  await assert.rejects(() => publishRevision(sql, { slug:'growth', html:'other html', email:'admin@example.com', baseVersion:'1' }), { status:400 });
});

test('public landing routes and preview sandbox stay connected', () => {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const studioHtml = readFileSync(new URL('../landing-studio.html', import.meta.url), 'utf8');
  assert.match(studioHtml, /sandbox="allow-scripts"/);
  assert.doesNotMatch(studioHtml, /allow-same-origin|allow-forms/);
  for (const [slug, page] of Object.entries(LANDING_PAGES)) {
    assert.ok(vercel.rewrites.some((rewrite) => rewrite.source === page.route && rewrite.destination === `/api/landing-public?slug=${slug}`));
  }
});

test('public Growth page falls back to checked-in HTML if revision storage is unavailable', async () => {
  const databaseUrl = process.env.DATABASE_URL;
  const originalLog = console.error;
  delete process.env.DATABASE_URL;
  console.error = () => {};
  try {
    const result = await publicPage({ method:'GET', query:{ slug:'growth' } }, response());
    assert.equal(result.code, 200);
    assert.equal(result.body, await sourceHtml('growth'));
    assert.equal(result.headers['X-Landing-Fallback'], 'source');
    assert.equal(result.headers['Cache-Control'], 'no-store');
  } finally {
    console.error = originalLog;
    if (databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = databaseUrl;
  }
});