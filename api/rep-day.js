/**
 * Rep day API — targets, block schedule and live progress.
 *
 *   GET  /api/rep-day?scope=me[&date=YYYY-MM-DD]    own progress (reps and up)
 *   GET  /api/rep-day?scope=team[&date=YYYY-MM-DD]  every rep's progress (manager+)
 *   POST { action: 'get-config' }                   current targets config (signed in)
 *   POST { action: 'set-config', config }           save targets config (admin)
 *   POST { action: 'restore-lead', id }             undo an automatic bad-data archive (manager+)
 */

import { getSql, initAuthTables, initQueueTable, initTimeOffTable, writeAudit } from './db.js';
import { resolveIdentity, hasMinRole } from './session.js';
import { ensureEventsTable } from './apollo-sales-queue.js';
import {
  londonClock, londonDateKey, londonDateTime, londonDayRange, londonMidnight, londonWeekToDate, nextBusinessDayKey,
} from './business-time.js';
import {
  buildRepDay, gatekeeperCallbackInstant, loadConfig, normalizeConfig, saveConfig,
} from '../lib/rep-targets.js';

const AUTO_ARCHIVE_REASONS = ['bad_data', 'gatekeeper_dead_end'];
const HISTORY_DAYS = 7;

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && londonMidnight(value) ? value : null;
}

async function loadReps(sql) {
  const rows = await sql`
    SELECT name, email, ghl_owner_id FROM app_users
    WHERE role = 'rep' AND active = TRUE AND ghl_owner_id IS NOT NULL AND ghl_owner_id <> ''
    ORDER BY name
  `;
  return rows.map((r) => ({ ownerId: r.ghl_owner_id, name: r.name || r.email }));
}

async function loadDayCalls(sql, range) {
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

async function loadMeetings(sql, weekStart, dayEnd) {
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

async function loadTimeOff(sql, dateKey) {
  await initTimeOffTable();
  return sql`
    SELECT owner_id, day_part, hours_off FROM rep_time_off
    WHERE canceled_at IS NULL AND start_date <= ${dateKey}::date AND end_date >= ${dateKey}::date
  `;
}

async function loadHistory(sql, config, dateKey) {
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

async function loadAutoArchived(sql) {
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

function repDay({ config, now, dateKey, ownerId, calls, meetings, timeOff, weekdayKeys }) {
  return buildRepDay({
    config, now, dateKey, weekdayKeys,
    calls: calls.filter((c) => c.owner_id === ownerId).map((c) => ({ at: c.at, outcome: c.outcome, durationSec: c.duration_sec == null ? null : Number(c.duration_sec) })),
    meetingsWeek: meetings.filter((m) => m.owner_id === ownerId).map((m) => ({ at: m.at })),
    timeOff: timeOff.filter((t) => t.owner_id === ownerId).map((t) => ({ dayPart: t.day_part, hoursOff: t.hours_off == null ? null : Number(t.hours_off) })),
  });
}

export default async function handler(req, res) {
  const identity = resolveIdentity(req);
  if (!identity) return res.status(401).json({ success: false, error: 'Not signed in' });
  const sql = getSql();

  try {
    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.action === 'get-config') {
        return res.status(200).json({ success: true, config: await loadConfig(sql) });
      }
      if (body.action === 'set-config') {
        if (!hasMinRole(identity, 'admin')) return res.status(403).json({ success: false, error: 'Admins only' });
        await initAuthTables();
        const config = await saveConfig(sql, normalizeConfig(body.config));
        await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: 'rep_targets_updated', target: 'rep_targets', meta: { dialsFloor: config.dials.floor } });
        return res.status(200).json({ success: true, config });
      }
      if (body.action === 'restore-lead') {
        if (!hasMinRole(identity, 'manager')) return res.status(403).json({ success: false, error: 'Managers only' });
        const id = Number.parseInt(body.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Lead id required' });
        const rows = await sql`
          UPDATE queue_leads
          SET archived_at = NULL, archived_reason = NULL, status = 'to_contact', disposition = NULL, updated_at = now()
          WHERE id = ${id} AND archived_reason = ANY(${AUTO_ARCHIVE_REASONS})
          RETURNING id, owner_id, owner
        `;
        if (!rows[0]) return res.status(404).json({ success: false, error: 'Lead not found or not auto-archived' });
        await ensureEventsTable(sql);
        await sql`
          INSERT INTO queue_events (lead_id, event_type, owner_id, owner_name, meta)
          VALUES (${id}, 'lead_restored', ${rows[0].owner_id}, ${rows[0].owner}, ${JSON.stringify({ actorEmail: identity.email, from: 'auto-archive' })})
        `;
        await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: 'lead_restored', target: String(id), meta: { from: 'auto-archive' } });
        return res.status(200).json({ success: true, id });
      }
      return res.status(400).json({ success: false, error: 'Unknown action' });
    }

    if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

    const scope = req.query?.scope === 'team' ? 'team' : 'me';
    if (scope === 'team' && !hasMinRole(identity, 'manager')) {
      return res.status(403).json({ success: false, error: 'Managers only' });
    }

    await initQueueTable();
    await ensureEventsTable(sql);
    const config = await loadConfig(sql);
    const now = new Date();
    const todayKey = londonDateKey(now);
    const requested = validDateKey(req.query?.date);
    // Reps only ever see today; managers can look back.
    const dateKey = scope === 'team' && requested && requested <= todayKey ? requested : todayKey;
    const range = londonDayRange(dateKey);
    const weekdayKeys = londonWeekToDate(dateKey);
    const weekStart = londonMidnight(weekdayKeys[0]);
    const reportNow = dateKey === todayKey ? now : new Date(range.endExclusive.getTime() - 1);

    const gatekeeperCallbackAt = gatekeeperCallbackInstant(config, now)?.toISOString() || null;

    if (scope === 'me') {
      const ownerId = identity.ghlOwnerId;
      if (!ownerId) return res.status(200).json({ success: true, config, noOwner: true, gatekeeperCallbackAt });
      const [calls, meetings, timeOff] = await Promise.all([
        loadDayCalls(sql, range), loadMeetings(sql, weekStart, range.endExclusive), loadTimeOff(sql, dateKey),
      ]);
      const day = repDay({ config, now: reportNow, dateKey, ownerId, calls, meetings, timeOff, weekdayKeys });
      return res.status(200).json({ success: true, config, now: now.toISOString(), gatekeeperCallbackAt, day });
    }

    const [reps, calls, meetings, timeOff, history, autoArchived] = await Promise.all([
      loadReps(sql), loadDayCalls(sql, range), loadMeetings(sql, weekStart, range.endExclusive),
      loadTimeOff(sql, dateKey), loadHistory(sql, config, dateKey), loadAutoArchived(sql),
    ]);
    const team = reps.map((rep) => ({
      ...rep,
      day: repDay({ config, now: reportNow, dateKey, ownerId: rep.ownerId, calls, meetings, timeOff, weekdayKeys }),
      history: (history.get(rep.ownerId) || []).slice(0, HISTORY_DAYS),
    }));
    const sum = (pick) => team.reduce((total, rep) => total + pick(rep.day.totals), 0);
    const funnel = {
      dials: sum((t) => t.dials),
      answered: sum((t) => t.answered),
      qualifiedCalls: sum((t) => t.qualifiedCalls),
      interested: sum((t) => t.interested),
      meetings: sum((t) => t.meetingsToday),
    };
    return res.status(200).json({
      success: true, config, date: dateKey, isToday: dateKey === todayKey, now: now.toISOString(),
      reps: team, funnel, autoArchived,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
