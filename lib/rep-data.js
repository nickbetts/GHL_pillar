/** Shared SQL loaders for rep targets (used by api/rep-day.js and the Monday scorecard job). */

import { initTimeOffTable } from '../api/db.js';
import { londonClock, londonDateTime, londonDayRange, londonMidnight } from '../api/business-time.js';

export const AUTO_ARCHIVE_REASONS = ['bad_data', 'gatekeeper_dead_end'];
export const HISTORY_DAYS = 7;

export async function loadReps(sql) {
  const rows = await sql`
    SELECT name, email, ghl_owner_id FROM app_users
    WHERE role = 'rep' AND active = TRUE AND ghl_owner_id IS NOT NULL AND ghl_owner_id <> ''
    ORDER BY name
  `;
  return rows.map((r) => ({ ownerId: r.ghl_owner_id, name: r.name || r.email }));
}

export async function loadDayCalls(sql, range) {
  return sql`
    SELECT COALESCE(qe.owner_id, ql.owner_id) AS owner_id, qe.created_at AS at,
           qe.meta->>'outcome' AS outcome, NULLIF(qe.meta->>'durationSec', '')::numeric AS duration_sec
    FROM queue_events qe
    JOIN queue_leads ql ON ql.id = qe.lead_id
    WHERE qe.event_type = 'call'
      AND qe.created_at >= ${range.start.toISOString()}::timestamptz
      AND qe.created_at < ${range.endExclusive.toISOString()}::timestamptz
      AND COALESCE(qe.owner_id, ql.owner_id) IS NOT NULL
  `;
}

export async function loadMeetings(sql, weekStart, dayEnd) {
  return sql`
    SELECT qe.lead_id, MIN(qe.created_at) AS at,
           (ARRAY_AGG(COALESCE(qe.owner_id, ql.owner_id) ORDER BY qe.created_at))[1] AS owner_id
    FROM queue_events qe
    JOIN queue_leads ql ON ql.id = qe.lead_id
    WHERE qe.created_at >= ${weekStart.toISOString()}::timestamptz
      AND qe.created_at < ${dayEnd.toISOString()}::timestamptz
      AND (qe.event_type = 'meeting_booked'
           OR (qe.event_type = 'opportunity_stage' AND qe.meta->>'toStage' = 'meeting_booked'))
    GROUP BY qe.lead_id
  `;
}

export async function loadTimeOff(sql, dateKey) {
  await initTimeOffTable();
  return sql`
    SELECT owner_id, day_part, hours_off FROM rep_time_off
    WHERE canceled_at IS NULL AND start_date <= ${dateKey}::date AND end_date >= ${dateKey}::date
  `;
}

export async function loadHistory(sql, config, dateKey) {
  const from = londonMidnight(dateKey, -(HISTORY_DAYS + 6));
  const to = londonDayRange(dateKey).endExclusive;
  const rows = await sql`
    SELECT owner_id, d,
           COUNT(*)::int AS dials,
           COUNT(*) FILTER (WHERE answered)::int AS answered,
           COALESCE(SUM(LEAST(dur, ${config.maxTalkSecondsPerCall})) FILTER (WHERE answered), 0)::float AS talk_sec,
           COUNT(*) FILTER (WHERE answered AND LEAST(dur, ${config.maxTalkSecondsPerCall}) >= ${config.qualified.minSeconds})::int AS qualified
    FROM (
      SELECT COALESCE(qe.owner_id, ql.owner_id) AS owner_id,
             to_char(qe.created_at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS d,
             COALESCE(qe.meta->>'outcome', '') ILIKE 'Answered%' AS answered,
             COALESCE(NULLIF(qe.meta->>'durationSec', '')::numeric, 0) AS dur
      FROM queue_events qe
      JOIN queue_leads ql ON ql.id = qe.lead_id
      WHERE qe.event_type = 'call'
        AND qe.created_at >= ${from.toISOString()}::timestamptz
        AND qe.created_at < ${to.toISOString()}::timestamptz
    ) t
    WHERE owner_id IS NOT NULL
    GROUP BY owner_id, d
  `;
  const byOwner = new Map();
  for (const r of rows) {
    const weekday = londonClock(londonDateTime(r.d, 12, 0)).weekday;
    if (weekday === 0 || weekday === 6) continue;
    if (!byOwner.has(r.owner_id)) byOwner.set(r.owner_id, []);
    byOwner.get(r.owner_id).push({
      date: r.d, dials: r.dials, answered: r.answered, talkMinutes: Math.round(r.talk_sec / 60), qualified: r.qualified,
    });
  }
  for (const list of byOwner.values()) list.sort((a, b) => (a.date < b.date ? 1 : -1));
  return byOwner;
}

export async function loadFunnelCounts(sql, from, to) {
  const rows = await sql`
    SELECT COALESCE(qe.owner_id, ql.owner_id) AS owner_id,
      COUNT(*) FILTER (WHERE qe.event_type = 'call')::int AS dials,
      COUNT(*) FILTER (WHERE qe.event_type = 'call' AND qe.meta->>'outcome' ILIKE 'Answered%')::int AS answered,
      COUNT(DISTINCT qe.lead_id) FILTER (WHERE (qe.event_type = 'call' AND qe.meta->>'outcome' IN ('Answered - interested', 'Answered - wants info'))
        OR (qe.event_type = 'status_change' AND qe.to_status = 'qualified'))::int AS interested,
      COUNT(DISTINCT qe.lead_id) FILTER (WHERE qe.event_type = 'meeting_booked'
        OR (qe.event_type = 'opportunity_stage' AND qe.meta->>'toStage' = 'meeting_booked'))::int AS booked,
      COUNT(DISTINCT qe.lead_id) FILTER (WHERE qe.event_type = 'meeting_attended'
        OR (qe.event_type = 'opportunity_stage' AND qe.meta->>'toStage' = 'meeting_attended'))::int AS attended,
      COUNT(DISTINCT qe.lead_id) FILTER (WHERE qe.event_type = 'meeting_no_show'
        OR (qe.event_type = 'opportunity_stage' AND qe.meta->>'toStage' = 'meeting_no_show'))::int AS no_show,
      COUNT(DISTINCT qe.lead_id) FILTER (WHERE qe.event_type = 'opportunity_stage' AND qe.meta->>'toStage' = 'won')::int AS won
    FROM queue_events qe
    JOIN queue_leads ql ON ql.id = qe.lead_id
    WHERE qe.created_at >= ${from.toISOString()}::timestamptz AND qe.created_at < ${to.toISOString()}::timestamptz
      AND qe.event_type IN ('call', 'status_change', 'meeting_booked', 'meeting_attended', 'meeting_no_show', 'opportunity_stage')
    GROUP BY 1
  `;
  return new Map(rows.filter((r) => r.owner_id).map((r) => [r.owner_id, {
    dials: r.dials, answered: r.answered, interested: r.interested, booked: r.booked, attended: r.attended, noShow: r.no_show, won: r.won,
  }]));
}

export function sumCounts(list) {
  const total = { dials: 0, answered: 0, interested: 0, booked: 0, attended: 0, noShow: 0, won: 0 };
  for (const c of list) for (const k of Object.keys(total)) total[k] += c?.[k] || 0;
  return total;
}

export async function loadAutoArchived(sql) {
  const rows = await sql`
    SELECT id, name, company_name, phone, owner, archived_reason, archived_at
    FROM queue_leads
    WHERE archived_at IS NOT NULL AND archived_reason = ANY(${AUTO_ARCHIVE_REASONS})
      AND archived_at >= now() - interval '14 days'
    ORDER BY archived_at DESC
    LIMIT 40
  `;
  return rows.map((r) => ({
    id: r.id, name: r.name, company: r.company_name, phone: r.phone, owner: r.owner, reason: r.archived_reason, at: r.archived_at,
  }));
}


/** Dials per owner per London weekday over a window (for streaks and personal bests). */
export async function loadDailyDials(sql, fromDateKey, toDateKey) {
  const from = londonMidnight(fromDateKey);
  const to = londonDayRange(toDateKey).endExclusive;
  const rows = await sql`
    SELECT COALESCE(qe.owner_id, ql.owner_id) AS owner_id,
           to_char(qe.created_at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS d, COUNT(*)::int AS dials
    FROM queue_events qe
    JOIN queue_leads ql ON ql.id = qe.lead_id
    WHERE qe.event_type = 'call' AND qe.created_at >= ${from.toISOString()}::timestamptz AND qe.created_at < ${to.toISOString()}::timestamptz
    GROUP BY 1, 2
  `;
  const byOwner = new Map();
  for (const r of rows) {
    if (!r.owner_id) continue;
    const weekday = londonClock(londonDateTime(r.d, 12, 0)).weekday;
    if (weekday === 0 || weekday === 6) continue;
    if (!byOwner.has(r.owner_id)) byOwner.set(r.owner_id, []);
    byOwner.get(r.owner_id).push({ date: r.d, dials: r.dials });
  }
  return byOwner;
}

/** London date keys on which each owner first booked a meeting for a lead, from monthStartKey to the end of toDateKey. */
export async function loadMonthMeetings(sql, monthStartKey, toDateKey) {
  const from = londonMidnight(monthStartKey);
  const to = londonDayRange(toDateKey).endExclusive;
  const rows = await sql`
    SELECT (ARRAY_AGG(COALESCE(qe.owner_id, ql.owner_id) ORDER BY qe.created_at))[1] AS owner_id,
           to_char(MIN(qe.created_at) AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS d
    FROM queue_events qe
    JOIN queue_leads ql ON ql.id = qe.lead_id
    WHERE qe.created_at >= ${from.toISOString()}::timestamptz AND qe.created_at < ${to.toISOString()}::timestamptz
      AND (qe.event_type = 'meeting_booked' OR (qe.event_type = 'opportunity_stage' AND qe.meta->>'toStage' = 'meeting_booked'))
    GROUP BY qe.lead_id
  `;
  const byOwner = new Map();
  for (const r of rows) {
    if (!r.owner_id) continue;
    if (!byOwner.has(r.owner_id)) byOwner.set(r.owner_id, []);
    byOwner.get(r.owner_id).push(r.d);
  }
  return byOwner;
}

// ── Off-phone time (internal meetings, training) ─────────────────────────────

let offPhoneReady = null;
export function ensureOffPhoneTable(sql) {
  if (!offPhoneReady) {
    offPhoneReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS rep_off_phone (
          id                BIGSERIAL PRIMARY KEY,
          owner_id          TEXT,
          label             TEXT NOT NULL,
          starts_at         TIMESTAMPTZ NOT NULL,
          ends_at           TIMESTAMPTZ NOT NULL,
          created_by_email  TEXT,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
          canceled_at       TIMESTAMPTZ,
          CONSTRAINT rep_off_phone_range_chk CHECK (ends_at > starts_at)
        )`;
      await sql`CREATE INDEX IF NOT EXISTS rep_off_phone_range_idx ON rep_off_phone (starts_at, ends_at) WHERE canceled_at IS NULL`;
    })().catch((error) => { offPhoneReady = null; throw error; });
  }
  return offPhoneReady;
}

/** Active off-phone entries overlapping [range.start, range.endExclusive). owner_id NULL means the whole team. */
export async function loadOffPhone(sql, range) {
  await ensureOffPhoneTable(sql);
  return sql`
    SELECT id, owner_id, label, starts_at, ends_at FROM rep_off_phone
    WHERE canceled_at IS NULL
      AND starts_at < ${range.endExclusive.toISOString()}::timestamptz AND ends_at > ${range.start.toISOString()}::timestamptz
    ORDER BY starts_at
  `;
}

export async function listOffPhone(sql, from, to) {
  await ensureOffPhoneTable(sql);
  return sql`
    SELECT id, owner_id, label, starts_at, ends_at, created_by_email FROM rep_off_phone
    WHERE canceled_at IS NULL AND ends_at > ${from.toISOString()}::timestamptz AND starts_at < ${to.toISOString()}::timestamptz
    ORDER BY starts_at
    LIMIT 200
  `;
}

// ── Self-logged status (admin, client meeting, internal meeting, lunch) ─────

export const STATUS_KINDS = {
  admin: { label: 'Admin', needsReason: true, prompt: 'What are you working on?' },
  client_meeting: { label: 'Client meeting', needsReason: true, prompt: 'Which client?' },
  internal_meeting: { label: 'Internal meeting', needsReason: false, prompt: 'Which meeting? (optional)' },
  lunch: { label: 'Lunch', needsReason: false, prompt: '' },
};

export function statusLabel(kind, reason) {
  const base = STATUS_KINDS[kind]?.label || kind;
  return reason ? `${base}: ${reason}` : base;
}

let statusReady = null;
export function ensureStatusTable(sql) {
  if (!statusReady) {
    statusReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS rep_status_log (
          id           BIGSERIAL PRIMARY KEY,
          owner_id     TEXT NOT NULL,
          owner_name   TEXT,
          kind         TEXT NOT NULL,
          reason       TEXT,
          started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          ended_at     TIMESTAMPTZ,
          ended_by     TEXT,
          canceled_at  TIMESTAMPTZ
        )`;
      await sql`CREATE INDEX IF NOT EXISTS rep_status_log_owner_idx ON rep_status_log (owner_id, started_at)`;
      await sql`CREATE INDEX IF NOT EXISTS rep_status_log_open_idx ON rep_status_log (owner_id) WHERE ended_at IS NULL AND canceled_at IS NULL`;
    })().catch((error) => { statusReady = null; throw error; });
  }
  return statusReady;
}

/** A status left running overnight is closed at 18:00 on the day it started, so it never bleeds into the next day. */
export async function closeStaleStatuses(sql) {
  await ensureStatusTable(sql);
  await sql`
    UPDATE rep_status_log
    SET ended_at = GREATEST(started_at, (((started_at AT TIME ZONE 'Europe/London')::date + time '18:00') AT TIME ZONE 'Europe/London')), ended_by = 'auto'
    WHERE ended_at IS NULL AND canceled_at IS NULL
      AND (started_at AT TIME ZONE 'Europe/London')::date < (now() AT TIME ZONE 'Europe/London')::date
  `;
}

export async function getActiveStatus(sql, ownerId) {
  await closeStaleStatuses(sql);
  const rows = await sql`
    SELECT id, kind, reason, started_at FROM rep_status_log
    WHERE owner_id = ${ownerId} AND ended_at IS NULL AND canceled_at IS NULL ORDER BY started_at DESC LIMIT 1`;
  return rows[0] || null;
}

export async function endStatus(sql, ownerId, endedBy = 'self') {
  await ensureStatusTable(sql);
  const rows = await sql`
    UPDATE rep_status_log SET ended_at = now(), ended_by = ${endedBy}
    WHERE owner_id = ${ownerId} AND ended_at IS NULL AND canceled_at IS NULL RETURNING id`;
  return rows.length;
}

export async function startStatus(sql, { ownerId, ownerName, kind, reason }) {
  await closeStaleStatuses(sql);
  await endStatus(sql, ownerId, 'self');
  const rows = await sql`
    INSERT INTO rep_status_log (owner_id, owner_name, kind, reason)
    VALUES (${ownerId}, ${ownerName || null}, ${kind}, ${reason || null}) RETURNING id, kind, reason, started_at`;
  return rows[0];
}

/** Entries overlapping a London day (open ones included). */
export async function loadStatusLog(sql, range) {
  await closeStaleStatuses(sql);
  return sql`
    SELECT id, owner_id, owner_name, kind, reason, started_at, ended_at, ended_by FROM rep_status_log
    WHERE canceled_at IS NULL
      AND started_at < ${range.endExclusive.toISOString()}::timestamptz
      AND COALESCE(ended_at, now()) > ${range.start.toISOString()}::timestamptz
    ORDER BY started_at`;
}
