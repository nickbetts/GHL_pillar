import { getSql } from './db.js';
import { hasMinRole, resolveIdentity } from './session.js';

const ASSET_KEY = 'zen-default-background';
const MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/mov'
]);

async function ensureAssetTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS app_binary_assets (
      asset_key TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      data BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body instanceof Uint8Array) return Buffer.from(req.body);
  if (req.body && Array.isArray(req.body.data)) return Buffer.from(req.body.data);
  if (typeof req.body === 'string') return Buffer.from(req.body, 'binary');
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  const identity = resolveIdentity(req);
  if (!identity) return res.status(401).json({ success: false, error: 'Not signed in' });

  let sql;
  try {
    sql = getSql();
    await ensureAssetTable(sql);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  if (req.method === 'GET') {
    const rows = await sql`SELECT mime_type, data FROM app_binary_assets WHERE asset_key = ${ASSET_KEY} LIMIT 1`;
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Background image not found' });
    res.setHeader('Content-Type', rows[0].mime_type);
    res.setHeader('Cache-Control', 'private, max-age=300, must-revalidate');
    return res.status(200).send(Buffer.from(rows[0].data));
  }

  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!hasMinRole(identity, 'admin')) return res.status(403).json({ success: false, error: 'Admin access required' });

  const mimeType = String(req.headers?.['content-type'] || '').split(';')[0].toLowerCase();
  if (!MIME_TYPES.has(mimeType)) return res.status(400).json({ success: false, error: 'Upload a PNG, JPEG, WebP image, or an MP4, WEBM, OGG, MOV video' });
  const data = await readBody(req);
  if (!data.length) return res.status(400).json({ success: false, error: 'File data required' });

  await sql`
    INSERT INTO app_binary_assets (asset_key, mime_type, data, updated_at)
    VALUES (${ASSET_KEY}, ${mimeType}, ${data}, now())
    ON CONFLICT (asset_key) DO UPDATE SET mime_type = EXCLUDED.mime_type, data = EXCLUDED.data, updated_at = now()
  `;
  return res.status(200).json({ success: true, url: '/api/zen-background' });
}
