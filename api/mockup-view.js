/**
 * Serves an uploaded website at /m/<slug>/... behind its password (rewritten from vercel.json).
 *
 * GET  → the site (or the password page when there is no valid access cookie)
 * POST → checks the password, sets the access cookie, redirects into the site
 * Signed-in team members skip the password so they can preview without asking.
 */

import { getSql } from './db.js';
import { resolveIdentity, verifyPassword } from './session.js';
import { ensureMockupTables } from '../lib/mockup-db.js';
import {
  accessCookieName, ACCESS_TTL_SECONDS, candidatePaths, isRewritable, loginPage, normalizePath, notFoundPage,
  pickFile, readCookie, rewriteAbsoluteUrls, signAccess, validSlug, verifyAccess,
} from '../lib/mockup.js';

const MAX_FAILS = 8;
const WINDOW_MINUTES = 15;
const STREAM_OVER = 4 * 1024 * 1024;

const clientIp = (req) => String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64);

function page(res, status, html, extra = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(html);
}

async function readFileBytes(sql, file) {
  // One chunk per query keeps each database response well under its size limit.
  const parts = [];
  for (let seq = 0; seq < Number(file.chunks); seq += 1) {
    const row = (await sql`SELECT encode(data, 'base64') AS d FROM mockup_chunks WHERE file_id = ${file.id} AND seq = ${seq}`)[0];
    if (!row) throw new Error('A file chunk is missing');
    parts.push(Buffer.from(row.d, 'base64'));
  }
  return Buffer.concat(parts);
}

export default async function handler(req, res) {
  const slug = String(req.query?.slug || '');
  if (!validSlug(slug)) return page(res, 404, notFoundPage());
  const sql = getSql();

  try {
    await ensureMockupTables(sql);
    const site = (await sql`SELECT * FROM mockup_sites WHERE slug = ${slug} AND live_version > 0`)[0];
    if (!site) return page(res, 404, notFoundPage());
    const staff = !!resolveIdentity(req);
    const allowed = staff || verifyAccess(readCookie(req, accessCookieName(slug)), slug, site.password_hash);

    if (req.method === 'POST') {
      const ip = clientIp(req);
      const fails = (await sql`SELECT COUNT(*)::int AS n FROM mockup_attempts WHERE site_id = ${site.id} AND ip = ${ip} AND created_at > now() - ${`${WINDOW_MINUTES} minutes`}::interval`)[0].n;
      if (fails >= MAX_FAILS) return page(res, 429, loginPage({ siteName: site.name, slug, error: 'Too many wrong passwords. Please wait a few minutes and try again.' }));
      const given = String(req.body?.password ?? '');
      if (!verifyPassword(given, site.password_hash, site.password_salt)) {
        await sql`INSERT INTO mockup_attempts (site_id, ip) VALUES (${site.id}, ${ip})`;
        return page(res, 401, loginPage({ siteName: site.name, slug, error: 'That password is not right.' }));
      }
      const cookie = [`${accessCookieName(slug)}=${signAccess(slug, site.password_hash)}`, `Path=/m/${slug}`, 'HttpOnly', 'Secure', 'SameSite=Lax', `Max-Age=${ACCESS_TTL_SECONDS}`].join('; ');
      res.statusCode = 303;
      res.setHeader('Set-Cookie', cookie);
      res.setHeader('Location', `/m/${slug}/`);
      res.setHeader('Cache-Control', 'no-store');
      return res.end();
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
    if (!allowed) return page(res, 401, loginPage({ siteName: site.name, slug }));

    const requested = normalizePath(Array.isArray(req.query?.path) ? req.query.path.join('/') : req.query?.path);
    if (requested === null) return page(res, 404, notFoundPage());
    const wanted = candidatePaths(requested, site.entry_path);
    const found = new Map((await sql`
      SELECT id, path, mime, size, chunks FROM mockup_files WHERE site_id = ${site.id} AND version = ${site.live_version} AND complete AND path = ANY(${wanted})`).map((f) => [f.path, f]));
    let choice = pickFile(requested, site.entry_path, (p) => found.has(p));
    const rawPath = String(Array.isArray(req.query?.path) ? req.query.path.join('/') : req.query?.path || '');
    if (choice.type === 'redirect' && rawPath.endsWith('/')) choice = { type: 'file', path: `${requested}/index.html` };

    if (choice.type === 'redirect') {
      res.statusCode = 308;
      res.setHeader('Location', `/m/${slug}/${choice.path.split('/').map(encodeURIComponent).join('/')}`);
      return res.end();
    }
    const missing = choice.type === 'notfound';
    const file = missing ? found.get('404.html') : found.get(choice.path);
    if (!file) return page(res, 404, notFoundPage());

    const etag = `"${file.id}-${site.live_version}"`;
    if (!missing && String(req.headers['if-none-match'] || '').includes(etag)) { res.statusCode = 304; res.setHeader('ETag', etag); return res.end(); }

    let bytes = await readFileBytes(sql, file);
    if (isRewritable(file.mime)) bytes = Buffer.from(rewriteAbsoluteUrls(bytes.toString('utf8'), `/m/${slug}`), 'utf8');

    if (!staff && !missing && (choice.path === site.entry_path) && requested === '') {
      sql`UPDATE mockup_sites SET view_count = view_count + 1, last_viewed_at = now() WHERE id = ${site.id}`.catch(() => {});
    }

    res.statusCode = missing ? 404 : 200;
    res.setHeader('Content-Type', file.mime);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('ETag', etag);
    if (req.method === 'HEAD') return res.end();
    if (bytes.length > STREAM_OVER) {
      for (let i = 0; i < bytes.length; i += 1024 * 1024) res.write(bytes.subarray(i, i + 1024 * 1024));
      return res.end();
    }
    res.setHeader('Content-Length', bytes.length);
    return res.end(bytes);
  } catch (error) {
    return page(res, 500, `<!doctype html><meta charset="utf-8"><title>Error</title><body style="font:15px system-ui;padding:40px">Something went wrong loading this preview. Please try again.</body>`);
  }
}
