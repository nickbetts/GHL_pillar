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
