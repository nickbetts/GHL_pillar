/**
 * Rep profile API — lets a signed-in user set a personal avatar that is used
 * anywhere their circle initials appear (sidebar, weekly leaderboard, etc.).
 *
 *   POST /api/rep-profile { action: 'me' }         -> own avatar profile
 *   POST /api/rep-profile { action: 'update', avatar, avatarColor }
 *   POST /api/rep-profile { action: 'directory' }  -> all reps' avatars (signed in)
 *
 * Avatar is either a short emoji string or a small data-URL image (resized
 * client-side). avatarColor is a hex background used behind initials/emoji.
 */

import { getSql, initAuthTables } from './db.js';
import { resolveIdentity } from './session.js';

// Avatar images are resized client-side to ~128px, so this cap is generous.
const MAX_BODY_BYTES = 400 * 1024;
const MAX_AVATAR_CHARS = 300 * 1024;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ALLOWED_IMAGE = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/;

function requestBytes(req) {
  const declared = Number.parseInt(req.headers?.['content-length'] || '0', 10);
  if (Number.isFinite(declared) && declared > 0) return declared;
  return Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
}

function normalizeAvatar(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: true, value: null };
  if (value.length > MAX_AVATAR_CHARS) return { ok: false, error: 'Avatar image is too large' };
  if (value.startsWith('data:')) {
    if (!ALLOWED_IMAGE.test(value)) return { ok: false, error: 'Unsupported image format' };
    return { ok: true, value };
  }
  // Treat anything else as an emoji / short glyph.
  if (value.length > 16) return { ok: false, error: 'Avatar glyph is too long' };
  return { ok: true, value };
}

function normalizeColor(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: true, value: null };
  if (!HEX_COLOR.test(value)) return { ok: false, error: 'Colour must be a hex value like #4f46e5' };
  return { ok: true, value };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (requestBytes(req) > MAX_BODY_BYTES) {
    return res.status(413).json({ success: false, error: 'Avatar is too large (max ~300KB)' });
  }

  let sql;
  try {
    sql = getSql();
    await initAuthTables();
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  const identity = resolveIdentity(req);
  if (!identity || !identity.email || identity.email === 'system') {
    return res.status(401).json({ success: false, error: 'Not signed in' });
  }

  const body = req.body || {};
  const action = body.action || 'me';

  try {
    if (action === 'directory') {
      const rows = await sql`
        SELECT ghl_owner_id, name, avatar, avatar_color
        FROM app_users
        WHERE ghl_owner_id IS NOT NULL AND ghl_owner_id <> '' AND active = TRUE
      `;
      return res.status(200).json({
        success: true,
        reps: rows.map((row) => ({
          ownerId: row.ghl_owner_id,
          name: row.name,
          avatar: row.avatar || null,
          avatarColor: row.avatar_color || null,
        })),
      });
    }

    if (action === 'me') {
      const rows = await sql`
        SELECT email, name, ghl_owner_id, avatar, avatar_color
        FROM app_users WHERE lower(email) = ${identity.email.toLowerCase()} LIMIT 1
      `;
      const row = rows[0];
      return res.status(200).json({
        success: true,
        profile: {
          email: identity.email,
          name: row?.name || identity.name,
          ghlOwnerId: row?.ghl_owner_id || identity.ghlOwnerId || null,
          avatar: row?.avatar || null,
          avatarColor: row?.avatar_color || null,
        },
      });
    }

    if (action === 'update') {
      const avatar = normalizeAvatar(body.avatar);
      if (!avatar.ok) return res.status(400).json({ success: false, error: avatar.error });
      const color = normalizeColor(body.avatarColor);
      if (!color.ok) return res.status(400).json({ success: false, error: color.error });

      const rows = await sql`
        UPDATE app_users
        SET avatar = ${avatar.value}, avatar_color = ${color.value}, updated_at = now()
        WHERE lower(email) = ${identity.email.toLowerCase()}
        RETURNING email, name, ghl_owner_id, avatar, avatar_color
      `;
      const row = rows[0];
      if (!row) return res.status(404).json({ success: false, error: 'Account not found' });
      return res.status(200).json({
        success: true,
        profile: {
          email: row.email,
          name: row.name,
          ghlOwnerId: row.ghl_owner_id,
          avatar: row.avatar || null,
          avatarColor: row.avatar_color || null,
        },
      });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
