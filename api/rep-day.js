/**
 * Rep day API — targets, block schedule and live progress.
 *
 *   GET  /api/rep-day?scope=me[&date=YYYY-MM-DD]    own progress (reps and up)
 *   GET  /api/rep-day?scope=team[&date=YYYY-MM-DD]  every rep's progress (manager+)
 *   GET  /api/rep-day?scope=funnel[&days=7|30|90]   call-to-meeting funnel vs benchmarks (signed in)
 *   POST { action: 'get-config' }                   current targets config (signed in)
 *   POST { action: 'get-defaults' }                 plan defaults (signed in)
 *   POST { action: 'set-config', config }           save targets config (admin)
 *   POST { action: 'restore-lead', id }             undo an automatic bad-data archive (manager+)
 */

import { getSql, initAuthTables, initQueueTable, writeAudit } from './db.js';
import { resolveIdentity, hasMinRole } from './session.js';
import { ensureEventsTable } from './apollo-sales-queue.js';
import {
  londonClock, londonDateKey, londonDateTime, londonDayRange, londonMidnight, londonWeekToDate,
} from './business-time.js';
import {
  buildFunnel, buildRecords, buildRepDay, gatekeeperCallbackInstant, loadConfig, normalizeConfig, saveConfig, talkingPoints,
} from '../lib/rep-targets.js';
import {
  AUTO_ARCHIVE_REASONS, HISTORY_DAYS, loadAutoArchived, loadDailyDials, loadDayCalls, loadFunnelCounts, loadHistory,
  loadMeetings, loadMonthMeetings, loadReps, loadTimeOff, sumCounts,
} from '../lib/rep-data.js';

const noonKey = (dateKey, offsetDays) => londonDateKey(new Date(londonMidnight(dateKey, offsetDays).getTime() + 12 * 3600000));

/** Mon–Fri London date keys in the month of dateKey. */
function monthWorkDays(dateKey) {
  const monthPrefix = dateKey.slice(0, 7);
  const keys = [];
  for (let i = 0; i < 31; i += 1) {
    const key = noonKey(`${monthPrefix}-01`, i);
    if (key.slice(0, 7) !== monthPrefix) break;
    const dow = londonClock(londonDateTime(key, 12, 0)).weekday;
    if (dow !== 0 && dow !== 6) keys.push(key);
  }
  return keys;
}

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && londonMidnight(value) ? value : null;
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
      if (body.action === 'get-defaults') {
        return res.status(200).json({ success: true, config: normalizeConfig({}) });
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

    const scope = ['team', 'funnel'].includes(req.query?.scope) ? req.query.scope : 'me';
    if (scope === 'team' && !hasMinRole(identity, 'manager')) {
      return res.status(403).json({ success: false, error: 'Managers only' });
    }

    await initQueueTable();
    await ensureEventsTable(sql);
    const config = await loadConfig(sql);

    if (scope === 'funnel') {
      const days = [7, 30, 90].includes(Number(req.query?.days)) ? Number(req.query.days) : 30;
      const today = londonDateKey(new Date());
      const to = londonDayRange(today).endExclusive;
      const from = londonMidnight(today, -(days - 1));
      const prevFrom = londonMidnight(today, -(2 * days - 1));
      const from90 = londonMidnight(today, -89);
      const monthStart = `${today.slice(0, 7)}-01`;
      const isManager = hasMinRole(identity, 'manager');
      const [reps, counts, prevCounts, base90, history, daily, monthMeetings] = await Promise.all([
        loadReps(sql), loadFunnelCounts(sql, from, to), loadFunnelCounts(sql, prevFrom, from), loadFunnelCounts(sql, from90, to),
        loadHistory(sql, config, today), loadDailyDials(sql, noonKey(today, -120), today), loadMonthMeetings(sql, monthStart, today),
      ]);
      const view = (ownerId, name) => {
        const funnel = buildFunnel({ config, counts: counts.get(ownerId), prev: prevCounts.get(ownerId) });
        const records = buildRecords({ rows: daily.get(ownerId) || [], config, todayKey: today });
        return {
          name, ownerId, funnel, records,
          base: buildFunnel({ config, counts: base90.get(ownerId) }),
          history: (history.get(ownerId) || []).slice(0, HISTORY_DAYS),
          monthMeetings: monthMeetings.get(ownerId) || [],
          ...(isManager ? { talkingPoints: talkingPoints({ funnel, records, config }) } : {}),
        };
      };
      const owners = reps.map((r) => r.ownerId);
      const team = {
        name: 'Team', repCount: reps.length,
        funnel: buildFunnel({ config, counts: sumCounts(owners.map((o) => counts.get(o))), prev: sumCounts(owners.map((o) => prevCounts.get(o))) }),
        base: buildFunnel({ config, counts: sumCounts(owners.map((o) => base90.get(o))) }),
        monthMeetings: owners.flatMap((o) => monthMeetings.get(o) || []),
      };
      return res.status(200).json({
        success: true, config, days, today,
        month: { start: monthStart, workDays: monthWorkDays(today) },
        me: identity.ghlOwnerId ? view(identity.ghlOwnerId, identity.name) : null,
        team,
        reps: isManager ? reps.map((r) => view(r.ownerId, r.name)) : [],
      });
    }
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
      ownerId: rep.ownerId, name: rep.name,
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
