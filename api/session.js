/**
 * Session, password and permission helpers for the sales-queue app.
 *
 * - Passwords are hashed with scrypt + per-user salt (no plaintext stored).
 * - Sessions are stateless signed cookies (HMAC-SHA256), no server store needed.
 * - Roles: admin (Nick) > manager > rep. Capabilities are derived from role.
 *
 * The shared queue password (x-queue-auth) still works for server-to-server
 * scripts and is treated as a `system` identity with admin capabilities.
 */

import crypto from 'crypto';
import { checkAuth } from './auth.js';

const COOKIE_NAME = 'sq_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

function secret() {
  return (
    process.env.SESSION_SECRET ||
    `${process.env.QUEUE_PASSWORD || 'dev'}::${(process.env.DATABASE_URL || '').slice(0, 24)}::sq`
  );
}

// ── Password hashing ─────────────────────────────────────────────────────────

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Signed session tokens ────────────────────────────────────────────────────

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(input) {
  const pad = input.length % 4 ? '='.repeat(4 - (input.length % 4)) : '';
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createSessionToken(user) {
  const payload = {
    uid: user.id,
    email: user.email,
    name: user.name || user.email,
    role: user.role || 'rep',
    ghlOwnerId: user.ghl_owner_id || user.ghlOwnerId || null,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (sign(payloadB64) !== sig) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    return null;
  }
  if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ── Cookie helpers ───────────────────────────────────────────────────────────

function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function setSessionCookie(res, token) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    'Secure',
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`);
}

// ── Identity resolution ──────────────────────────────────────────────────────

/**
 * Resolve the caller's identity from (1) a signed session cookie, or
 * (2) the shared queue password header (server-to-server = system/admin).
 * Returns null when unauthenticated.
 */
export function resolveIdentity(req) {
  const cookies = parseCookies(req);
  const session = verifySessionToken(cookies[COOKIE_NAME]);
  if (session) {
    return {
      uid: session.uid,
      email: session.email,
      name: session.name,
      role: session.role,
      ghlOwnerId: session.ghlOwnerId || null,
      via: 'session',
    };
  }
  if (checkAuth(req) && process.env.QUEUE_PASSWORD) {
    return { uid: 0, email: 'system', name: 'System', role: 'system', ghlOwnerId: null, via: 'shared-password' };
  }
  return null;
}

// ── Capabilities ─────────────────────────────────────────────────────────────

const ROLE_RANK = { rep: 1, manager: 2, admin: 3, system: 3 };

export function roleRank(role) {
  return ROLE_RANK[role] || 0;
}

export function hasMinRole(identity, minRole) {
  return roleRank(identity?.role) >= roleRank(minRole);
}

/** Minimum role required to run each queue action. Anything absent = admin. */
export const ACTION_MIN_ROLE = {
  'enqueue': 'admin',
  'bank-candidates': 'admin',
  'enrich-wave': 'admin',
  'repair-lead-data': 'admin',
  'patch-phones': 'admin',
  'patch-lead-fields': 'admin',
  'fix-mobile-phones': 'admin',
  'patch-phones-force': 'admin',
  'set-phones': 'admin',
  'dedupe-phones': 'admin',
  'vet-roles': 'admin',
  'sync-list': 'admin',
  'delete-lead': 'admin',
  'release-wave': 'manager',
  'merge-company-owners': 'manager',
  'purge-no-phone': 'manager',
  'reassign': 'manager',
  'set-sector': 'manager',
  'qualify': 'manager',
  'convert': 'manager',
  // Reps can work their own leads, but cannot manage other reps' buckets.
  'status': 'rep',
  'priority': 'manager',
  'convert': 'manager',
  'disposition': 'rep',
  'company-contact-state': 'rep',
  'note': 'rep',
  'log-call': 'rep',
  'candidate-stats': 'rep',
  'candidate-list': 'rep',
  'call-history': 'rep',
  'achievements': 'rep',
  'get-config': 'rep',
  'get-rep-themes': 'rep',
  'set-rep-theme': 'manager',
  'set-config': 'admin',
};

export function canRunAction(identity, action) {
  const min = ACTION_MIN_ROLE[action] || 'admin';
  return hasMinRole(identity, min);
}

/** Front-end capability flags, returned by the `me` endpoint. */
export function capsForRole(role) {
  const isAdmin = role === 'admin' || role === 'system';
  const isManager = isAdmin || role === 'manager';
  const canWorkOwnLeads = role === 'rep' || isManager;
  return {
    role,
    isAdmin,
    isManager,
    viewAllLeads: isManager,
    workOwnLeads: canWorkOwnLeads,
    reassign: isManager,
    releaseWave: isManager,
    viewReports: isManager,
    viewWaves: isManager,
    manageUsers: isAdmin,
    bankCandidates: isAdmin,
    vetRoles: isAdmin,
    enqueue: isAdmin,
    editSettings: isAdmin,
    changeStatus: isManager,
    canQualify: isManager,
    convert: isManager,
    editPriority: isManager,
    addNote: isManager,
  };
}
