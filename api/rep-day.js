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
 *   POST { action: 'list-off-phone' | 'add-off-phone' | 'cancel-off-phone' }  internal meetings / off-phone time (admin writes)
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
  STATUS_KINDS, endStatus, ensureOffPhoneTable, ensureStatusTable, getActiveStatus, listOffPhone, loadMeetings, loadMonthMeetings, loadOffPhone,
  loadReps, loadStatusLog, loadTimeOff, startStatus, statusLabel, sumCounts,
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

function repDay({ config, now, dateKey, ownerId, calls, meetings, timeOff, weekdayKeys, offPhone = [], statusRows = [] }) {
  return buildRepDay({
    config, now, dateKey, weekdayKeys,
    calls: calls.filter((c) => c.owner_id === ownerId).map((c) => ({ at: c.at, outcome: c.outcome, durationSec: c.duration_sec == null ? null : Number(c.duration_sec) })),
    meetingsWeek: meetings.filter((m) => m.owner_id === ownerId).map((m) => ({ at: m.at })),
    offPhone: [
      ...offPhone.filter((o) => !o.owner_id || o.owner_id === ownerId).map((o) => ({ start: o.starts_at, end: o.ends_at, label: o.label, reduces: true })),
      ...statusRows.filter((r) => r.owner_id === ownerId).map((r) => ({ start: r.started_at, end: r.ended_at, label: statusLabel(r.kind, r.reason), reduces: config.statusReducesTargets[r.kind] !== false })),
    ],
    timeOff: timeOff.filter((t) => t.owner_id === ownerId).map((t) => ({ dayPart: t.day_part, hoursOff: t.hours_off == null ? null : Number(t.hours_off) })),
  });
}

const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));

function entryOut(r, now) {
  return {
    id: r.id, kind: r.kind, label: STATUS_KINDS[r.kind]?.label || r.kind, reason: r.reason || '', start: r.started_at, end: r.ended_at || null,
    ongoing: !r.ended_at, minutes: minutesBetween(r.started_at, r.ended_at || now), endedBy: r.ended_by || null, loggedBy: r.logged_by || null,
  };
}

function totalsOf(entries) {
  const t = { admin: 0, client_meeting: 0, internal_meeting: 0, lunch: 0, total: 0 };
  for (const e of entries) { t[e.kind] = (t[e.kind] || 0) + e.minutes; t.total += e.minutes; }
  return t;
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
      if (['status-get', 'status-start', 'status-end', 'status-remove'].includes(body.action)) {
        const now = new Date();
        // An admin using "View as" can act as the rep for testing; those entries are marked with who made them.
        const actingAdmin = identity.impersonating ? (identity.original?.email || 'admin') : null;
        if (body.action === 'status-remove') {
          if (!hasMinRole(identity, 'admin')) return res.status(403).json({ success: false, error: 'Admins only' });
          const id = Number.parseInt(body.id, 10);
          if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Entry id required' });
          await ensureStatusTable(sql);
          const rows = await sql`UPDATE rep_status_log SET canceled_at = now() WHERE id = ${id} AND canceled_at IS NULL RETURNING id`;
          if (!rows[0]) return res.status(404).json({ success: false, error: 'Entry not found' });
          await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: 'status_removed', target: String(id) });
          return res.status(200).json({ success: true });
        }
        // Managers can end a rep's running status (e.g. they forgot); everything else is about the signed-in rep.
        const targetOwner = body.action === 'status-end' && body.ownerId && hasMinRole(identity, 'manager') ? String(body.ownerId) : identity.ghlOwnerId;
        if (!targetOwner) return res.status(200).json({ success: true, noOwner: true, active: null, entries: [], totals: totalsOf([]) });
        await ensureStatusTable(sql);
        if (body.action === 'status-start') {
          const kind = String(body.kind || '');
          const spec = STATUS_KINDS[kind];
          if (!spec) return res.status(400).json({ success: false, error: 'Unknown status' });
          const reason = String(body.reason || '').trim().slice(0, 120);
          if (spec.needsReason && !reason) return res.status(400).json({ success: false, error: kind === 'client_meeting' ? 'Add which client the meeting is with' : 'Add what you are working on' });
          await startStatus(sql, { ownerId: targetOwner, ownerName: identity.name, kind, reason: kind === 'lunch' ? '' : reason, loggedBy: actingAdmin });
        } else if (body.action === 'status-end') {
          await endStatus(sql, targetOwner, targetOwner === identity.ghlOwnerId && !actingAdmin ? 'self' : 'manager');
        }
        const today = londonDateKey(now);
        const rows = (await loadStatusLog(sql, londonDayRange(today))).filter((r) => r.owner_id === targetOwner);
        const entries = rows.map((r) => entryOut(r, now));
        const active = await getActiveStatus(sql, targetOwner);
        return res.status(200).json({
          success: true, entries, totals: totalsOf(entries),
          active: active ? { id: active.id, kind: active.kind, label: STATUS_KINDS[active.kind]?.label || active.kind, reason: active.reason || '', startedAt: active.started_at } : null,
          kinds: Object.fromEntries(Object.entries(STATUS_KINDS).map(([k, v]) => [k, { label: v.label, needsReason: v.needsReason, prompt: v.prompt }])),
          now: now.toISOString(),
        });
      }
      if (body.action === 'list-off-phone') {
        if (!hasMinRole(identity, 'manager')) return res.status(403).json({ success: false, error: 'Managers only' });
        const today = londonDateKey(new Date());
        const rows = await listOffPhone(sql, londonMidnight(today, -14), londonMidnight(today, 90));
        return res.status(200).json({ success: true, entries: rows.map((r) => ({ id: r.id, ownerId: r.owner_id, label: r.label, start: r.starts_at, end: r.ends_at })) });
      }
      if (body.action === 'add-off-phone') {
        if (!hasMinRole(identity, 'admin')) return res.status(403).json({ success: false, error: 'Admins only' });
        const label = String(body.label || '').trim().slice(0, 80);
        const date = validDateKey(body.date);
        const [sh, sm] = String(body.start || '').split(':').map(Number);
        const [eh, em] = String(body.end || '').split(':').map(Number);
        if (!label) return res.status(400).json({ success: false, error: 'Add a reason, e.g. Team meeting' });
        if (!date) return res.status(400).json({ success: false, error: 'Choose a date' });
        if (![sh, sm, eh, em].every(Number.isFinite) || eh * 60 + em <= sh * 60 + sm) return res.status(400).json({ success: false, error: 'End time must be after the start time' });
        const ownerId = String(body.ownerId || '').trim() || null;
        if (ownerId) {
          const reps = await loadReps(sql);
          if (!reps.some((r) => r.ownerId === ownerId)) return res.status(400).json({ success: false, error: 'That rep is not tracked' });
        }
        const repeat = Math.max(0, Math.min(12, Number.parseInt(body.repeatWeeks, 10) || 0));
        await ensureOffPhoneTable(sql);
        const created = [];
        for (let i = 0; i <= repeat; i += 1) {
          const key = noonKey(date, 7 * i);
          const start = londonDateTime(key, sh, sm);
          const end = londonDateTime(key, eh, em);
          const rows = await sql`
            INSERT INTO rep_off_phone (owner_id, label, starts_at, ends_at, created_by_email)
            VALUES (${ownerId}, ${label}, ${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, ${identity.email})
            RETURNING id`;
          created.push(rows[0].id);
        }
        await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: 'off_phone_added', target: ownerId || 'team', meta: { label, date, start: body.start, end: body.end, repeatWeeks: repeat } });
        return res.status(200).json({ success: true, created: created.length });
      }
      if (body.action === 'cancel-off-phone') {
        if (!hasMinRole(identity, 'admin')) return res.status(403).json({ success: false, error: 'Admins only' });
        const id = Number.parseInt(body.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Entry id required' });
        await ensureOffPhoneTable(sql);
        const rows = await sql`UPDATE rep_off_phone SET canceled_at = now() WHERE id = ${id} AND canceled_at IS NULL RETURNING id`;
        if (!rows[0]) return res.status(404).json({ success: false, error: 'Entry not found' });
        await writeAudit(sql, { actorEmail: identity.email, actorRole: identity.role, event: 'off_phone_canceled', target: String(id) });
        return res.status(200).json({ success: true });
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

    const scope = ['team', 'funnel', 'status-log'].includes(req.query?.scope) ? req.query.scope : 'me';
    if ((scope === 'team' || scope === 'status-log') && !hasMinRole(identity, 'manager')) {
      return res.status(403).json({ success: false, error: 'Managers only' });
    }

    await initQueueTable();
    await ensureEventsTable(sql);
    const config = await loadConfig(sql);

    if (scope === 'status-log') {
      const now = new Date();
      const todayKey = londonDateKey(now);
      const requested = validDateKey(req.query?.date);
      const dateKey = requested && requested <= todayKey ? requested : todayKey;
      const range = londonDayRange(dateKey);
      const [reps, statusRows, adminRows] = await Promise.all([loadReps(sql), loadStatusLog(sql, range), loadOffPhone(sql, range)]);
      const reportNow = dateKey === todayKey ? now : new Date(range.endExclusive.getTime() - 1);
      const plannedLunch = Math.max(0, ...config.blocks.filter((b) => b.type === 'break').map((b) => {
        const [sh, sm] = b.start.split(':').map(Number); const [eh, em] = b.end.split(':').map(Number);
        return (eh * 60 + em) - (sh * 60 + sm);
      }));
      const out = reps.map((rep) => {
        const mine = statusRows.filter((r) => r.owner_id === rep.ownerId).map((r) => ({ ...entryOut(r, reportNow), source: 'self' }));
        const set = adminRows.filter((o) => !o.owner_id || o.owner_id === rep.ownerId).map((o) => ({
          id: o.id, kind: 'admin_logged', label: 'Logged by management', reason: o.label, start: o.starts_at, end: o.ends_at, ongoing: false,
          minutes: minutesBetween(o.starts_at, o.ends_at), endedBy: null, source: 'management',
        }));
        const entries = [...mine, ...set].sort((a, b) => new Date(a.start) - new Date(b.start));
        const totals = totalsOf(mine);
        return { ownerId: rep.ownerId, name: rep.name, entries, totals, managementMinutes: set.reduce((t, e) => t + e.minutes, 0), lunchOverMinutes: plannedLunch && totals.lunch > plannedLunch ? totals.lunch - plannedLunch : 0 };
      });
      return res.status(200).json({ success: true, date: dateKey, isToday: dateKey === todayKey, plannedLunchMinutes: plannedLunch, reps: out });
    }

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
      const [calls, meetings, timeOff, offPhone, statusRows] = await Promise.all([
        loadDayCalls(sql, range), loadMeetings(sql, weekStart, range.endExclusive), loadTimeOff(sql, dateKey), loadOffPhone(sql, range), loadStatusLog(sql, range),
      ]);
      const day = repDay({ config, now: reportNow, dateKey, ownerId, calls, meetings, timeOff, weekdayKeys, offPhone, statusRows });
      return res.status(200).json({ success: true, config, now: now.toISOString(), gatekeeperCallbackAt, day });
    }

    const [reps, calls, meetings, timeOff, history, autoArchived, offPhone, statusRows] = await Promise.all([
      loadReps(sql), loadDayCalls(sql, range), loadMeetings(sql, weekStart, range.endExclusive),
      loadTimeOff(sql, dateKey), loadHistory(sql, config, dateKey), loadAutoArchived(sql), loadOffPhone(sql, range), loadStatusLog(sql, range),
    ]);
    const team = reps.map((rep) => ({
      ownerId: rep.ownerId, name: rep.name,
      day: repDay({ config, now: reportNow, dateKey, ownerId: rep.ownerId, calls, meetings, timeOff, weekdayKeys, offPhone, statusRows }),
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
