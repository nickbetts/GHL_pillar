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
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS archived_reason TEXT`;

  await sql`
    CREATE TABLE IF NOT EXISTS opportunity_meetings (
      id                 BIGSERIAL PRIMARY KEY,
      lead_id            BIGINT NOT NULL REFERENCES queue_leads(id) ON DELETE CASCADE,
      sequence_no        INTEGER NOT NULL,
      meeting_type       TEXT NOT NULL DEFAULT 'follow_up',
      status             TEXT NOT NULL DEFAULT 'scheduled',
      booked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      scheduled_for      TIMESTAMPTZ NOT NULL,
      occurred_at        TIMESTAMPTZ,
      canceled_at        TIMESTAMPTZ,
      booking_channel    TEXT NOT NULL DEFAULT 'manual',
      primary_owner_id   TEXT,
      primary_owner_name TEXT,
      notes              TEXT,
      outcome_notes      TEXT,
      calendar_provider  TEXT,
      calendar_event_id  TEXT,
      meta               JSONB,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT opportunity_meetings_sequence_chk CHECK (sequence_no >= 1),
      CONSTRAINT opportunity_meetings_status_chk CHECK (status IN ('scheduled', 'completed', 'no_show', 'cancelled')),
      CONSTRAINT opportunity_meetings_type_chk CHECK (meeting_type IN ('discovery', 'demo', 'follow_up', 'proposal_review', 'close', 'other')),
      CONSTRAINT opportunity_meetings_time_chk CHECK (occurred_at IS NULL OR occurred_at >= booked_at),
      UNIQUE (lead_id, sequence_no)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS opportunity_meetings_lead_idx ON opportunity_meetings (lead_id, scheduled_for DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS opportunity_meetings_scheduled_idx ON opportunity_meetings (scheduled_for)`;
  await sql`CREATE INDEX IF NOT EXISTS opportunity_meetings_owner_idx ON opportunity_meetings (primary_owner_id, scheduled_for DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS opportunity_meetings_status_idx ON opportunity_meetings (status, scheduled_for DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS opportunity_meeting_participants (
      id          BIGSERIAL PRIMARY KEY,
      meeting_id  BIGINT NOT NULL REFERENCES opportunity_meetings(id) ON DELETE CASCADE,
      owner_id    TEXT NOT NULL,
      owner_name  TEXT,
      role        TEXT NOT NULL DEFAULT 'accompanying',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT opportunity_meeting_participants_role_chk CHECK (role IN ('primary', 'accompanying', 'observer')),
      UNIQUE (meeting_id, owner_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS opportunity_meeting_participants_meeting_idx ON opportunity_meeting_participants (meeting_id)`;
  await sql`CREATE INDEX IF NOT EXISTS opportunity_meeting_participants_owner_idx ON opportunity_meeting_participants (owner_id, created_at DESC)`;

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
      sender_email  TEXT,
      sender_title  TEXT,
      sender_signature TEXT,
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

  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar TEXT`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_color TEXT`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS sender_email TEXT`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS sender_title TEXT`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS sender_signature TEXT`;

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

  await sql`
    CREATE TABLE IF NOT EXISTS email_send_logs (
      id                   BIGSERIAL PRIMARY KEY,
      batch_key            TEXT,
      lead_id              BIGINT REFERENCES queue_leads(id) ON DELETE SET NULL,
      sender_user_id       BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
      sender_email         TEXT,
      sender_name          TEXT,
      recipient_email      TEXT,
      recipient_name       TEXT,
      lead_owner_id        TEXT,
      sector               TEXT,
      sub_sector           TEXT,
      template_key         TEXT,
      subject_template     TEXT,
      body_template        TEXT,
      rendered_subject     TEXT,
      rendered_body        TEXT,
      provider             TEXT NOT NULL DEFAULT 'mailgun',
      provider_message_id  TEXT,
      provider_response    JSONB,
      status               TEXT NOT NULL DEFAULT 'pending',
      error                TEXT,
      sent_at              TIMESTAMPTZ,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS email_send_logs_batch_idx ON email_send_logs (batch_key, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS email_send_logs_lead_idx ON email_send_logs (lead_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS email_send_logs_recipient_idx ON email_send_logs (recipient_email, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_suppressions (
      id              BIGSERIAL PRIMARY KEY,
      email           TEXT NOT NULL,
      reason          TEXT NOT NULL,
      provider        TEXT NOT NULL DEFAULT 'mailgun',
      provider_event  TEXT,
      provider_data   JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS email_suppressions_email_idx ON email_suppressions (lower(email))`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_campaigns (
      id                 BIGSERIAL PRIMARY KEY,
      name               TEXT NOT NULL,
      description        TEXT,
      campaign_type      TEXT NOT NULL DEFAULT 'growth',
      status              TEXT NOT NULL DEFAULT 'draft',
      created_by_user_id  BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      activated_at       TIMESTAMPTZ,
      paused_at          TIMESTAMPTZ,
      archived_at        TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS email_campaigns_status_idx ON email_campaigns (status, updated_at DESC)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS email_campaigns_active_name_idx ON email_campaigns (lower(name)) WHERE status <> 'archived'`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_campaign_steps (
      id                 BIGSERIAL PRIMARY KEY,
      campaign_id        BIGINT NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
      step_order         INTEGER NOT NULL,
      step_name          TEXT NOT NULL,
      subject_template   TEXT NOT NULL,
      body_template      TEXT NOT NULL,
      wait_days          INTEGER NOT NULL DEFAULT 0,
      send_hour          INTEGER NOT NULL DEFAULT 9,
      send_minute        INTEGER NOT NULL DEFAULT 0,
      send_timezone      TEXT NOT NULL DEFAULT 'Europe/London',
      active             BOOLEAN NOT NULL DEFAULT TRUE,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (campaign_id, step_order)
    )
  `;
  await sql`ALTER TABLE email_campaign_steps ADD COLUMN IF NOT EXISTS send_minute INTEGER NOT NULL DEFAULT 0`;
  await sql`CREATE INDEX IF NOT EXISTS email_campaign_steps_campaign_idx ON email_campaign_steps (campaign_id, step_order)`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_campaign_enrollments (
      id                 BIGSERIAL PRIMARY KEY,
      campaign_id        BIGINT NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
      lead_id            BIGINT NOT NULL REFERENCES queue_leads(id) ON DELETE CASCADE,
      status              TEXT NOT NULL DEFAULT 'active',
      current_step       INTEGER NOT NULL DEFAULT 0,
      next_step_due      TIMESTAMPTZ,
      enrolled_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_sent_at       TIMESTAMPTZ,
      last_event_at      TIMESTAMPTZ,
      last_event_type    TEXT,
      paused_at          TIMESTAMPTZ,
      paused_reason      TEXT,
      stopped_at         TIMESTAMPTZ,
      stopped_reason     TEXT,
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (campaign_id, lead_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS email_campaign_enrollments_due_idx ON email_campaign_enrollments (status, next_step_due)`;
  await sql`CREATE INDEX IF NOT EXISTS email_campaign_enrollments_lead_idx ON email_campaign_enrollments (lead_id, status)`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_campaign_sends (
      id                   BIGSERIAL PRIMARY KEY,
      enrollment_id        BIGINT NOT NULL REFERENCES email_campaign_enrollments(id) ON DELETE CASCADE,
      step_id              BIGINT NOT NULL REFERENCES email_campaign_steps(id) ON DELETE CASCADE,
      sender_user_id       BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
      email_send_log_id    BIGINT REFERENCES email_send_logs(id) ON DELETE SET NULL,
      provider_message_id  TEXT,
      status                TEXT NOT NULL DEFAULT 'pending',
      rendered_subject     TEXT,
      rendered_body        TEXT,
      sent_at              TIMESTAMPTZ,
      last_event_at        TIMESTAMPTZ,
      last_event_type      TEXT,
      error                TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (enrollment_id, step_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS email_campaign_sends_provider_idx ON email_campaign_sends (provider_message_id)`;
  await sql`CREATE INDEX IF NOT EXISTS email_campaign_sends_enrollment_idx ON email_campaign_sends (enrollment_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_campaign_events (
      id              BIGSERIAL PRIMARY KEY,
      enrollment_id   BIGINT REFERENCES email_campaign_enrollments(id) ON DELETE CASCADE,
      send_id         BIGINT REFERENCES email_campaign_sends(id) ON DELETE CASCADE,
      event_type      TEXT NOT NULL,
      occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      provider_data   JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS email_campaign_events_enrollment_idx ON email_campaign_events (enrollment_id, occurred_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_campaign_rule_sets (
      campaign_id                    BIGINT PRIMARY KEY REFERENCES email_campaigns(id) ON DELETE CASCADE,
      match_logic                    TEXT NOT NULL DEFAULT 'all',
      include_existing_on_activate   BOOLEAN NOT NULL DEFAULT FALSE,
      continuous_enroll              BOOLEAN NOT NULL DEFAULT FALSE,
      auto_stop_enabled              BOOLEAN NOT NULL DEFAULT FALSE,
      created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT email_campaign_rule_sets_match_logic_chk CHECK (match_logic IN ('all', 'any'))
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS email_campaign_trigger_rules (
      id            BIGSERIAL PRIMARY KEY,
      campaign_id   BIGINT NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
      rule_type     TEXT NOT NULL,
      field_name    TEXT NOT NULL,
      operator      TEXT NOT NULL,
      value_text    TEXT,
      value_json    JSONB,
      sort_order    INTEGER NOT NULL DEFAULT 1,
      active        BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT email_campaign_trigger_rules_rule_type_chk CHECK (rule_type IN ('trigger', 'stop')),
      CONSTRAINT email_campaign_trigger_rules_operator_chk CHECK (operator IN ('equals', 'in'))
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS email_campaign_trigger_rules_campaign_idx ON email_campaign_trigger_rules (campaign_id, rule_type, active)`;
  await sql`CREATE INDEX IF NOT EXISTS email_campaign_trigger_rules_sort_idx ON email_campaign_trigger_rules (campaign_id, sort_order)`;

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

/** Create the webhook idempotency ledger (idempotent). */
export async function ensureProcessedWebhooksTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS processed_webhooks (
      source        TEXT NOT NULL,
      delivery_id   TEXT NOT NULL,
      processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (source, delivery_id)
    )
  `;
}

/**
 * Record a webhook delivery; returns false when it was already processed.
 * Best-effort: on any error we return true so genuine events are never dropped.
 */
export async function markWebhookProcessed(sql, source, deliveryId) {
  if (!deliveryId) return true; // no stable id → cannot dedupe, process it
  try {
    await ensureProcessedWebhooksTable(sql);
    const rows = await sql`
      INSERT INTO processed_webhooks (source, delivery_id)
      VALUES (${String(source)}, ${String(deliveryId)})
      ON CONFLICT (source, delivery_id) DO NOTHING
      RETURNING delivery_id
    `;
    return rows.length > 0;
  } catch {
    return true;
  }
}

export async function upsertEmailSuppression(sql, { email, reason, provider = 'mailgun', providerEvent = null, providerData = null }) {
  if (!email || !reason) return false;
  try {
    await sql`
      INSERT INTO email_suppressions (email, reason, provider, provider_event, provider_data)
      VALUES (${String(email).trim().toLowerCase()}, ${String(reason)}, ${String(provider)}, ${providerEvent}, ${providerData ? JSON.stringify(providerData) : null})
      ON CONFLICT (lower(email)) DO UPDATE SET
        reason = EXCLUDED.reason,
        provider = EXCLUDED.provider,
        provider_event = EXCLUDED.provider_event,
        provider_data = EXCLUDED.provider_data,
        updated_at = now()
    `;
    return true;
  } catch {
    return false;
  }
}

export async function isEmailSuppressed(sql, email) {
  if (!email) return false;
  try {
    const rows = await sql`
      SELECT id FROM email_suppressions
      WHERE lower(email) = ${String(email).trim().toLowerCase()}
      LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}
