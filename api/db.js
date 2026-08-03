/**
 * Neon Postgres client for the Apollo sales-queue staging store.
 *
 * This staging layer holds Apollo leads WHILE the sales team works them.
 * Cold / uncontacted leads live here only — they are NOT written to GHL
 * until a rep qualifies or converts them (see api/apollo-sales-queue.js).
 *
 * Requires a dedicated Neon project connection string in DATABASE_URL.
 */

import { neon } from '@neondatabase/serverless';

let _sql;

export function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Add your dedicated Neon connection string.');
  }
  if (!_sql) {
    _sql = neon(connectionString);
  }
  return _sql;
}

/**
 * Create the staging table + indexes (idempotent).
 */
export async function initQueueTable() {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS queue_leads (
      id                BIGSERIAL PRIMARY KEY,
      apollo_id         TEXT,
      first_name        TEXT,
      last_name         TEXT,
      name              TEXT,
      title             TEXT,
      email             TEXT UNIQUE,
      phone             TEXT,
      company_name      TEXT,
      company_website   TEXT,
      company_industry  TEXT,
      sector            TEXT,
      sub_sector        TEXT,
      company_employees INTEGER,
      company_revenue   TEXT,
      linkedin_url      TEXT,
      priority          TEXT DEFAULT 'warm',
      status            TEXT NOT NULL DEFAULT 'to_contact',
      call_notes        TEXT,
      owner             TEXT,
      owner_id          TEXT,
      disposition       TEXT,
      callback_at       TIMESTAMPTZ,
      last_touch_at     TIMESTAMPTZ,
      ghl_contact_id    TEXT,
      ghl_opportunity_id TEXT,
      apollo_synced     BOOLEAN DEFAULT FALSE,
      raw               JSONB,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // Idempotent column adds for pre-existing tables
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS owner_id TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS disposition TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS callback_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS apollo_synced BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS sector TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS sub_sector TEXT`;

  await sql`CREATE INDEX IF NOT EXISTS queue_leads_status_idx ON queue_leads (status)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_leads_priority_idx ON queue_leads (priority)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_leads_owner_idx ON queue_leads (owner_id)`;

  return { ok: true };
}

/**
 * Create the auth tables (users + audit log). Idempotent.
 * Roles: 'admin' (full control) | 'manager' (team ops) | 'rep' (own leads).
 */
export async function initAuthTables() {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS app_users (
      id            BIGSERIAL PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      name          TEXT,
      role          TEXT NOT NULL DEFAULT 'rep',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      ghl_owner_id  TEXT,
      active        BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS app_users_email_idx ON app_users (lower(email))`;

  await sql`
    CREATE TABLE IF NOT EXISTS auth_audit (
      id          BIGSERIAL PRIMARY KEY,
      actor_email TEXT,
      actor_role  TEXT,
      event       TEXT NOT NULL,
      target      TEXT,
      meta        JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS auth_audit_created_idx ON auth_audit (created_at DESC)`;

  return { ok: true };
}

/**
 * Create the rep time-off table (idempotent).
 * Stores admin-entered leave windows for fair reporting adjustments.
 */
export async function initTimeOffTable() {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS rep_time_off (
      id                BIGSERIAL PRIMARY KEY,
      owner_id          TEXT NOT NULL,
      user_id           BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
      start_date        DATE NOT NULL,
      end_date          DATE NOT NULL,
      day_part          TEXT NOT NULL DEFAULT 'full',
      hours_off         NUMERIC(5,2),
      note              TEXT,
      created_by_email  TEXT,
      created_by_role   TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      canceled_at       TIMESTAMPTZ,
      canceled_by_email TEXT,
      CONSTRAINT rep_time_off_day_part_chk CHECK (day_part IN ('full', 'am', 'pm', 'hours')),
      CONSTRAINT rep_time_off_date_range_chk CHECK (end_date >= start_date),
      CONSTRAINT rep_time_off_hours_chk CHECK (
        day_part <> 'hours' OR (hours_off IS NOT NULL AND hours_off > 0 AND hours_off <= 8)
      )
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS rep_time_off_owner_idx ON rep_time_off (owner_id, start_date, end_date)`;
  await sql`CREATE INDEX IF NOT EXISTS rep_time_off_active_idx ON rep_time_off (start_date, end_date) WHERE canceled_at IS NULL`;

  return { ok: true };
}

/** Append an audit entry (best-effort; never throws into the caller). */
export async function writeAudit(sql, { actorEmail, actorRole, event, target, meta }) {
  try {
    await sql`
      INSERT INTO auth_audit (actor_email, actor_role, event, target, meta)
      VALUES (${actorEmail || null}, ${actorRole || null}, ${event}, ${target || null}, ${meta ? JSON.stringify(meta) : null})
    `;
  } catch {
    // auditing must never break the request
  }
}
