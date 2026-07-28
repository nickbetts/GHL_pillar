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
