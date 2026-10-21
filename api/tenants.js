/**
 * Tenant management for the owner workspace (i3MEDIA admins only).
 *
 *   GET  /api/tenants                               -> list tenants
 *   POST /api/tenants { action: 'create', name, slug, adminEmail, adminName }
 *   POST /api/tenants { action: 'set-status', id, status: 'active' | 'suspended' }
 *   POST /api/tenants { action: 'reset-admin', id, email }   -> new one-time password
 */

import { getSql, writeAudit } from './db.js';
import { resolveIdentity, hasMinRole, hashPassword } from './session.js';
import { OWNER_SLUG, validTenantSlug, isReservedSlug, tenantUrl } from '../lib/tenant.js';
import { ensureTenantTables, generateTempPassword } from '../lib/tenant-db.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fail = (res, status, error) => res.status(status).json({ success: false, error });

export default async function handler(req, res) {
  const identity = resolveIdentity(req);
  if (!identity) return fail(res, 401, 'Not signed in');
  if (identity.tenant !== OWNER_SLUG || identity.impersonating || !hasMinRole(identity, 'admin')) return fail(res, 403, 'Only i3MEDIA admins can manage tenants');

  const sql = getSql();
  try {
    await ensureTenantTables(sql);
    const body = req.method === 'POST' ? (req.body || {}) : {};
    const action = req.method === 'GET' ? 'list' : String(body.action || '');

    if (action === 'list') {
      const rows = await sql`
        SELECT t.id, t.slug, t.name, t.is_owner, t.status, t.created_by, t.created_at,
               (SELECT COUNT(*)::int FROM tenant_users u WHERE u.tenant_id = t.id) AS users,
               (SELECT MAX(last_login_at) FROM tenant_users u WHERE u.tenant_id = t.id) AS last_login_at
        FROM tenants t ORDER BY t.is_owner DESC, lower(t.name)`;
      return res.status(200).json({ success: true, tenants: rows.map((t) => ({ ...t, url: tenantUrl(t.slug) })) });
    }

    if (action === 'create') {
      const name = String(body.name || '').trim().slice(0, 80);
      const slug = String(body.slug || '').trim().toLowerCase();
      const adminEmail = String(body.adminEmail || '').trim().toLowerCase();
      const adminName = String(body.adminName || '').trim().slice(0, 80) || adminEmail;
      if (!name) return fail(res, 400, 'Enter the company name');
      if (!validTenantSlug(slug)) return fail(res, 400, 'The address must be 3-32 letters, numbers or hyphens, starting with a letter');
      if (isReservedSlug(slug) || slug === OWNER_SLUG) return fail(res, 400, 'That address is reserved, choose another');
      if (!EMAIL_RE.test(adminEmail)) return fail(res, 400, 'Enter the first admin\'s email');
      const created = (await sql`INSERT INTO tenants (slug, name, created_by) VALUES (${slug}, ${name}, ${identity.email}) ON CONFLICT (slug) DO NOTHING RETURNING id, slug, name`)[0];
      if (!created) return fail(res, 409, 'That address is already taken');
      const password = generateTempPassword();
      const { hash, salt } = hashPassword(password);
      await sql`INSERT INTO tenant_users (tenant_id, email, name, role, password_hash, password_salt) VALUES (${created.id}, ${adminEmail}, ${adminName}, 'admin', ${hash}, ${salt})`;
      await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: 'tenant_created', target: slug, meta: { adminEmail } });
      return res.status(200).json({ success: true, tenant: { ...created, url: tenantUrl(slug) }, admin: { email: adminEmail, password } });
    }

    const id = Number.parseInt(body.id, 10);
    const tenant = id ? (await sql`SELECT id, slug, is_owner FROM tenants WHERE id = ${id}`)[0] : null;
    if (!tenant) return fail(res, 404, 'Tenant not found');
    if (tenant.is_owner) return fail(res, 400, 'The owner workspace cannot be changed here');

    if (action === 'set-status') {
      const status = body.status === 'suspended' ? 'suspended' : 'active';
      await sql`UPDATE tenants SET status = ${status} WHERE id = ${tenant.id}`;
      await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: `tenant_${status}`, target: tenant.slug });
      return res.status(200).json({ success: true });
    }

    if (action === 'reset-admin') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = generateTempPassword();
      const { hash, salt } = hashPassword(password);
      const rows = await sql`UPDATE tenant_users SET password_hash = ${hash}, password_salt = ${salt} WHERE tenant_id = ${tenant.id} AND lower(email) = ${email} RETURNING email`;
      if (!rows[0]) return fail(res, 404, 'No user with that email in this tenant');
      await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: 'tenant_admin_password_reset', target: `${tenant.slug}:${email}` });
      return res.status(200).json({ success: true, admin: { email, password } });
    }

    return fail(res, 400, 'Unknown action');
  } catch (error) {
    return fail(res, 500, 'Tenant request failed');
  }
}
