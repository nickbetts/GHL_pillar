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

import { getSql, initAuthTables, initTimeOffTable, writeAudit } from './db.js';
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
const DAY_PARTS = new Set(['full', 'am', 'pm', 'hours']);

function parseDateOnly(value) {
  const v = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function normalizeDayPart(value) {
  const v = String(value || '').trim().toLowerCase();
  return DAY_PARTS.has(v) ? v : null;
}

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
    senderEmail: row.sender_email,
    senderTitle: row.sender_title || null,
    senderSignature: row.sender_signature || null,
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
    await initTimeOffTable();
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
      let avatar = null;
      let avatarColor = null;
      let senderEmail = null;
      let senderTitle = null;
      let senderSignature = null;
      if (identity.email && identity.email !== 'system') {
        try {
          const rows = await sql`SELECT avatar, avatar_color, sender_email, sender_title, sender_signature FROM app_users WHERE lower(email) = ${identity.email.toLowerCase()} LIMIT 1`;
          avatar = rows[0]?.avatar || null;
          avatarColor = rows[0]?.avatar_color || null;
          senderEmail = rows[0]?.sender_email || null;
          senderTitle = rows[0]?.sender_title || null;
          senderSignature = rows[0]?.sender_signature || null;
        } catch { /* avatar is best-effort */ }
      }
      return res.status(200).json({
        success: true,
        user: { email: identity.email, name: identity.name, role: identity.role, ghlOwnerId: identity.ghlOwnerId, avatar, avatarColor, senderEmail, senderTitle, senderSignature },
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

    if (action === 'list-time-off') {
      const ownerId = body.ownerId ? String(body.ownerId).trim() : null;
      const includeCanceled = !!body.includeCanceled;
      const fromDate = parseDateOnly(body.fromDate);
      const toDate = parseDateOnly(body.toDate);

      const rows = await sql`
        SELECT
          r.id,
          r.owner_id,
          r.user_id,
          r.start_date,
          r.end_date,
          r.day_part,
          r.hours_off,
          r.note,
          r.created_by_email,
          r.created_by_role,
          r.created_at,
          r.updated_at,
          r.canceled_at,
          r.canceled_by_email,
          u.email AS user_email,
          u.name AS user_name
        FROM rep_time_off r
        LEFT JOIN app_users u ON u.id = r.user_id
        WHERE (${ownerId}::text IS NULL OR r.owner_id = ${ownerId})
          AND (${includeCanceled}::boolean = TRUE OR r.canceled_at IS NULL)
          AND (${fromDate}::date IS NULL OR r.end_date >= ${fromDate}::date)
          AND (${toDate}::date IS NULL OR r.start_date <= ${toDate}::date)
        ORDER BY r.start_date DESC, r.created_at DESC
        LIMIT 500
      `;

      return res.status(200).json({
        success: true,
        entries: rows.map((r) => ({
          id: r.id,
          ownerId: r.owner_id,
          userId: r.user_id,
          userEmail: r.user_email || null,
          userName: r.user_name || null,
          startDate: r.start_date,
          endDate: r.end_date,
          dayPart: r.day_part,
          hoursOff: r.hours_off == null ? null : Number(r.hours_off),
          note: r.note || '',
          createdByEmail: r.created_by_email || null,
          createdByRole: r.created_by_role || null,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          canceledAt: r.canceled_at,
          canceledByEmail: r.canceled_by_email || null,
        })),
      });
    }

    if (action === 'create-time-off') {
      const ownerId = String(body.ownerId || '').trim();
      const dayPart = normalizeDayPart(body.dayPart);
      const startDate = parseDateOnly(body.startDate);
      const endDate = parseDateOnly(body.endDate) || startDate;
      const note = String(body.note || '').trim() || null;
      const hoursOffRaw = body.hoursOff;
      const hoursOff = Number.isFinite(Number(hoursOffRaw)) ? Number(hoursOffRaw) : null;

      if (!ownerId) return res.status(400).json({ success: false, error: 'Owner is required' });
      if (!dayPart) return res.status(400).json({ success: false, error: 'Leave type is required' });
      if (!startDate || !endDate) return res.status(400).json({ success: false, error: 'Start and end dates are required' });
      if (new Date(`${endDate}T00:00:00Z`) < new Date(`${startDate}T00:00:00Z`)) {
        return res.status(400).json({ success: false, error: 'End date must be on or after start date' });
      }
      if (dayPart === 'hours') {
        if (startDate !== endDate) {
          return res.status(400).json({ success: false, error: 'Custom hours can only be set for one day at a time' });
        }
        if (!Number.isFinite(hoursOff) || hoursOff <= 0 || hoursOff > 8) {
          return res.status(400).json({ success: false, error: 'Hours off must be between 0.25 and 8' });
        }
      }

      const matchedUser = await sql`
        SELECT id, email
        FROM app_users
        WHERE ghl_owner_id = ${ownerId}
        ORDER BY active DESC, updated_at DESC
        LIMIT 1
      `;
      const userId = matchedUser[0]?.id || null;

      const rows = await sql`
        INSERT INTO rep_time_off (
          owner_id,
          user_id,
          start_date,
          end_date,
          day_part,
          hours_off,
          note,
          created_by_email,
          created_by_role,
          updated_at
        ) VALUES (
          ${ownerId},
          ${userId},
          ${startDate}::date,
          ${endDate}::date,
          ${dayPart},
          ${dayPart === 'hours' ? hoursOff : null},
          ${note},
          ${identity.email || null},
          ${identity.role || null},
          now()
        )
        RETURNING id, owner_id, start_date, end_date, day_part, hours_off, note, created_at
      `;

      const entry = rows[0];
      await writeAudit(sql, {
        actorEmail: identity.email,
        actorRole: identity.role,
        event: 'time_off_created',
        target: ownerId,
        meta: {
          id: entry?.id || null,
          ownerId,
          startDate,
          endDate,
          dayPart,
          hoursOff: dayPart === 'hours' ? hoursOff : null,
        },
      });

      return res.status(200).json({
        success: true,
        entry: entry ? {
          id: entry.id,
          ownerId: entry.owner_id,
          startDate: entry.start_date,
          endDate: entry.end_date,
          dayPart: entry.day_part,
          hoursOff: entry.hours_off == null ? null : Number(entry.hours_off),
          note: entry.note || '',
          createdAt: entry.created_at,
        } : null,
      });
    }

    if (action === 'cancel-time-off') {
      const id = Number.parseInt(body.id, 10);
      if (!id) return res.status(400).json({ success: false, error: 'Entry id is required' });

      const rows = await sql`
        UPDATE rep_time_off
        SET canceled_at = now(),
            canceled_by_email = ${identity.email || null},
            updated_at = now()
        WHERE id = ${id}
          AND canceled_at IS NULL
        RETURNING id, owner_id
      `;
      if (!rows[0]) return res.status(404).json({ success: false, error: 'Entry not found or already cancelled' });

      await writeAudit(sql, {
        actorEmail: identity.email,
        actorRole: identity.role,
        event: 'time_off_canceled',
        target: rows[0].owner_id,
        meta: { id: rows[0].id },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'create-user') {
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim() || email;
      const role = ROLES.includes(body.role) ? body.role : 'rep';
      const senderEmail = body.senderEmail ? String(body.senderEmail).trim().toLowerCase() : email;
      const senderTitle = body.senderTitle ? String(body.senderTitle).trim().slice(0, 200) : null;
      const senderSignature = body.senderSignature ? String(body.senderSignature).trim().slice(0, 4000) : null;
      const password = String(body.password || '');
      const ghlOwnerId = body.ghlOwnerId ? String(body.ghlOwnerId) : null;
      if (!email || password.length < 8) {
        return res.status(400).json({ success: false, error: 'Email and an 8+ character password are required' });
      }
      const { hash, salt } = hashPassword(password);
      const rows = await sql`
        INSERT INTO app_users (email, name, role, sender_email, sender_title, sender_signature, password_hash, password_salt, ghl_owner_id, active)
        VALUES (${email}, ${name}, ${role}, ${senderEmail}, ${senderTitle}, ${senderSignature}, ${hash}, ${salt}, ${ghlOwnerId}, TRUE)
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
      const senderEmail = body.senderEmail !== undefined ? (body.senderEmail ? String(body.senderEmail).trim().toLowerCase() : null) : undefined;
      const senderTitle = body.senderTitle !== undefined ? (body.senderTitle ? String(body.senderTitle).trim().slice(0, 200) : null) : undefined;
      const senderSignature = body.senderSignature !== undefined ? (body.senderSignature ? String(body.senderSignature).trim().slice(0, 4000) : null) : undefined;
      const active = typeof body.active === 'boolean' ? body.active : null;
      const rows = await sql`
        UPDATE app_users SET
          name = COALESCE(${name}, name),
          role = COALESCE(${role}, role),
          sender_email = CASE WHEN ${senderEmail === undefined} THEN sender_email ELSE ${senderEmail ?? null} END,
          sender_title = CASE WHEN ${senderTitle === undefined} THEN sender_title ELSE ${senderTitle ?? null} END,
          sender_signature = CASE WHEN ${senderSignature === undefined} THEN sender_signature ELSE ${senderSignature ?? null} END,
          ghl_owner_id = CASE WHEN ${ghlOwnerId === undefined} THEN ghl_owner_id ELSE ${ghlOwnerId ?? null} END,
          active = COALESCE(${active}, active),
          updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `;
      if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
      await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: 'user_updated', target: rows[0].email, meta: { role, active, senderEmail, senderTitle, senderSignature: senderSignature ? '[updated]' : senderSignature } });
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
