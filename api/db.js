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
      additional_emails TEXT[] DEFAULT '{}'::text[],
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
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::text[]`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS sort_seed INTEGER`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS additional_emails TEXT[] DEFAULT '{}'::text[]`;

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

  await ensurePointFrenzyTable(sql);
  await ensureProposalTables(sql);

  await sql`CREATE INDEX IF NOT EXISTS queue_leads_status_idx ON queue_leads (status)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_leads_priority_idx ON queue_leads (priority)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_leads_owner_idx ON queue_leads (owner_id)`;

  return { ok: true };
}

/**
 * Double Point Frenzy windows. One row per closed/won deal: points earned by
 * anyone while a window is open (started_at <= event < ends_at) count double
 * on the weekly leaderboard. Idempotent so read endpoints can self-heal.
 */
export async function ensurePointFrenzyTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS point_frenzies (
      id                   BIGSERIAL PRIMARY KEY,
      lead_id              BIGINT,
      lead_name            TEXT,
      triggered_by_owner_id TEXT,
      triggered_by_name    TEXT NOT NULL,
      started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      ends_at              TIMESTAMPTZ NOT NULL,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS point_frenzies_ends_idx ON point_frenzies (ends_at DESC)`;
  return { ok: true };
}

/**
 * Proposal Hub tables. Templates hold reusable content blocks; proposals are
 * per-client snapshots shared via a token link, gated by an approved email +
 * password, with a DocuSign-style event trail (viewed / accepted / signed).
 */
export async function ensureProposalTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS proposal_templates (
      id          BIGSERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      blocks      JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_default  BOOLEAN NOT NULL DEFAULT FALSE,
      created_by  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS proposals (
      id                   BIGSERIAL PRIMARY KEY,
      token                TEXT NOT NULL UNIQUE,
      lead_id              BIGINT,
      template_id          BIGINT,
      title                TEXT NOT NULL,
      client_name          TEXT,
      client_company       TEXT,
      client_email         TEXT NOT NULL,
      access_password_hash TEXT,
      access_password_salt TEXT,
      blocks               JSONB NOT NULL DEFAULT '[]'::jsonb,
      deal_type            TEXT,
      mrr_value            NUMERIC,
      one_off_value        NUMERIC,
      status               TEXT NOT NULL DEFAULT 'active',
      owner_id             TEXT,
      owner_name           TEXT,
      expires_at           TIMESTAMPTZ,
      first_viewed_at      TIMESTAMPTZ,
      last_viewed_at       TIMESTAMPTZ,
      view_count           INTEGER NOT NULL DEFAULT 0,
      accepted_at          TIMESTAMPTZ,
      accepted_by_name     TEXT,
      signed_at            TIMESTAMPTZ,
      signed_by_name       TEXT,
      signature_image      TEXT,
      signer_ip            TEXT,
      signer_user_agent    TEXT,
      created_by_email     TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS proposals_owner_idx ON proposals (owner_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS proposals_lead_idx ON proposals (lead_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS proposal_events (
      id          BIGSERIAL PRIMARY KEY,
      proposal_id BIGINT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
      event_type  TEXT NOT NULL,
      actor_name  TEXT,
      ip          TEXT,
      user_agent  TEXT,
      meta        JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS proposal_events_proposal_idx ON proposal_events (proposal_id, created_at DESC)`;

  // Seed the default template once so the editor has a professional starting point.
  const defaultBlocks = [
    { type: 'heading', text: 'Executive summary' },
    { type: 'text', text: 'In short.\n{{client_company}} needs a website that does the heavy lifting your sales team can’t always do — answering questions before they’re asked, qualifying leads before they reach you, and giving prospects confidence in your business before the first call.\n\nThis proposal sets out two ways to get there, depending on how far you want the website to support growth.' },
    {
      type: 'options',
      recommended: 'b',
      data: {
        a: { label: 'Option 1', name: 'Website Refresh', price: '{{one_off}}', desc: 'A modern, credible website that solves the pain of an outdated presence — without rebuilding your brand identity. Search-ready, mobile-friendly, and a clear step up from where you are today.' },
        b: { label: 'Option 2', name: 'Growth Platform', price: '{{one_off}}', desc: 'A fully bespoke website engineered to generate enquiries — not just receive them. Built around your commercial goals, with conversion infrastructure and lead capture at its core.' },
      },
    },
    { type: 'heading', text: 'Scope & timeline' },
    { type: 'bullets', text: 'Bespoke design, modern layouts, strong typography\nMobile responsive across all devices\nWordPress CMS — easy in-house updates, no platform lock-in\nOn-page SEO setup and Google Analytics 4\nContent migration and QA testing\n30 days post-launch support' },
    { type: 'timeline', text: 'Discovery | ~1 week\nDesign | ~3 weeks\nBuild | ~4 weeks\nLaunch | ~1 week + QA\nTotal | ~10 weeks' },
    { type: 'heading', text: 'Side by side' },
    { type: 'comparison', text: 'Feature | Website Refresh | Growth Platform\nBespoke design | Tailored | Fully bespoke\nInteractive elements & animations | — | ✓\nDynamic forms with conditional logic | — | ✓\nLeads stored in CMS, CRM-ready | — | ✓\nOn-page SEO | Basic | Full optimisation at launch\nPost-launch support | 30 days | 30 days' },
    { type: 'heading', text: 'Your investment' },
    { type: 'investment', text: 'One-off build | {{one_off}} | + VAT' },
    { type: 'investment', text: 'Hosting, security & warranty | {{mrr}}/month | Fully managed hosting, monthly security updates, backups, SSL and technical support' },
    { type: 'heading', text: 'Recent work' },
    { type: 'text', text: 'A selection of recent builds across professional services, education and the not-for-profit sector — Roadphone NRB, Inspire Education Group and Novus Environmental among them. Live links and full case studies available on request, or visit i3media.net.' },
    { type: 'heading', text: 'About i3MEDIA' },
    { type: 'text', text: '20+ years. 60+ in-house specialists. We bring strategy, design, development and marketing under one roof — direct access, no outsourcing, custom builds with no platform lock-in. You own everything we build.' },
    { type: 'heading', text: 'Ready to begin' },
    { type: 'text', text: 'If you’re happy with everything above, accept and sign this proposal below and we’ll schedule your kick-off call within days. This proposal is valid until {{expiry_date}}.' },
  ];
  await sql`
    INSERT INTO proposal_templates (name, blocks, is_default, created_by)
    SELECT 'Standard proposal', ${JSON.stringify(defaultBlocks)}::jsonb, TRUE, 'system'
    WHERE NOT EXISTS (SELECT 1 FROM proposal_templates)
  `;
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
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS zen_background TEXT NOT NULL DEFAULT '/webgl'`;
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
  await sql`ALTER TABLE email_campaign_rule_sets ADD COLUMN IF NOT EXISTS stop_on_reply BOOLEAN NOT NULL DEFAULT TRUE`;
  await sql`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS booking_url TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS email_campaign_steps_campaign_idx ON email_campaign_steps (campaign_id, step_order)`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_campaign_enrollments (
      id                 BIGSERIAL PRIMARY KEY,
      campaign_id        BIGINT NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
      lead_id            BIGINT NOT NULL REFERENCES queue_leads(id) ON DELETE CASCADE,
      status              TEXT NOT NULL DEFAULT 'active',
      enrolled_via       TEXT NOT NULL DEFAULT 'manual',
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
      CONSTRAINT email_campaign_enrollments_enrolled_via_chk CHECK (enrolled_via IN ('manual', 'rule', 'backfill')),
      UNIQUE (campaign_id, lead_id)
    )
  `;
  await sql`ALTER TABLE email_campaign_enrollments ADD COLUMN IF NOT EXISTS enrolled_via TEXT NOT NULL DEFAULT 'manual'`;
  await sql`CREATE INDEX IF NOT EXISTS email_campaign_enrollments_due_idx ON email_campaign_enrollments (status, next_step_due)`;
  await sql`CREATE INDEX IF NOT EXISTS email_campaign_enrollments_lead_idx ON email_campaign_enrollments (lead_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS email_campaign_enrollments_via_idx ON email_campaign_enrollments (campaign_id, enrolled_via)`;

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
