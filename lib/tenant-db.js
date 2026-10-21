import crypto from 'crypto';
import { OWNER_SLUG } from './tenant.js';

let ready = null;

/** Additive only: new tables, nothing existing is altered. */
export function ensureTenantTables(sql) {
  if (!ready) {
    ready = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS tenants (
          id BIGSERIAL PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          is_owner BOOLEAN NOT NULL DEFAULT FALSE,
          status TEXT NOT NULL DEFAULT 'active',
          created_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS tenant_users (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          name TEXT,
          role TEXT NOT NULL DEFAULT 'admin',
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          last_login_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS tenant_users_email_idx ON tenant_users (tenant_id, lower(email))`;
      await sql`INSERT INTO tenants (slug, name, is_owner) VALUES (${OWNER_SLUG}, 'i3MEDIA', TRUE) ON CONFLICT (slug) DO NOTHING`;
    })().catch((error) => { ready = null; throw error; });
  }
  return ready;
}

export async function getTenant(sql, slug) {
  return (await sql`SELECT id, slug, name, is_owner, status, created_at FROM tenants WHERE slug = ${slug}`)[0] || null;
}

/** A readable one-time password: no look-alike characters. */
export function generateTempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(14);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
