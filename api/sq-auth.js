/**
 * Sales-queue auth + user management API.
 *
 *   POST /api/sq-auth { action: 'login', email, password }
 *   POST /api/sq-auth { action: 'logout' }
 *   POST /api/sq-auth { action: 'me' }               -> current user + caps
 *   POST /api/sq-auth { action: 'list-users' }       (admin)
 *   POST /api/sq-auth { action: 'create-user', ... } (admin)
 *   POST /api/sq-auth { action: 'update-user', ... } (admin)
 *   POST /api/sq-auth { action: 'set-password', ...} (admin, or self)
 *   POST /api/sq-auth { action: 'deactivate-user' }  (admin)
 *   POST /api/sq-auth { action: 'audit' }            (admin)
 *
 * Admin bootstrap: on first run, if SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD are
 * set and no users exist, an admin account is seeded automatically. Admins can
 * also be created over the shared queue password (system identity).
 */

import { getSql, initAuthTables, writeAudit } from './db.js';
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  resolveIdentity,
  capsForRole,
  hasMinRole,
} from './session.js';
import crypto from 'crypto';

const ROLES = ['admin', 'manager', 'rep'];
const MAX_BODY_BYTES = 16 * 1024;
const LOGIN_LIMIT = 5;

function requestBytes(req) {
  const declared = Number.parseInt(req.headers?.['content-length'] || '0', 10);
  if (Number.isFinite(declared) && declared > 0) return declared;
  return Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
}

function loginIdentityKey(req, email) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const source = `${email}|${forwarded || req.socket?.remoteAddress || 'unknown'}`;
  return crypto.createHash('sha256').update(source).digest('hex');
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    ghlOwnerId: row.ghl_owner_id,
    active: row.active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

async function seedAdminIfNeeded(sql) {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) return;
  const existing = await sql`SELECT COUNT(*)::int AS c FROM app_users`;
  if ((existing[0]?.c || 0) > 0) return;
  const { hash, salt } = hashPassword(password);
  await sql`
    INSERT INTO app_users (email, name, role, password_hash, password_salt, active)
    VALUES (${email.toLowerCase()}, ${'Nick Betts'}, ${'admin'}, ${hash}, ${salt}, TRUE)
    ON CONFLICT (email) DO NOTHING
  `;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (requestBytes(req) > MAX_BODY_BYTES) {
    return res.status(413).json({ success: false, error: 'Request body too large' });
  }

  let sql;
  try {
    sql = getSql();
    await initAuthTables();
    await seedAdminIfNeeded(sql);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  const body = req.body || {};
  const action = body.action || 'me';

  try {
    // ── Login ────────────────────────────────────────────────────────────
    if (action === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email and password required' });
      }
      const identityKey = loginIdentityKey(req, email);
      await sql`DELETE FROM auth_login_attempts WHERE created_at < now() - interval '24 hours'`;
      const recent = await sql`
        SELECT COUNT(*)::int AS c FROM auth_login_attempts
        WHERE identity_key = ${identityKey} AND created_at >= now() - interval '15 minutes'
      `;
      if ((recent[0]?.c || 0) >= LOGIN_LIMIT) {
        await writeAudit(sql, { actorEmail: email, actorRole: null, event: 'login_rate_limited', target: email });
        res.setHeader('Retry-After', '900');
        return res.status(429).json({ success: false, error: 'Too many sign-in attempts. Try again later.' });
      }
      const rows = await sql`SELECT * FROM app_users WHERE lower(email) = ${email} LIMIT 1`;
      const user = rows[0];
      if (!user || !user.active || !verifyPassword(password, user.password_hash, user.password_salt)) {
        await sql`INSERT INTO auth_login_attempts (identity_key) VALUES (${identityKey})`;
        await writeAudit(sql, { actorEmail: email, actorRole: null, event: 'login_failed', target: email });
        return res.status(401).json({ success: false, error: 'Invalid email or password' });
      }
      await sql`DELETE FROM auth_login_attempts WHERE identity_key = ${identityKey}`;
      await sql`UPDATE app_users SET last_login_at = now() WHERE id = ${user.id}`;
      const token = createSessionToken(user);
      setSessionCookie(res, token);
      await writeAudit(sql, { actorEmail: user.email, actorRole: user.role, event: 'login', target: user.email });
      return res.status(200).json({ success: true, user: publicUser(user), caps: capsForRole(user.role) });
    }

    // ── Logout ───────────────────────────────────────────────────────────
    if (action === 'logout') {
      clearSessionCookie(res);
      return res.status(200).json({ success: true });
    }

    // ── Current identity ───────────────────────────────────────────────────
    const identity = resolveIdentity(req);
    if (action === 'me') {
      if (!identity) return res.status(401).json({ success: false, error: 'Not signed in' });
      return res.status(200).json({
        success: true,
        user: { email: identity.email, name: identity.name, role: identity.role, ghlOwnerId: identity.ghlOwnerId },
        caps: capsForRole(identity.role),
      });
    }

    // Everything below requires a signed-in identity.
    if (!identity) return res.status(401).json({ success: false, error: 'Not signed in' });

    // ── Self password change ───────────────────────────────────────────────
    if (action === 'change-my-password') {
      const current = String(body.currentPassword || '');
      const next = String(body.newPassword || '');
      if (next.length < 8) return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
      const rows = await sql`SELECT * FROM app_users WHERE lower(email) = ${identity.email.toLowerCase()} LIMIT 1`;
      const user = rows[0];
      if (!user || !verifyPassword(current, user.password_hash, user.password_salt)) {
        return res.status(401).json({ success: false, error: 'Current password is incorrect' });
      }
      const { hash, salt } = hashPassword(next);
      await sql`UPDATE app_users SET password_hash = ${hash}, password_salt = ${salt}, updated_at = now() WHERE id = ${user.id}`;
      await writeAudit(sql, { actorEmail: user.email, actorRole: user.role, event: 'password_changed', target: user.email });
      return res.status(200).json({ success: true });
    }

    // ── Admin-only user management ─────────────────────────────────────────
    if (!hasMinRole(identity, 'admin')) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    if (action === 'list-users') {
      const rows = await sql`SELECT * FROM app_users ORDER BY role, lower(email)`;
      return res.status(200).json({ success: true, users: rows.map(publicUser) });
    }

    if (action === 'create-user') {
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim() || email;
      const role = ROLES.includes(body.role) ? body.role : 'rep';
      const password = String(body.password || '');
      const ghlOwnerId = body.ghlOwnerId ? String(body.ghlOwnerId) : null;
      if (!email || password.length < 8) {
        return res.status(400).json({ success: false, error: 'Email and an 8+ character password are required' });
      }
      const { hash, salt } = hashPassword(password);
      const rows = await sql`
        INSERT INTO app_users (email, name, role, password_hash, password_salt, ghl_owner_id, active)
        VALUES (${email}, ${name}, ${role}, ${hash}, ${salt}, ${ghlOwnerId}, TRUE)
        ON CONFLICT (email) DO NOTHING
        RETURNING *
      `;
      if (!rows[0]) return res.status(409).json({ success: false, error: 'A user with that email already exists' });
      await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: 'user_created', target: email, meta: { role } });
      return res.status(200).json({ success: true, user: publicUser(rows[0]) });
    }

    if (action === 'update-user') {
      const id = Number.parseInt(body.id, 10);
      if (!id) return res.status(400).json({ success: false, error: 'User id required' });
      const role = ROLES.includes(body.role) ? body.role : null;
      const name = body.name != null ? String(body.name) : null;
      const ghlOwnerId = body.ghlOwnerId !== undefined ? (body.ghlOwnerId ? String(body.ghlOwnerId) : null) : undefined;
      const active = typeof body.active === 'boolean' ? body.active : null;
      const rows = await sql`
        UPDATE app_users SET
          name = COALESCE(${name}, name),
          role = COALESCE(${role}, role),
          ghl_owner_id = CASE WHEN ${ghlOwnerId === undefined} THEN ghl_owner_id ELSE ${ghlOwnerId ?? null} END,
          active = COALESCE(${active}, active),
          updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `;
      if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
      await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: 'user_updated', target: rows[0].email, meta: { role, active } });
      return res.status(200).json({ success: true, user: publicUser(rows[0]) });
    }

    if (action === 'set-password') {
      const id = Number.parseInt(body.id, 10);
      const password = String(body.password || '');
      if (!id || password.length < 8) return res.status(400).json({ success: false, error: 'User id and an 8+ character password required' });
      const { hash, salt } = hashPassword(password);
      const rows = await sql`
        UPDATE app_users SET password_hash = ${hash}, password_salt = ${salt}, updated_at = now()
        WHERE id = ${id} RETURNING email
      `;
      if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
      await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: 'password_reset', target: rows[0].email });
      return res.status(200).json({ success: true });
    }

    if (action === 'deactivate-user') {
      const id = Number.parseInt(body.id, 10);
      if (!id) return res.status(400).json({ success: false, error: 'User id required' });
      const rows = await sql`UPDATE app_users SET active = FALSE, updated_at = now() WHERE id = ${id} RETURNING email`;
      if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
      await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: 'user_deactivated', target: rows[0].email });
      return res.status(200).json({ success: true });
    }

    if (action === 'audit') {
      const rows = await sql`SELECT * FROM auth_audit ORDER BY created_at DESC LIMIT 200`;
      return res.status(200).json({ success: true, audit: rows });
    }

    return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
