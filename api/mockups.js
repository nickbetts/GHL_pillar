/**
 * Mockups admin API: upload password-protected website folders and manage them.
 *
 * GET  /api/mockups                        list sites (any signed-in user)
 * POST /api/mockups {action:'files', id}   list a site's live files (any signed-in user)
 * POST /api/mockups {action: begin | finalize | abort | set-password | rename | delete}   admins only
 * POST /api/mockups?action=upload&siteId&version&path&seq&total&size   raw bytes of one chunk (admins only)
 *
 * Uploads go into a new, not-yet-live version and only replace the live one on finalize, so a failed upload never breaks a working link.
 */

import { getSql } from './db.js';
import { hasMinRole, hashPassword, resolveIdentity } from './session.js';
import { ensureMockupTables } from '../lib/mockup-db.js';
import { CHUNK_BYTES, MAX_FILE_BYTES, MAX_FILES, MAX_SITE_BYTES, MIN_PASSWORD, makeSlug, mimeFor, normalizePath, pickEntry } from '../lib/mockup.js';

const cleanName = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'binary');
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) return null;
  if (req.readable && !req.readableEnded) {
    const parts = [];
    for await (const part of req) parts.push(part);
    return Buffer.concat(parts);
  }
  return Buffer.alloc(0);
}

const mapSite = (row) => ({
  id: Number(row.id), slug: row.slug, name: row.name, folderName: row.folder_name,
  url: `/m/${row.slug}/`, live: Number(row.live_version) > 0,
  fileCount: Number(row.file_count), totalBytes: Number(row.total_bytes), entryPath: row.entry_path,
  viewCount: Number(row.view_count), lastViewedAt: row.last_viewed_at,
  createdByName: row.created_by_name, createdAt: row.created_at, updatedAt: row.updated_at,
});

export default async function handler(req, res) {
  const identity = resolveIdentity(req);
  if (!identity) return res.status(401).json({ success: false, error: 'Not signed in' });
  const isAdmin = hasMinRole(identity, 'admin');
  const sql = getSql();

  try {
    await ensureMockupTables(sql);

    if (req.method === 'GET') {
      const rows = await sql`SELECT * FROM mockup_sites WHERE live_version > 0 ORDER BY updated_at DESC`;
      const used = rows.reduce((s, r) => s + Number(r.total_bytes), 0);
      return res.status(200).json({
        success: true, isAdmin, sites: rows.map(mapSite), usedBytes: used,
        limits: { maxFileBytes: MAX_FILE_BYTES, maxSiteBytes: MAX_SITE_BYTES, maxFiles: MAX_FILES, minPassword: MIN_PASSWORD },
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    // Raw chunk upload.
    if (req.query?.action === 'upload') {
      if (!isAdmin) return res.status(403).json({ success: false, error: 'Admins only' });
      const siteId = Number(req.query.siteId); const version = Number(req.query.version);
      const seq = Number(req.query.seq); const total = Number(req.query.total); const size = Number(req.query.size);
      const path = normalizePath(req.query.path);
      if (!siteId || !version || !path || !Number.isInteger(seq) || !Number.isInteger(total) || seq < 0 || total < 1 || seq >= total) return res.status(400).json({ success: false, error: 'Bad upload request' });
      if (!(size >= 0) || size > MAX_FILE_BYTES) return res.status(413).json({ success: false, error: `"${path}" is over the ${Math.round(MAX_FILE_BYTES / 1048576)}MB file limit` });
      const body = await readBody(req);
      if (!body) return res.status(400).json({ success: false, error: 'Send the chunk as raw bytes' });
      if (body.length > CHUNK_BYTES + 1024) return res.status(413).json({ success: false, error: 'Chunk too large' });

      const site = (await sql`SELECT id, live_version, pending_version FROM mockup_sites WHERE id = ${siteId}`)[0];
      if (!site) return res.status(404).json({ success: false, error: 'Site not found' });
      if (version <= Number(site.live_version) || version > Number(site.pending_version)) return res.status(409).json({ success: false, error: 'That upload is no longer open' });

      const file = (await sql`
        INSERT INTO mockup_files (site_id, version, path, mime, size, chunks, complete)
        VALUES (${siteId}, ${version}, ${path}, ${mimeFor(path)}, ${size}, ${total}, FALSE)
        ON CONFLICT (site_id, version, path) DO UPDATE SET size = EXCLUDED.size, chunks = EXCLUDED.chunks, mime = EXCLUDED.mime, complete = FALSE
        RETURNING id`)[0];
      if (seq === 0) await sql`DELETE FROM mockup_chunks WHERE file_id = ${file.id}`;
      await sql`
        INSERT INTO mockup_chunks (file_id, seq, data) VALUES (${file.id}, ${seq}, decode(${body.toString('base64')}, 'base64'))
        ON CONFLICT (file_id, seq) DO UPDATE SET data = EXCLUDED.data`;
      if (seq === total - 1) {
        const have = (await sql`SELECT COUNT(*)::int AS n FROM mockup_chunks WHERE file_id = ${file.id}`)[0].n;
        if (have !== total) return res.status(409).json({ success: false, error: `"${path}" arrived incomplete, please retry` });
        await sql`UPDATE mockup_files SET complete = TRUE WHERE id = ${file.id}`;
      }
      return res.status(200).json({ success: true });
    }

    const body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {};
    const action = String(body.action || '');

    if (action === 'files') {
      const id = Number(body.id);
      const site = (await sql`SELECT live_version FROM mockup_sites WHERE id = ${id}`)[0];
      if (!site) return res.status(404).json({ success: false, error: 'Site not found' });
      const files = await sql`SELECT path, size FROM mockup_files WHERE site_id = ${id} AND version = ${site.live_version} AND complete ORDER BY path`;
      return res.status(200).json({ success: true, files: files.map((f) => ({ path: f.path, size: Number(f.size) })) });
    }

    if (!isAdmin) return res.status(403).json({ success: false, error: 'Admins only' });

    if (action === 'begin') {
      const password = String(body.password || '');
      let site;
      if (body.siteId) {
        site = (await sql`SELECT * FROM mockup_sites WHERE id = ${Number(body.siteId)}`)[0];
        if (!site) return res.status(404).json({ success: false, error: 'Site not found' });
        if (password) {
          if (password.length < MIN_PASSWORD) return res.status(400).json({ success: false, error: `Password must be at least ${MIN_PASSWORD} characters` });
          const { hash, salt } = hashPassword(password);
          await sql`UPDATE mockup_sites SET password_hash = ${hash}, password_salt = ${salt} WHERE id = ${site.id}`;
        }
      } else {
        const name = cleanName(body.name);
        if (!name) return res.status(400).json({ success: false, error: 'Give the site a name' });
        if (password.length < MIN_PASSWORD) return res.status(400).json({ success: false, error: `Password must be at least ${MIN_PASSWORD} characters` });
        const { hash, salt } = hashPassword(password);
        site = (await sql`
          INSERT INTO mockup_sites (slug, name, folder_name, password_hash, password_salt, created_by_name, created_by_email)
          VALUES (${makeSlug(name)}, ${name}, ${cleanName(body.folderName) || null}, ${hash}, ${salt}, ${identity.name || null}, ${identity.email || null})
          RETURNING *`)[0];
      }
      const bumped = (await sql`UPDATE mockup_sites SET pending_version = GREATEST(live_version, pending_version) + 1, folder_name = COALESCE(${cleanName(body.folderName) || null}, folder_name) WHERE id = ${site.id} RETURNING id, slug, pending_version`)[0];
      return res.status(200).json({ success: true, siteId: Number(bumped.id), slug: bumped.slug, version: Number(bumped.pending_version), chunkBytes: CHUNK_BYTES });
    }

    if (action === 'finalize') {
      const siteId = Number(body.siteId); const version = Number(body.version); const expected = Number(body.expectedFiles);
      const site = (await sql`SELECT * FROM mockup_sites WHERE id = ${siteId}`)[0];
      if (!site) return res.status(404).json({ success: false, error: 'Site not found' });
      if (version <= Number(site.live_version) || version > Number(site.pending_version)) return res.status(409).json({ success: false, error: 'That upload is no longer open' });
      const files = await sql`SELECT path, size FROM mockup_files WHERE site_id = ${siteId} AND version = ${version} AND complete`;
      if (!files.length || files.length !== expected) return res.status(409).json({ success: false, error: `Expected ${expected} files but ${files.length} arrived. Please try the upload again` });
      const totalBytes = files.reduce((s, f) => s + Number(f.size), 0);
      if (totalBytes > MAX_SITE_BYTES) return res.status(413).json({ success: false, error: `That folder is over the ${Math.round(MAX_SITE_BYTES / 1048576)}MB limit` });
      const entry = pickEntry(files.map((f) => f.path));
      const updated = (await sql`
        UPDATE mockup_sites SET live_version = ${version}, entry_path = ${entry}, file_count = ${files.length}, total_bytes = ${totalBytes}, updated_at = now()
        WHERE id = ${siteId} RETURNING *`)[0];
      await sql`DELETE FROM mockup_files WHERE site_id = ${siteId} AND version <> ${version}`;
      return res.status(200).json({ success: true, site: mapSite(updated), hasIndex: files.some((f) => f.path === 'index.html') });
    }

    if (action === 'abort') {
      const siteId = Number(body.siteId); const version = Number(body.version);
      const site = (await sql`SELECT live_version FROM mockup_sites WHERE id = ${siteId}`)[0];
      if (site && version > Number(site.live_version)) {
        await sql`DELETE FROM mockup_files WHERE site_id = ${siteId} AND version = ${version}`;
        if (Number(site.live_version) === 0) await sql`DELETE FROM mockup_sites WHERE id = ${siteId} AND live_version = 0`;
      }
      return res.status(200).json({ success: true });
    }

    if (action === 'set-password') {
      const password = String(body.password || '');
      if (password.length < MIN_PASSWORD) return res.status(400).json({ success: false, error: `Password must be at least ${MIN_PASSWORD} characters` });
      const { hash, salt } = hashPassword(password);
      const rows = await sql`UPDATE mockup_sites SET password_hash = ${hash}, password_salt = ${salt}, updated_at = now() WHERE id = ${Number(body.id)} RETURNING id`;
      return rows.length ? res.status(200).json({ success: true }) : res.status(404).json({ success: false, error: 'Site not found' });
    }

    if (action === 'rename') {
      const name = cleanName(body.name);
      if (!name) return res.status(400).json({ success: false, error: 'Give the site a name' });
      const rows = await sql`UPDATE mockup_sites SET name = ${name}, updated_at = now() WHERE id = ${Number(body.id)} RETURNING *`;
      return rows.length ? res.status(200).json({ success: true, site: mapSite(rows[0]) }) : res.status(404).json({ success: false, error: 'Site not found' });
    }

    if (action === 'delete') {
      const rows = await sql`DELETE FROM mockup_sites WHERE id = ${Number(body.id)} RETURNING id`;
      return rows.length ? res.status(200).json({ success: true }) : res.status(404).json({ success: false, error: 'Site not found' });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
