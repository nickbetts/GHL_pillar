import { getSql, initAuthTables, initTimeOffTable } from './db.js';
import { resolveIdentity, hasMinRole } from './session.js';
import { BUSINESS_TIME_ZONE, londonDateKey, londonMidnight, londonDefaultRange } from './business-time.js';

const REPORT_WORKDAY_HOURS = 8;
const FALLBACK_DAILY_CALL_TARGET = 30;

async function ensureEventsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS queue_events (
      id              BIGSERIAL PRIMARY KEY,
      lead_id         BIGINT NOT NULL REFERENCES queue_leads(id) ON DELETE NO ACTION,
      event_type      TEXT NOT NULL,
      from_status     TEXT,
      to_status       TEXT,
      owner_id        TEXT,
      owner_name      TEXT,
      meta            JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Harden legacy schemas: replace cascade FK so lead deletion never erases event history.
  await sql`
    DO $$
    DECLARE
      fk_name text;
      is_cascade boolean;
      lead_attnum smallint;
    BEGIN
      SELECT attnum INTO lead_attnum
      FROM pg_attribute
      WHERE attrelid = 'queue_events'::regclass
        AND attname = 'lead_id'
        AND NOT attisdropped
      LIMIT 1;

      SELECT c.conname, (c.confdeltype = 'c')
      INTO fk_name, is_cascade
      FROM pg_constraint c
      WHERE c.conrelid = 'queue_events'::regclass
        AND c.contype = 'f'
        AND lead_attnum IS NOT NULL
        AND c.conkey = ARRAY[lead_attnum]
      LIMIT 1;

      IF fk_name IS NOT NULL AND is_cascade THEN
        EXECUTE format('ALTER TABLE queue_events DROP CONSTRAINT %I', fk_name);
        ALTER TABLE queue_events
          ADD CONSTRAINT queue_events_lead_id_fkey
          FOREIGN KEY (lead_id) REFERENCES queue_leads(id) ON DELETE NO ACTION;
      ELSIF fk_name IS NULL THEN
        ALTER TABLE queue_events
          ADD CONSTRAINT queue_events_lead_id_fkey
          FOREIGN KEY (lead_id) REFERENCES queue_leads(id) ON DELETE NO ACTION;
      END IF;
    END $$;
  `;
  await sql`CREATE INDEX IF NOT EXISTS queue_events_created_idx ON queue_events (created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_events_lead_idx ON queue_events (lead_id)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_events_type_idx ON queue_events (event_type)`;
}

async function ensureManualCallLogsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS manual_call_logs (
      id          BIGSERIAL PRIMARY KEY,
      owner_id    TEXT NOT NULL,
      owner_name  TEXT,
      lead_name   TEXT NOT NULL,
      lead_type   TEXT,
      notes       TEXT,
      source      TEXT NOT NULL DEFAULT 'outbound',
      meta        JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS manual_call_logs_created_idx ON manual_call_logs (created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS manual_call_logs_owner_idx ON manual_call_logs (owner_id)`;
  await sql`CREATE INDEX IF NOT EXISTS manual_call_logs_source_idx ON manual_call_logs (source)`;
}

async function ensureManualMeetingLogsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS manual_meeting_logs (
      id            BIGSERIAL PRIMARY KEY,
      owner_id      TEXT NOT NULL,
      owner_name    TEXT,
      lead_name     TEXT NOT NULL,
      lead_type     TEXT,
      notes         TEXT,
      source        TEXT NOT NULL DEFAULT 'outbound',
      meeting_date  TIMESTAMPTZ,
      meta          JSONB,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS manual_meeting_logs_created_idx ON manual_meeting_logs (created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS manual_meeting_logs_owner_idx ON manual_meeting_logs (owner_id)`;
  await sql`CREATE INDEX IF NOT EXISTS manual_meeting_logs_source_idx ON manual_meeting_logs (source)`;
}

async function ensureLeadColumns(sql) {
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS sector TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS sub_sector TEXT`;
}

async function ensureConfigTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS app_config (
      key         TEXT PRIMARY KEY,
      value       TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

async function getDailyCallTarget(sql) {
  await ensureConfigTable(sql);
  const rows = await sql`SELECT value FROM app_config WHERE key = 'daily_call_target' LIMIT 1`;
  const n = Number.parseInt(rows?.[0]?.value || '', 10);
  return Number.isFinite(n) && n > 0 ? n : FALLBACK_DAILY_CALL_TARGET;
}

function startOfDayIso(value) {
  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : londonDateKey(value);
  return key ? londonMidnight(key)?.toISOString() || null : null;
}

function endOfDayIso(value) {
  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : londonDateKey(value);
  const next = key ? londonMidnight(key, 1) : null;
  return next ? new Date(next.getTime() - 1).toISOString() : null;
}

function defaultRange(days = 30) {
  const range = londonDefaultRange(days);
  return { from: range.start.toISOString(), to: new Date(range.endExclusive.getTime() - 1).toISOString() };
}

function toDateKey(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function dateKeyToUtcMs(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return NaN;
  return new Date(`${key}T00:00:00Z`).getTime();
}

function isWeekdayDateKey(key) {
  const ms = dateKeyToUtcMs(key);
  if (!Number.isFinite(ms)) return false;
  const day = new Date(ms).getUTCDay();
  return day >= 1 && day <= 5;
}

function dateRangeKeysInclusive(startKey, endKey) {
  const startMs = dateKeyToUtcMs(startKey);
  const endMs = dateKeyToUtcMs(endKey);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];
  const out = [];
  for (let t = startMs; t <= endMs; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function workdaysInRange(startKey, endKey) {
  return dateRangeKeysInclusive(startKey, endKey).filter(isWeekdayDateKey).length;
}

function compareDateLike(a, b) {
  const aKey = toDateKey(a);
  const bKey = toDateKey(b);
  const aMs = aKey ? dateKeyToUtcMs(aKey) : NaN;
  const bMs = bKey ? dateKeyToUtcMs(bKey) : NaN;
  if (Number.isFinite(aMs) && Number.isFinite(bMs)) return aMs - bMs;
  return String(a || '').localeCompare(String(b || ''));
}

function dayPartHours(dayPart, hoursOff) {
  const part = String(dayPart || '').toLowerCase();
  if (part === 'full') return REPORT_WORKDAY_HOURS;
  if (part === 'am' || part === 'pm') return REPORT_WORKDAY_HOURS / 2;
  if (part === 'hours') {
    const n = Number(hoursOff || 0);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(REPORT_WORKDAY_HOURS, n));
  }
  return 0;
}

function computeLeaveHoursByOwner(leaveRows, fromDateKey, rangeEndDateKey) {
  const ownerDayHours = new Map();

  for (const row of leaveRows || []) {
    const ownerId = String(row.owner_id || '').trim();
    if (!ownerId) continue;
    const startKey = toDateKey(row.start_date);
    const endKey = toDateKey(row.end_date);
    if (!startKey || !endKey) continue;

    const overlapStartMs = Math.max(dateKeyToUtcMs(startKey), dateKeyToUtcMs(fromDateKey));
    const overlapEndMs = Math.min(dateKeyToUtcMs(endKey), dateKeyToUtcMs(rangeEndDateKey));
    if (!Number.isFinite(overlapStartMs) || !Number.isFinite(overlapEndMs) || overlapEndMs < overlapStartMs) continue;

    const overlapStart = new Date(overlapStartMs).toISOString().slice(0, 10);
    const overlapEnd = new Date(overlapEndMs).toISOString().slice(0, 10);
    const perDay = dayPartHours(row.day_part, row.hours_off);
    if (perDay <= 0) continue;

    if (!ownerDayHours.has(ownerId)) ownerDayHours.set(ownerId, new Map());
    const dayMap = ownerDayHours.get(ownerId);

    for (const dayKey of dateRangeKeysInclusive(overlapStart, overlapEnd)) {
      if (!isWeekdayDateKey(dayKey)) continue;
      const cur = Number(dayMap.get(dayKey) || 0);
      dayMap.set(dayKey, Math.min(REPORT_WORKDAY_HOURS, cur + perDay));
    }
  }

  const totals = new Map();
  for (const [ownerId, dayMap] of ownerDayHours.entries()) {
    let sum = 0;
    for (const hours of dayMap.values()) sum += Number(hours || 0);
    totals.set(ownerId, sum);
  }
  return totals;
}

const OPPORTUNITY_STAGE_ORDER = {
  qualified: 1,
  meeting_booked: 1.3,
  meeting_no_show: 1.45,
  meeting_attended: 1.6,
  scoping: 2,
  proposal: 3,
  won: 4,
  lost: 5,
};

function opportunityStageRank(stage) {
  const key = String(stage || '').toLowerCase();
  return Number.isFinite(OPPORTUNITY_STAGE_ORDER[key]) ? OPPORTUNITY_STAGE_ORDER[key] : 99;
}

function opportunityStageTimestamp(row) {
  const stage = String(row.opportunity_stage || '').toLowerCase();
  if (stage === 'qualified') return row.qualified_at;
  if (stage === 'meeting_booked') return row.meeting_booked_at || row.qualified_at;
  if (stage === 'meeting_no_show') return row.meeting_no_show_at || row.meeting_booked_at || row.qualified_at;
  if (stage === 'meeting_attended') return row.meeting_attended_at || row.qualified_at;
  if (stage === 'scoping') return row.scoping_at;
  if (stage === 'proposal') return row.proposal_at;
  if (stage === 'won') return row.won_at;
  if (stage === 'lost') return row.lost_at;
  return row.qualified_at;
}

function opportunityAgeDays(iso) {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return null;
  return (Date.now() - ts) / 86400000;
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

const REVENUE_BAND_ORDER = {
  '£0-500k': 1,
  '£500k-5m': 2,
  '£5m-50m': 3,
  '£50m+': 4,
  Unknown: 99,
};

const EMPLOYEE_BAND_ORDER = {
  '1-50': 1,
  '51-200': 2,
  '201-1000': 3,
  '1001+': 4,
  Unknown: 99,
};

function withRates(row) {
  const qualifiedBase = row.qualified || 0;
  return {
    ...row,
    workedRate: pct(row.worked || 0, row.total || 0),
    qualificationRate: pct(row.qualified || 0, row.total || 0),
    conversionRate: pct(row.converted || 0, row.total || 0),
    closeRate: pct(row.converted || 0, qualifiedBase),
  };
}

function mergeCounts(target, source) {
  target.total += source.total || 0;
  target.worked += source.worked || 0;
  target.qualified += source.qualified || 0;
  target.converted += source.converted || 0;
  target.toCallBack += source.toCallBack || 0;
  target.wantsMoreInfo += source.wantsMoreInfo || 0;
  target.noAnswer += source.noAnswer || 0;
  target.notInterested += source.notInterested || 0;
}

function normalizePhone9(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits ? digits.slice(-9) : '';
}

function websiteHost(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return String(new URL(raw).hostname || '').toLowerCase().replace(/^www\./, '').trim();
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
  }
}

function normalizedCompanyName(value) {
  return String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function companyKey(lead) {
  const companyPhone = normalizePhone9(lead.phone || '');
  if (companyPhone) return `phone:${companyPhone}`;
  const domain = websiteHost(lead.company_website || '');
  if (domain) return `domain:${domain}`;
  const name = normalizedCompanyName(lead.company_name || '');
  if (name) return `name:${name}`;
  return `lead:${lead.id}`;
}

function isCoveredDisposition(value) {
  const d = String(value || '').toLowerCase();
  return d.includes('covered by colleague') || d.includes('already worked this company');
}

function callPriorityRank(priority) {
  const order = { hot: 0, warm: 1, cold: 2 };
  return Number.isFinite(order[priority]) ? order[priority] : 9;
}

function callSort(a, b) {
  const byPriority = callPriorityRank(a.priority) - callPriorityRank(b.priority);
  if (byPriority) return byPriority;
  const aTs = new Date(a.created_at || 0).getTime();
  const bTs = new Date(b.created_at || 0).getTime();
  return aTs - bTs;
}

function companyTargetMap(leads) {
  const groups = new Map();
  for (const lead of leads) {
    const key = companyKey(lead);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lead);
  }

  const targets = new Map();
  for (const [key, members] of groups.entries()) {
    const explicit = members.find((m) => !!m.company_target);
    if (explicit) {
      targets.set(key, String(explicit.id));
      continue;
    }
    const ranked = members.filter((m) => !isCoveredDisposition(m.disposition)).sort(callSort);
    const target = ranked[0] || members[0];
    targets.set(key, String(target?.id || ''));
  }
  return targets;
}

function isCompanyActiveTarget(lead, targets) {
  return String(targets.get(companyKey(lead)) || '') === String(lead.id);
}

function mergeCallListKey(lead) {
  const numberKey = normalizePhone9(lead.phone || lead.direct_phone || '');
  if (!numberKey) return `lead:${lead.id}`;
  return `${companyKey(lead)}|${numberKey}`;
}

function uniqueByMergeKey(leads) {
  const seen = new Set();
  const out = [];
  for (const lead of leads) {
    const key = mergeCallListKey(lead);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(lead);
  }
  return out;
}

export default async function handler(req, res) {
  const identity = resolveIdentity(req);
  if (!identity) {
    return res.status(401).json({ success: false, error: 'Not signed in' });
  }
  if (!hasMinRole(identity, 'admin')) {
    return res.status(403).json({ success: false, error: 'Reports are available to admins only' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let sql;
  try {
    sql = getSql();
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  try {
    await ensureEventsTable(sql);
    await ensureManualCallLogsTable(sql);
    await ensureManualMeetingLogsTable(sql);
    await ensureLeadColumns(sql);
    await initAuthTables();
    await initTimeOffTable();

    const fallback = defaultRange(30);
    const from = startOfDayIso(req.query?.from) || fallback.from;
    const to = endOfDayIso(req.query?.to) || fallback.to;
    const fromDateKey = toDateKey(from);
    const toDateKeyValue = toDateKey(to);
    const rangeWorkdays = workdaysInRange(fromDateKey, toDateKeyValue);
    const rangeWorkHoursPerRep = rangeWorkdays * REPORT_WORKDAY_HOURS;
    const dailyCallTarget = await getDailyCallTarget(sql);
    const todayKey = londonDateKey();
    const todayStart = londonMidnight(todayKey);
    const todayEnd = new Date(londonMidnight(todayKey, 1).getTime() - 1);
    const plus3End = new Date(londonMidnight(todayKey, 4).getTime() - 1);
    const plus7End = new Date(londonMidnight(todayKey, 8).getTime() - 1);
    const ownerId = req.query?.ownerId || null;
    const srcMode = (req.query?.source === 'inbound') ? 'inbound' : 'outbound';

    const opportunityRows = await sql`
      SELECT
        owner,
        owner_id,
        opportunity_origin,
        opportunity_stage,
        mrr_value,
        one_off_value,
        loss_reason,
        callback_at,
        qualified_at,
        meeting_booked_at,
        meeting_no_show_at,
        meeting_attended_at,
        scoping_at,
        proposal_at,
        won_at,
        lost_at
      FROM queue_leads
      WHERE archived_at IS NULL
        AND status = 'qualified'
        AND opportunity_stage IS NOT NULL
        AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
        AND ((${srcMode}::text='outbound' AND source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND source='inbound'))
    `;

    const reportingLeadRows = await sql`
      SELECT
        ql.id,
        ql.phone,
        ql.direct_phone,
        ql.company_website,
        ql.company_name,
        ql.company_target,
        ql.disposition,
        ql.priority,
        ql.callback_at,
        ql.owner,
        ql.owner_id,
        ql.sector,
        ql.sub_sector,
        ql.created_at
      FROM queue_leads ql
      WHERE (${ownerId}::text IS NULL OR ql.owner_id = ${ownerId})
      AND ql.archived_at IS NULL
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
    `;

    const targetMap = companyTargetMap(reportingLeadRows);
    const callbackLeads = reportingLeadRows.filter((l) => l.callback_at && isCompanyActiveTarget(l, targetMap));
    const dedupedCallbacks = uniqueByMergeKey(callbackLeads);
    const upcomingDedupedCallbacks = dedupedCallbacks.filter((l) => {
      const ts = new Date(l.callback_at).getTime();
      return Number.isFinite(ts) && ts > todayEnd.getTime();
    });

    const ownerCallbackMap = new Map();
    for (const lead of upcomingDedupedCallbacks) {
      const owner = lead.owner || 'Unknown';
      const id = lead.owner_id || '';
      const key = `${owner}||${id}`;
      ownerCallbackMap.set(key, {
        owner,
        owner_id: id,
        callbacks_scheduled: (ownerCallbackMap.get(key)?.callbacks_scheduled || 0) + 1,
      });
    }
    const ownerCallbackRows = Array.from(ownerCallbackMap.values());

    const subSectorCallbackMap = new Map();
    for (const lead of upcomingDedupedCallbacks) {
      const sector = String(lead.sector || '').trim() || 'Unknown';
      const sub = String(lead.sub_sector || '').trim() || 'Unknown';
      const key = `${sector}||${sub}`;
      subSectorCallbackMap.set(key, {
        sector,
        sub_sector: sub,
        callbacks_scheduled: (subSectorCallbackMap.get(key)?.callbacks_scheduled || 0) + 1,
      });
    }
    const subSectorCallbackRows = Array.from(subSectorCallbackMap.values());

    const callbackQueueMap = new Map();
    for (const lead of dedupedCallbacks) {
      const owner = lead.owner || 'Unknown';
      const owner_id = lead.owner_id || '';
      const sector = String(lead.sector || '').trim() || 'Unknown';
      const sub_sector = String(lead.sub_sector || '').trim() || 'Unknown';
      const key = `${owner}||${owner_id}||${sector}||${sub_sector}`;
      if (!callbackQueueMap.has(key)) {
        callbackQueueMap.set(key, {
          owner,
          owner_id,
          sector,
          sub_sector,
          total_callbacks: 0,
          overdue: 0,
          due_today: 0,
          due_1_3_days: 0,
          due_4_7_days: 0,
          due_later: 0,
          next_due_at: null,
        });
      }

      const row = callbackQueueMap.get(key);
      const at = new Date(lead.callback_at);
      if (Number.isNaN(at.getTime())) continue;

      row.total_callbacks += 1;
      if (!row.next_due_at || at < new Date(row.next_due_at)) row.next_due_at = at.toISOString();

      const t = at.getTime();
      if (t < todayStart.getTime()) row.overdue += 1;
      else if (t <= todayEnd.getTime()) row.due_today += 1;
      else if (t <= plus3End.getTime()) row.due_1_3_days += 1;
      else if (t <= plus7End.getTime()) row.due_4_7_days += 1;
      else row.due_later += 1;
    }

    const callbackQueueRows = Array.from(callbackQueueMap.values()).sort((a, b) =>
      (b.overdue - a.overdue)
      || (b.due_today - a.due_today)
      || (b.total_callbacks - a.total_callbacks)
      || a.owner.localeCompare(b.owner)
      || a.sector.localeCompare(b.sector)
      || a.sub_sector.localeCompare(b.sub_sector)
    );

    const dayRows = await sql`
      SELECT
        DATE(qe.created_at AT TIME ZONE 'Europe/London') AS d,
        COUNT(*) FILTER (WHERE qe.event_type = 'call')::int AS calls,
        COUNT(*) FILTER (WHERE qe.event_type = 'call' AND (COALESCE(qe.meta->>'outcome', '') ILIKE 'Answered%' OR COALESCE(NULLIF(qe.meta->>'durationSec','')::int, 0) > 0 OR COALESCE(qe.meta->>'outcome', '') = 'Gatekeeper' OR COALESCE(qe.meta->>'actionKey', '') IN ('gatekeeper_callback', 'gatekeeper_send_email', 'gatekeeper_dead_end')))::int AS answered,
        COUNT(*) FILTER (WHERE qe.event_type = 'call' AND (COALESCE(qe.meta->>'outcome', '') = 'Answered - interested' OR COALESCE(qe.meta->>'actionKey', '') = 'answered_interested'))::int AS answered_interested,
        COUNT(*) FILTER (WHERE qe.event_type = 'status_change' AND qe.to_status = 'qualified')::int AS qualification_events,
        COUNT(DISTINCT qe.lead_id) FILTER (WHERE qe.event_type = 'status_change' AND qe.to_status = 'qualified')::int AS qualified,
        COUNT(*) FILTER (
          WHERE qe.event_type = 'meeting_booked'
             OR (qe.event_type = 'opportunity_stage' AND COALESCE(qe.meta->>'toStage', '') = 'meeting_booked')
        )::int AS meetings_booked,
        COUNT(*) FILTER (
          WHERE qe.event_type = 'meeting_attended'
             OR (qe.event_type = 'meeting_outcome' AND COALESCE(qe.meta->>'outcome', '') = 'attended')
             OR (qe.event_type = 'opportunity_stage' AND COALESCE(qe.meta->>'toStage', '') = 'meeting_attended')
        )::int AS meetings_attended
      FROM queue_events qe
      JOIN queue_leads ql ON ql.id = qe.lead_id
      WHERE qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR COALESCE(qe.owner_id, ql.owner_id) = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
      GROUP BY DATE(qe.created_at AT TIME ZONE 'Europe/London')
      ORDER BY DATE(qe.created_at AT TIME ZONE 'Europe/London')
    `;

    const hourRows = await sql`
      SELECT
        DATE_TRUNC('hour', qe.created_at AT TIME ZONE 'Europe/London') AS h,
        TO_CHAR(DATE_TRUNC('hour', qe.created_at AT TIME ZONE 'Europe/London'), 'YYYY-MM-DD HH24:MI') AS hour_label,
        COUNT(*) FILTER (WHERE qe.event_type = 'call')::int AS calls,
        COUNT(*) FILTER (WHERE qe.event_type = 'call' AND (COALESCE(qe.meta->>'outcome', '') ILIKE 'Answered%' OR COALESCE(NULLIF(qe.meta->>'durationSec','')::int, 0) > 0 OR COALESCE(qe.meta->>'outcome', '') = 'Gatekeeper' OR COALESCE(qe.meta->>'actionKey', '') IN ('gatekeeper_callback', 'gatekeeper_send_email', 'gatekeeper_dead_end')))::int AS answered,
        COUNT(*) FILTER (WHERE qe.event_type = 'call' AND (COALESCE(qe.meta->>'outcome', '') = 'Answered - interested' OR COALESCE(qe.meta->>'actionKey', '') = 'answered_interested'))::int AS answered_interested,
        COUNT(*) FILTER (WHERE qe.event_type = 'status_change' AND qe.to_status = 'qualified')::int AS qualification_events,
        COUNT(DISTINCT qe.lead_id) FILTER (WHERE qe.event_type = 'status_change' AND qe.to_status = 'qualified')::int AS qualified,
        COUNT(*) FILTER (
          WHERE qe.event_type = 'meeting_booked'
             OR (qe.event_type = 'opportunity_stage' AND COALESCE(qe.meta->>'toStage', '') = 'meeting_booked')
        )::int AS meetings_booked,
        COUNT(*) FILTER (
          WHERE qe.event_type = 'meeting_attended'
             OR (qe.event_type = 'meeting_outcome' AND COALESCE(qe.meta->>'outcome', '') = 'attended')
             OR (qe.event_type = 'opportunity_stage' AND COALESCE(qe.meta->>'toStage', '') = 'meeting_attended')
        )::int AS meetings_attended
      FROM queue_events qe
      JOIN queue_leads ql ON ql.id = qe.lead_id
      WHERE qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR COALESCE(qe.owner_id, ql.owner_id) = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
      GROUP BY DATE_TRUNC('hour', qe.created_at AT TIME ZONE 'Europe/London'), TO_CHAR(DATE_TRUNC('hour', qe.created_at AT TIME ZONE 'Europe/London'), 'YYYY-MM-DD HH24:MI')
      ORDER BY DATE_TRUNC('hour', qe.created_at AT TIME ZONE 'Europe/London')
    `;

    const ownerDayRows = await sql`
      SELECT
        DATE(qe.created_at AT TIME ZONE 'Europe/London') AS d,
        COALESCE(qe.owner_name, ql.owner, 'Unknown') AS owner,
        COALESCE(qe.owner_id, ql.owner_id, '') AS owner_id,
        COUNT(*)::int AS calls
      FROM queue_events qe
      JOIN queue_leads ql ON ql.id = qe.lead_id
      WHERE qe.event_type = 'call'
      AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
      GROUP BY DATE(qe.created_at AT TIME ZONE 'Europe/London'), COALESCE(qe.owner_name, ql.owner, 'Unknown'), COALESCE(qe.owner_id, ql.owner_id, '')
      ORDER BY DATE(qe.created_at AT TIME ZONE 'Europe/London'), COALESCE(qe.owner_name, ql.owner, 'Unknown')
    `;

    const ownerHourRows = await sql`
      SELECT
        TO_CHAR(DATE_TRUNC('hour', qe.created_at AT TIME ZONE 'Europe/London'), 'YYYY-MM-DD HH24:MI') AS hour_label,
        COALESCE(qe.owner_name, ql.owner, 'Unknown') AS owner,
        COALESCE(qe.owner_id, ql.owner_id, '') AS owner_id,
        COUNT(*)::int AS calls
      FROM queue_events qe
      JOIN queue_leads ql ON ql.id = qe.lead_id
      WHERE qe.event_type = 'call'
      AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
      GROUP BY TO_CHAR(DATE_TRUNC('hour', qe.created_at AT TIME ZONE 'Europe/London'), 'YYYY-MM-DD HH24:MI'), COALESCE(qe.owner_name, ql.owner, 'Unknown'), COALESCE(qe.owner_id, ql.owner_id, '')
      ORDER BY TO_CHAR(DATE_TRUNC('hour', qe.created_at AT TIME ZONE 'Europe/London'), 'YYYY-MM-DD HH24:MI'), COALESCE(qe.owner_name, ql.owner, 'Unknown')
    `;

    const manualDayRows = await sql`
      SELECT
        DATE(created_at AT TIME ZONE 'Europe/London') AS d,
        COUNT(*)::int AS calls
      FROM manual_call_logs
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
        AND source = ${srcMode}
      GROUP BY DATE(created_at AT TIME ZONE 'Europe/London')
      ORDER BY DATE(created_at AT TIME ZONE 'Europe/London')
    `;

    const manualHourRows = await sql`
      SELECT
        TO_CHAR(DATE_TRUNC('hour', created_at AT TIME ZONE 'Europe/London'), 'YYYY-MM-DD HH24:MI') AS hour_label,
        COUNT(*)::int AS calls
      FROM manual_call_logs
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
        AND source = ${srcMode}
      GROUP BY TO_CHAR(DATE_TRUNC('hour', created_at AT TIME ZONE 'Europe/London'), 'YYYY-MM-DD HH24:MI')
      ORDER BY TO_CHAR(DATE_TRUNC('hour', created_at AT TIME ZONE 'Europe/London'), 'YYYY-MM-DD HH24:MI')
    `;

    const manualOwnerDayRows = await sql`
      SELECT
        DATE(created_at AT TIME ZONE 'Europe/London') AS d,
        COALESCE(owner_name, 'Unknown') AS owner,
        COALESCE(owner_id, '') AS owner_id,
        COUNT(*)::int AS calls
      FROM manual_call_logs
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
        AND source = ${srcMode}
      GROUP BY DATE(created_at AT TIME ZONE 'Europe/London'), COALESCE(owner_name, 'Unknown'), COALESCE(owner_id, '')
      ORDER BY DATE(created_at AT TIME ZONE 'Europe/London'), COALESCE(owner_name, 'Unknown')
    `;

    const manualOwnerHourRows = await sql`
      SELECT
        TO_CHAR(DATE_TRUNC('hour', created_at AT TIME ZONE 'Europe/London'), 'YYYY-MM-DD HH24:MI') AS hour_label,
        COALESCE(owner_name, 'Unknown') AS owner,
        COALESCE(owner_id, '') AS owner_id,
        COUNT(*)::int AS calls
      FROM manual_call_logs
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
        AND source = ${srcMode}
      GROUP BY TO_CHAR(DATE_TRUNC('hour', created_at AT TIME ZONE 'Europe/London'), 'YYYY-MM-DD HH24:MI'), COALESCE(owner_name, 'Unknown'), COALESCE(owner_id, '')
      ORDER BY TO_CHAR(DATE_TRUNC('hour', created_at AT TIME ZONE 'Europe/London'), 'YYYY-MM-DD HH24:MI'), COALESCE(owner_name, 'Unknown')
    `;

    const manualCallTotalRows = await sql`
      SELECT COUNT(*)::int AS calls
      FROM manual_call_logs
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
        AND source = ${srcMode}
    `;

    const manualOwnerCallRows = await sql`
      SELECT
        COALESCE(owner_name, 'Unknown') AS owner,
        COALESCE(owner_id, '') AS owner_id,
        COUNT(*)::int AS c
      FROM manual_call_logs
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
        AND source = ${srcMode}
      GROUP BY 1,2
    `;

    const manualMeetingTotalRows = await sql`
      SELECT COUNT(*)::int AS meetings
      FROM manual_meeting_logs
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
        AND source = ${srcMode}
    `;

    const manualOwnerMeetingRows = await sql`
      SELECT
        COALESCE(owner_name, 'Unknown') AS owner,
        COALESCE(owner_id, '') AS owner_id,
        COUNT(*)::int AS meetings
      FROM manual_meeting_logs
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
        AND source = ${srcMode}
      GROUP BY 1,2
    `;

    const repRows = await sql`
      SELECT
        name,
        email,
        ghl_owner_id
      FROM app_users
      WHERE active = TRUE
        AND ghl_owner_id IS NOT NULL
        AND (${ownerId}::text IS NULL OR ghl_owner_id = ${ownerId})
      ORDER BY lower(COALESCE(name, email, ghl_owner_id))
    `;

    const leaveRows = await sql`
      SELECT
        owner_id,
        start_date,
        end_date,
        day_part,
        hours_off
      FROM rep_time_off
      WHERE canceled_at IS NULL
        AND end_date >= ${fromDateKey}::date
        AND start_date <= ${toDateKeyValue}::date
        AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
    `;
    const leaveHoursByOwner = computeLeaveHoursByOwner(leaveRows, fromDateKey, toDateKeyValue);

    const callTotalRows = await sql`
      SELECT
        COUNT(*)::int AS calls,
        COUNT(*) FILTER (WHERE (COALESCE(qe.meta->>'outcome', '') ILIKE 'Answered%' OR COALESCE(NULLIF(qe.meta->>'durationSec','')::int, 0) > 0 OR COALESCE(qe.meta->>'outcome', '') = 'Gatekeeper' OR COALESCE(qe.meta->>'actionKey', '') IN ('gatekeeper_callback', 'gatekeeper_send_email', 'gatekeeper_dead_end')))::int AS answered,
        COUNT(*) FILTER (WHERE (COALESCE(qe.meta->>'outcome', '') = 'Answered - interested' OR COALESCE(qe.meta->>'actionKey', '') = 'answered_interested'))::int AS answered_interested,
        COUNT(*) FILTER (WHERE (COALESCE(qe.meta->>'outcome', '') = 'Answered - not interested' OR COALESCE(qe.meta->>'actionKey', '') = 'answered_not_interested'))::int AS answered_not_interested,
        COUNT(*) FILTER (WHERE (COALESCE(qe.meta->>'outcome', '') = 'Answered - wants info' OR COALESCE(qe.meta->>'actionKey', '') IN ('wants_info_callback', 'wants_info_email_only')))::int AS wants_more_info,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'actionKey', '') = 'wants_info_callback')::int AS wants_more_info_callback,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'actionKey', '') = 'wants_info_email_only')::int AS wants_more_info_email_only,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'outcome', '') = 'No answer' OR COALESCE(qe.meta->>'actionKey', '') = 'no_answer')::int AS no_answer,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'outcome', '') = 'Left voicemail' OR COALESCE(qe.meta->>'actionKey', '') = 'voicemail')::int AS left_voicemail,
        COUNT(*) FILTER (WHERE (COALESCE(qe.meta->>'outcome', '') = 'Gatekeeper' OR COALESCE(qe.meta->>'actionKey', '') IN ('gatekeeper_callback', 'gatekeeper_send_email', 'gatekeeper_dead_end')))::int AS gatekeeper,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'actionKey', '') = 'gatekeeper_callback')::int AS gatekeeper_callback,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'actionKey', '') = 'gatekeeper_send_email')::int AS gatekeeper_send_email,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'actionKey', '') = 'gatekeeper_dead_end')::int AS gatekeeper_dead_end,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'outcome', '') = 'Wrong number' OR COALESCE(qe.meta->>'actionKey', '') = 'wrong_number')::int AS wrong_number
      FROM queue_events qe
      JOIN queue_leads ql ON ql.id = qe.lead_id
      WHERE qe.event_type = 'call'
      AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
    `;

    const qualifiedRows = await sql`
      SELECT
        COUNT(*)::int AS qualification_events,
        COUNT(DISTINCT qe.lead_id)::int AS qualified
      FROM queue_events qe
      JOIN queue_leads ql ON ql.id = qe.lead_id
      WHERE qe.event_type = 'status_change'
      AND qe.to_status = 'qualified'
      AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
    `;

    const stageMovementRows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE ql.meeting_booked_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz)::int AS meeting_booked,
        COUNT(*) FILTER (WHERE ql.meeting_attended_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz)::int AS meeting_attended,
        COUNT(*) FILTER (WHERE ql.proposal_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz)::int AS proposal,
        COUNT(*) FILTER (WHERE ql.won_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz)::int AS won
      FROM queue_leads ql
      WHERE ql.archived_at IS NULL
        AND (${ownerId}::text IS NULL OR ql.owner_id = ${ownerId})
        AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
    `;

    const interestedStageRows = await sql`
      WITH interested AS (
        SELECT
          qe.lead_id,
          MIN(qe.created_at) AS first_interested_at
        FROM queue_events qe
        JOIN queue_leads ql ON ql.id = qe.lead_id
        WHERE qe.event_type = 'call'
        AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
        AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
        AND (
          COALESCE(qe.meta->>'actionKey', '') = 'answered_interested'
          OR COALESCE(qe.meta->>'outcome', '') = 'Answered - interested'
        )
        GROUP BY qe.lead_id
      ), qualified_after AS (
        SELECT i.lead_id
        FROM interested i
        JOIN queue_events qe ON qe.lead_id = i.lead_id
        JOIN queue_leads ql ON ql.id = i.lead_id
        WHERE qe.event_type = 'status_change'
        AND qe.to_status = 'qualified'
        AND qe.created_at >= i.first_interested_at
        AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
        AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
        GROUP BY i.lead_id
      )
      SELECT
        (SELECT COUNT(*)::int FROM interested) AS interested_leads,
        (SELECT COUNT(*)::int FROM qualified_after) AS qualified_from_interested
    `;

    const funnelChainRows = await sql`
      WITH interested AS (
        SELECT
          qe.lead_id,
          MIN(qe.created_at) AS first_interested_at
        FROM queue_events qe
        JOIN queue_leads ql ON ql.id = qe.lead_id
        WHERE qe.event_type = 'call'
          AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
          AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
          AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
          AND (
            COALESCE(qe.meta->>'actionKey', '') = 'answered_interested'
            OR COALESCE(qe.meta->>'outcome', '') = 'Answered - interested'
          )
        GROUP BY qe.lead_id
      ), qualified_after AS (
        SELECT i.lead_id
        FROM interested i
        JOIN queue_events qe ON qe.lead_id = i.lead_id
        JOIN queue_leads ql ON ql.id = i.lead_id
        WHERE qe.event_type = 'status_change'
          AND qe.to_status = 'qualified'
          AND qe.created_at >= i.first_interested_at
          AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
          AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
          AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
        GROUP BY i.lead_id
      )
      SELECT
        COUNT(*)::int AS interested_from_qualified,
        COUNT(*) FILTER (WHERE ql.meeting_booked_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz)::int AS meeting_booked_from_interested,
        COUNT(*) FILTER (WHERE ql.meeting_attended_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz)::int AS meeting_attended_from_booked,
        COUNT(*) FILTER (WHERE ql.proposal_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz)::int AS proposal_from_attended,
        COUNT(*) FILTER (WHERE ql.scoping_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz)::int AS scoping_from_proposal,
        COUNT(*) FILTER (WHERE ql.won_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz)::int AS won_from_scoping
      FROM qualified_after qa
      JOIN queue_leads ql ON ql.id = qa.lead_id
      WHERE ql.archived_at IS NULL
    `;

    const qualifyTimingRows = await sql`
      WITH first_qualified AS (
        SELECT DISTINCT ON (qe.lead_id)
          qe.lead_id,
          qe.created_at AS qualified_at
        FROM queue_events qe
        JOIN queue_leads ql ON ql.id = qe.lead_id
        WHERE qe.event_type = 'status_change'
        AND qe.to_status = 'qualified'
        AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
        AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
        ORDER BY qe.lead_id, qe.created_at ASC
      )
      SELECT
        COUNT(*)::int AS qualified_leads,
        AVG(EXTRACT(EPOCH FROM (fq.qualified_at - ql.created_at)) / 3600.0)::float8 AS avg_hours,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (fq.qualified_at - ql.created_at)) / 3600.0)::float8 AS median_hours
      FROM first_qualified fq
      JOIN queue_leads ql ON ql.id = fq.lead_id
      WHERE ql.created_at IS NOT NULL
      AND fq.qualified_at >= ql.created_at
    `;


    const ownerCallRows = await sql`
      SELECT
        COALESCE(qe.owner_name, ql.owner, 'Unknown') AS owner,
        COALESCE(qe.owner_id, ql.owner_id, '') AS owner_id,
        COUNT(*)::int AS c
      FROM queue_events qe
      JOIN queue_leads ql ON ql.id = qe.lead_id
      WHERE qe.event_type = 'call'
      AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
      GROUP BY 1,2
    `;

    const ownerOutcomeRows = await sql`
      SELECT
        COALESCE(qe.owner_name, ql.owner, 'Unknown') AS owner,
        COALESCE(qe.owner_id, ql.owner_id, '') AS owner_id,
        COUNT(*) FILTER (WHERE (COALESCE(qe.meta->>'outcome', '') ILIKE 'Answered%' OR COALESCE(NULLIF(qe.meta->>'durationSec','')::int, 0) > 0 OR COALESCE(qe.meta->>'outcome', '') = 'Gatekeeper' OR COALESCE(qe.meta->>'actionKey', '') IN ('gatekeeper_callback', 'gatekeeper_send_email', 'gatekeeper_dead_end')))::int AS answered,
        COUNT(*) FILTER (WHERE (COALESCE(qe.meta->>'outcome', '') = 'Answered - interested' OR COALESCE(qe.meta->>'actionKey', '') = 'answered_interested'))::int AS answered_interested,
        COUNT(*) FILTER (WHERE (COALESCE(qe.meta->>'outcome', '') = 'Answered - not interested' OR COALESCE(qe.meta->>'actionKey', '') = 'answered_not_interested'))::int AS answered_not_interested,
        COUNT(*) FILTER (WHERE (COALESCE(qe.meta->>'outcome', '') = 'Answered - wants info' OR COALESCE(qe.meta->>'actionKey', '') IN ('wants_info_callback', 'wants_info_email_only')))::int AS wants_more_info,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'actionKey', '') = 'wants_info_callback')::int AS wants_more_info_callback,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'actionKey', '') = 'wants_info_email_only')::int AS wants_more_info_email_only,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'outcome', '') = 'No answer' OR COALESCE(qe.meta->>'actionKey', '') = 'no_answer')::int AS no_answer,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'outcome', '') = 'Left voicemail' OR COALESCE(qe.meta->>'actionKey', '') = 'voicemail')::int AS left_voicemail,
        COUNT(*) FILTER (WHERE (COALESCE(qe.meta->>'outcome', '') = 'Gatekeeper' OR COALESCE(qe.meta->>'actionKey', '') IN ('gatekeeper_callback', 'gatekeeper_send_email', 'gatekeeper_dead_end')))::int AS gatekeeper,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'actionKey', '') = 'gatekeeper_callback')::int AS gatekeeper_callback,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'actionKey', '') = 'gatekeeper_send_email')::int AS gatekeeper_send_email,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'actionKey', '') = 'gatekeeper_dead_end')::int AS gatekeeper_dead_end,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'outcome', '') = 'Wrong number' OR COALESCE(qe.meta->>'actionKey', '') = 'wrong_number')::int AS wrong_number
      FROM queue_events qe
      JOIN queue_leads ql ON ql.id = qe.lead_id
      WHERE qe.event_type = 'call'
      AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
      GROUP BY 1,2
    `;

    const ownerQualifiedRows = await sql`
      SELECT
        COALESCE(qe.owner_name, ql.owner, 'Unknown') AS owner,
        COALESCE(qe.owner_id, ql.owner_id, '') AS owner_id,
        COUNT(*)::int AS qualified
      FROM queue_events qe
      JOIN queue_leads ql ON ql.id = qe.lead_id
      WHERE qe.event_type = 'status_change'
      AND qe.to_status = 'qualified'
      AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
      GROUP BY 1,2
    `;

    const ownerQualifyTimingRows = await sql`
      WITH first_qualified AS (
        SELECT DISTINCT ON (qe.lead_id)
          qe.lead_id,
          qe.created_at AS qualified_at,
          COALESCE(qe.owner_name, ql.owner, 'Unknown') AS owner,
          COALESCE(qe.owner_id, ql.owner_id, '') AS owner_id
        FROM queue_events qe
        JOIN queue_leads ql ON ql.id = qe.lead_id
        WHERE qe.event_type = 'status_change'
        AND qe.to_status = 'qualified'
        AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
        AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
        ORDER BY qe.lead_id, qe.created_at ASC
      )
      SELECT
        fq.owner,
        fq.owner_id,
        COUNT(*)::int AS qualified_leads,
        AVG(EXTRACT(EPOCH FROM (fq.qualified_at - ql.created_at)) / 3600.0)::float8 AS avg_hours,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (fq.qualified_at - ql.created_at)) / 3600.0)::float8 AS median_hours
      FROM first_qualified fq
      JOIN queue_leads ql ON ql.id = fq.lead_id
      WHERE ql.created_at IS NOT NULL
      AND fq.qualified_at >= ql.created_at
      GROUP BY fq.owner, fq.owner_id
    `;


    const subSectorCallRows = await sql`
      SELECT
        COALESCE(NULLIF(TRIM(ql.sector), ''), 'Unknown') AS sector,
        COALESCE(NULLIF(TRIM(ql.sub_sector), ''), 'Unknown') AS sub_sector,
        COUNT(*)::int AS calls,
        COUNT(*) FILTER (WHERE (COALESCE(qe.meta->>'outcome', '') ILIKE 'Answered%' OR COALESCE(NULLIF(qe.meta->>'durationSec','')::int, 0) > 0 OR COALESCE(qe.meta->>'outcome', '') = 'Gatekeeper' OR COALESCE(qe.meta->>'actionKey', '') IN ('gatekeeper_callback', 'gatekeeper_send_email', 'gatekeeper_dead_end')))::int AS answered,
        COUNT(*) FILTER (WHERE (COALESCE(qe.meta->>'outcome', '') = 'Answered - interested' OR COALESCE(qe.meta->>'actionKey', '') = 'answered_interested'))::int AS answered_interested,
        COUNT(*) FILTER (WHERE (COALESCE(qe.meta->>'outcome', '') = 'Answered - not interested' OR COALESCE(qe.meta->>'actionKey', '') = 'answered_not_interested'))::int AS answered_not_interested,
        COUNT(*) FILTER (WHERE (COALESCE(qe.meta->>'outcome', '') = 'Answered - wants info' OR COALESCE(qe.meta->>'actionKey', '') IN ('wants_info_callback', 'wants_info_email_only')))::int AS wants_more_info,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'actionKey', '') = 'wants_info_callback')::int AS wants_more_info_callback,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'actionKey', '') = 'wants_info_email_only')::int AS wants_more_info_email_only,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'outcome', '') = 'No answer' OR COALESCE(qe.meta->>'actionKey', '') = 'no_answer')::int AS no_answer,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'outcome', '') = 'Left voicemail' OR COALESCE(qe.meta->>'actionKey', '') = 'voicemail')::int AS left_voicemail,
        COUNT(*) FILTER (WHERE (COALESCE(qe.meta->>'outcome', '') = 'Gatekeeper' OR COALESCE(qe.meta->>'actionKey', '') IN ('gatekeeper_callback', 'gatekeeper_send_email', 'gatekeeper_dead_end')))::int AS gatekeeper,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'actionKey', '') = 'gatekeeper_callback')::int AS gatekeeper_callback,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'actionKey', '') = 'gatekeeper_send_email')::int AS gatekeeper_send_email,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'actionKey', '') = 'gatekeeper_dead_end')::int AS gatekeeper_dead_end,
        COUNT(*) FILTER (WHERE COALESCE(qe.meta->>'outcome', '') = 'Wrong number' OR COALESCE(qe.meta->>'actionKey', '') = 'wrong_number')::int AS wrong_number
      FROM queue_events qe
      JOIN queue_leads ql ON ql.id = qe.lead_id
      WHERE qe.event_type = 'call'
      AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
      GROUP BY 1,2
    `;

    const subSectorQualifiedRows = await sql`
      SELECT
        COALESCE(NULLIF(TRIM(ql.sector), ''), 'Unknown') AS sector,
        COALESCE(NULLIF(TRIM(ql.sub_sector), ''), 'Unknown') AS sub_sector,
        COUNT(*)::int AS qualified
      FROM queue_events qe
      JOIN queue_leads ql ON ql.id = qe.lead_id
      WHERE qe.event_type = 'status_change'
      AND qe.to_status = 'qualified'
      AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
      GROUP BY 1,2
    `;

    const sectorRevenueCallRows = await sql`
      WITH calls AS (
        SELECT
          COALESCE(NULLIF(TRIM(ql.sector), ''), 'Unknown') AS sector,
          CASE
            WHEN ql.company_revenue IS NULL OR NULLIF(BTRIM(ql.company_revenue), '') IS NULL THEN 'Unknown'
            WHEN NULLIF(regexp_replace(ql.company_revenue, '[^0-9]', '', 'g'), '') IS NULL THEN 'Unknown'
            WHEN (NULLIF(regexp_replace(ql.company_revenue, '[^0-9]', '', 'g'), '')::numeric) <= 500000 THEN '£0-500k'
            WHEN (NULLIF(regexp_replace(ql.company_revenue, '[^0-9]', '', 'g'), '')::numeric) <= 5000000 THEN '£500k-5m'
            WHEN (NULLIF(regexp_replace(ql.company_revenue, '[^0-9]', '', 'g'), '')::numeric) <= 50000000 THEN '£5m-50m'
            ELSE '£50m+'
          END AS revenue_band,
          COUNT(*)::int AS calls,
          COUNT(*) FILTER (WHERE (
            COALESCE(qe.meta->>'outcome', '') ILIKE 'Answered%'
            OR COALESCE(NULLIF(qe.meta->>'durationSec','')::int, 0) > 0
            OR COALESCE(qe.meta->>'outcome', '') = 'Gatekeeper'
            OR COALESCE(qe.meta->>'actionKey', '') IN ('gatekeeper_callback', 'gatekeeper_send_email', 'gatekeeper_dead_end')
          ))::int AS answered
        FROM queue_events qe
        JOIN queue_leads ql ON ql.id = qe.lead_id
        WHERE qe.event_type = 'call'
        AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
        AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
        GROUP BY 1,2
      )
      SELECT * FROM calls
    `;

    const sectorRevenueQualifiedRows = await sql`
      WITH qualified AS (
        SELECT
          COALESCE(NULLIF(TRIM(ql.sector), ''), 'Unknown') AS sector,
          CASE
            WHEN ql.company_revenue IS NULL OR NULLIF(BTRIM(ql.company_revenue), '') IS NULL THEN 'Unknown'
            WHEN NULLIF(regexp_replace(ql.company_revenue, '[^0-9]', '', 'g'), '') IS NULL THEN 'Unknown'
            WHEN (NULLIF(regexp_replace(ql.company_revenue, '[^0-9]', '', 'g'), '')::numeric) <= 500000 THEN '£0-500k'
            WHEN (NULLIF(regexp_replace(ql.company_revenue, '[^0-9]', '', 'g'), '')::numeric) <= 5000000 THEN '£500k-5m'
            WHEN (NULLIF(regexp_replace(ql.company_revenue, '[^0-9]', '', 'g'), '')::numeric) <= 50000000 THEN '£5m-50m'
            ELSE '£50m+'
          END AS revenue_band,
          COUNT(DISTINCT qe.lead_id)::int AS qualified
        FROM queue_events qe
        JOIN queue_leads ql ON ql.id = qe.lead_id
        WHERE qe.event_type = 'status_change'
        AND qe.to_status = 'qualified'
        AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
        AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
        GROUP BY 1,2
      )
      SELECT * FROM qualified
    `;

    const sectorEmployeeCallRows = await sql`
      WITH calls AS (
        SELECT
          COALESCE(NULLIF(TRIM(ql.sector), ''), 'Unknown') AS sector,
          CASE
            WHEN ql.company_employees IS NULL THEN 'Unknown'
            WHEN ql.company_employees <= 50 THEN '1-50'
            WHEN ql.company_employees <= 200 THEN '51-200'
            WHEN ql.company_employees <= 1000 THEN '201-1000'
            ELSE '1001+'
          END AS employee_band,
          COUNT(*)::int AS calls,
          COUNT(*) FILTER (WHERE (
            COALESCE(qe.meta->>'outcome', '') ILIKE 'Answered%'
            OR COALESCE(NULLIF(qe.meta->>'durationSec','')::int, 0) > 0
            OR COALESCE(qe.meta->>'outcome', '') = 'Gatekeeper'
            OR COALESCE(qe.meta->>'actionKey', '') IN ('gatekeeper_callback', 'gatekeeper_send_email', 'gatekeeper_dead_end')
          ))::int AS answered
        FROM queue_events qe
        JOIN queue_leads ql ON ql.id = qe.lead_id
        WHERE qe.event_type = 'call'
        AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
        AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
        GROUP BY 1,2
      )
      SELECT * FROM calls
    `;

    const sectorEmployeeQualifiedRows = await sql`
      WITH qualified AS (
        SELECT
          COALESCE(NULLIF(TRIM(ql.sector), ''), 'Unknown') AS sector,
          CASE
            WHEN ql.company_employees IS NULL THEN 'Unknown'
            WHEN ql.company_employees <= 50 THEN '1-50'
            WHEN ql.company_employees <= 200 THEN '51-200'
            WHEN ql.company_employees <= 1000 THEN '201-1000'
            ELSE '1001+'
          END AS employee_band,
          COUNT(DISTINCT qe.lead_id)::int AS qualified
        FROM queue_events qe
        JOIN queue_leads ql ON ql.id = qe.lead_id
        WHERE qe.event_type = 'status_change'
        AND qe.to_status = 'qualified'
        AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
        AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
        AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
        GROUP BY 1,2
      )
      SELECT * FROM qualified
    `;


    const repNameById = new Map(
      repRows
        .map((rep) => [String(rep.ghl_owner_id || '').trim(), String(rep.name || rep.email || rep.ghl_owner_id || '').trim()])
        .filter(([id, name]) => id && name)
    );

    const canonicalOwner = (owner, ownerIdValue) => {
      const ownerId = String(ownerIdValue || '').trim();
      if (ownerId && repNameById.has(ownerId)) {
        return { owner: repNameById.get(ownerId), ownerId };
      }
      const ownerName = String(owner || 'Unknown').trim() || 'Unknown';
      return { owner: ownerName, ownerId };
    };

    const ownerGroupKey = (owner, ownerIdValue) => {
      const normalized = canonicalOwner(owner, ownerIdValue);
      return normalized.ownerId
        ? `id:${normalized.ownerId}`
        : `name:${normalized.owner.toLowerCase()}`;
    };

    const ownerMap = new Map();
    const ensureOwner = (owner, ownerIdValue) => {
      const normalized = canonicalOwner(owner, ownerIdValue);
      const k = ownerGroupKey(normalized.owner, normalized.ownerId);
      if (!ownerMap.has(k)) {
        ownerMap.set(k, {
          owner: normalized.owner,
          ownerId: normalized.ownerId,
          calls: 0,
          answered: 0,
          answeredInterested: 0,
          qualified: 0,
          avgQualifyHours: null,
          medianQualifyHours: null,
          qualifiedTimingLeads: 0,
          answeredNotInterested: 0,
          wantsMoreInfo: 0,
          wantsMoreInfoCallback: 0,
          wantsMoreInfoEmailOnly: 0,
          noAnswer: 0,
          leftVoicemail: 0,
          gatekeeper: 0,
          gatekeeperCallback: 0,
          gatekeeperSendEmail: 0,
          gatekeeperDeadEnd: 0,
          wrongNumber: 0,
          callbacksScheduled: 0,
          manualMeetings: 0,
        });
      }
      return ownerMap.get(k);
    };

    const mergedDayMap = new Map();
    for (const row of dayRows) {
      mergedDayMap.set(String(row.d), {
        d: row.d,
        calls: Number(row.calls || 0),
        answered: Number(row.answered || 0),
        answered_interested: Number(row.answered_interested || 0),
        qualification_events: Number(row.qualification_events || 0),
        qualified: Number(row.qualified || 0),
        meetings_booked: Number(row.meetings_booked || 0),
        meetings_attended: Number(row.meetings_attended || 0),
      });
    }
    for (const row of manualDayRows) {
      const key = String(row.d);
      const cur = mergedDayMap.get(key) || {
        d: row.d,
        calls: 0,
        answered: 0,
        answered_interested: 0,
        qualification_events: 0,
        qualified: 0,
        meetings_booked: 0,
        meetings_attended: 0,
      };
      cur.calls += Number(row.calls || 0);
      mergedDayMap.set(key, cur);
    }
    const mergedDayRows = Array.from(mergedDayMap.values()).sort((a, b) => compareDateLike(a.d, b.d));

    const mergedHourMap = new Map();
    for (const row of hourRows) {
      mergedHourMap.set(String(row.hour_label), {
        hour_label: row.hour_label,
        calls: Number(row.calls || 0),
        answered: Number(row.answered || 0),
        answered_interested: Number(row.answered_interested || 0),
        qualification_events: Number(row.qualification_events || 0),
        qualified: Number(row.qualified || 0),
        meetings_booked: Number(row.meetings_booked || 0),
        meetings_attended: Number(row.meetings_attended || 0),
      });
    }
    for (const row of manualHourRows) {
      const key = String(row.hour_label);
      const cur = mergedHourMap.get(key) || {
        hour_label: row.hour_label,
        calls: 0,
        answered: 0,
        answered_interested: 0,
        qualification_events: 0,
        qualified: 0,
        meetings_booked: 0,
        meetings_attended: 0,
      };
      cur.calls += Number(row.calls || 0);
      mergedHourMap.set(key, cur);
    }
    const mergedHourRows = Array.from(mergedHourMap.values()).sort((a, b) => String(a.hour_label).localeCompare(String(b.hour_label)));

    const mergedOwnerDayMap = new Map();
    for (const row of ownerDayRows) {
      const normalized = canonicalOwner(row.owner, row.owner_id);
      const key = `${row.d}||${ownerGroupKey(normalized.owner, normalized.ownerId)}`;
      mergedOwnerDayMap.set(key, {
        d: row.d,
        owner: normalized.owner,
        owner_id: normalized.ownerId,
        calls: Number(row.calls || 0),
      });
    }
    for (const row of manualOwnerDayRows) {
      const normalized = canonicalOwner(row.owner, row.owner_id);
      const key = `${row.d}||${ownerGroupKey(normalized.owner, normalized.ownerId)}`;
      const cur = mergedOwnerDayMap.get(key) || {
        d: row.d,
        owner: normalized.owner,
        owner_id: normalized.ownerId,
        calls: 0,
      };
      cur.calls += Number(row.calls || 0);
      mergedOwnerDayMap.set(key, cur);
    }
    const mergedOwnerDayRows = Array.from(mergedOwnerDayMap.values()).sort((a, b) => compareDateLike(a.d, b.d) || String(a.owner).localeCompare(String(b.owner)));

    const mergedOwnerHourMap = new Map();
    for (const row of ownerHourRows) {
      const normalized = canonicalOwner(row.owner, row.owner_id);
      const key = `${row.hour_label}||${ownerGroupKey(normalized.owner, normalized.ownerId)}`;
      mergedOwnerHourMap.set(key, {
        hour_label: row.hour_label,
        owner: normalized.owner,
        owner_id: normalized.ownerId,
        calls: Number(row.calls || 0),
      });
    }
    for (const row of manualOwnerHourRows) {
      const normalized = canonicalOwner(row.owner, row.owner_id);
      const key = `${row.hour_label}||${ownerGroupKey(normalized.owner, normalized.ownerId)}`;
      const cur = mergedOwnerHourMap.get(key) || {
        hour_label: row.hour_label,
        owner: normalized.owner,
        owner_id: normalized.ownerId,
        calls: 0,
      };
      cur.calls += Number(row.calls || 0);
      mergedOwnerHourMap.set(key, cur);
    }
    const mergedOwnerHourRows = Array.from(mergedOwnerHourMap.values()).sort((a, b) => String(a.hour_label).localeCompare(String(b.hour_label)) || String(a.owner).localeCompare(String(b.owner)));

    const ownerCallMergedMap = new Map();
    for (const row of ownerCallRows) {
      const normalized = canonicalOwner(row.owner, row.owner_id);
      const key = ownerGroupKey(normalized.owner, normalized.ownerId);
      ownerCallMergedMap.set(key, {
        owner: normalized.owner,
        owner_id: normalized.ownerId,
        c: Number(row.c || 0),
      });
    }
    for (const row of manualOwnerCallRows) {
      const normalized = canonicalOwner(row.owner, row.owner_id);
      const key = ownerGroupKey(normalized.owner, normalized.ownerId);
      const cur = ownerCallMergedMap.get(key) || { owner: normalized.owner, owner_id: normalized.ownerId, c: 0 };
      cur.c += Number(row.c || 0);
      ownerCallMergedMap.set(key, cur);
    }
    const ownerCallMergedRows = Array.from(ownerCallMergedMap.values());

    for (const rep of repRows) {
      ensureOwner(rep.name || rep.email || rep.ghl_owner_id || 'Unknown', rep.ghl_owner_id || '');
    }

    for (const row of ownerCallMergedRows) ensureOwner(row.owner, row.owner_id).calls = row.c || 0;
    for (const row of ownerOutcomeRows) {
      const cur = ensureOwner(row.owner, row.owner_id);
      cur.answered = row.answered || 0;
      cur.answeredInterested = row.answered_interested || 0;
      cur.answeredNotInterested = row.answered_not_interested || 0;
      cur.wantsMoreInfo = row.wants_more_info || 0;
      cur.wantsMoreInfoCallback = row.wants_more_info_callback || 0;
      cur.wantsMoreInfoEmailOnly = row.wants_more_info_email_only || 0;
      cur.noAnswer = row.no_answer || 0;
      cur.leftVoicemail = row.left_voicemail || 0;
      cur.gatekeeper = row.gatekeeper || 0;
      cur.gatekeeperCallback = row.gatekeeper_callback || 0;
      cur.gatekeeperSendEmail = row.gatekeeper_send_email || 0;
      cur.gatekeeperDeadEnd = row.gatekeeper_dead_end || 0;
      cur.wrongNumber = row.wrong_number || 0;
    }
    for (const row of ownerQualifiedRows) ensureOwner(row.owner, row.owner_id).qualified = row.qualified || 0;
    for (const row of ownerQualifyTimingRows) {
      const cur = ensureOwner(row.owner, row.owner_id);
      cur.avgQualifyHours = Number.isFinite(row.avg_hours) ? Number(row.avg_hours) : null;
      cur.medianQualifyHours = Number.isFinite(row.median_hours) ? Number(row.median_hours) : null;
      cur.qualifiedTimingLeads = row.qualified_leads || 0;
    }
    for (const row of ownerCallbackRows) ensureOwner(row.owner, row.owner_id).callbacksScheduled = row.callbacks_scheduled || 0;
    for (const row of manualOwnerMeetingRows) ensureOwner(row.owner, row.owner_id).manualMeetings = row.meetings || 0;

    for (const ownerRow of ownerMap.values()) {
      const leaveHours = Number(leaveHoursByOwner.get(String(ownerRow.ownerId || '')) || 0);
      const availableHours = Math.max(0, rangeWorkHoursPerRep - leaveHours);
      ownerRow.leaveHours = leaveHours;
      ownerRow.leaveDays = leaveHours / REPORT_WORKDAY_HOURS;
      ownerRow.availableHours = availableHours;
      ownerRow.availabilityPct = rangeWorkHoursPerRep > 0 ? pct(availableHours, rangeWorkHoursPerRep) : 0;
      ownerRow.adjustedCallTarget = Math.round((dailyCallTarget * availableHours) / REPORT_WORKDAY_HOURS);
      ownerRow.callsPerAvailableHour = availableHours > 0 ? Number(ownerRow.calls || 0) / availableHours : null;
    }

    const subMap = new Map();
    const subKey = (sector, sub) => `${sector || 'Unknown'}||${sub || 'Unknown'}`;
    const ensureSub = (sector, subSector) => {
      const k = subKey(sector, subSector);
      if (!subMap.has(k)) {
        subMap.set(k, {
          sector: sector || 'Unknown',
          subSector: subSector || 'Unknown',
          calls: 0,
          answered: 0,
          answeredInterested: 0,
          qualified: 0,
          answeredNotInterested: 0,
          wantsMoreInfo: 0,
          wantsMoreInfoCallback: 0,
          wantsMoreInfoEmailOnly: 0,
          noAnswer: 0,
          leftVoicemail: 0,
          gatekeeper: 0,
          gatekeeperCallback: 0,
          gatekeeperSendEmail: 0,
          gatekeeperDeadEnd: 0,
          wrongNumber: 0,
          callbacksScheduled: 0,
        });
      }
      return subMap.get(k);
    };

    for (const row of subSectorCallRows) {
      const cur = ensureSub(row.sector, row.sub_sector);
      cur.calls = row.calls || 0;
      cur.answered = row.answered || 0;
      cur.answeredInterested = row.answered_interested || 0;
      cur.answeredNotInterested = row.answered_not_interested || 0;
      cur.wantsMoreInfo = row.wants_more_info || 0;
      cur.wantsMoreInfoCallback = row.wants_more_info_callback || 0;
      cur.wantsMoreInfoEmailOnly = row.wants_more_info_email_only || 0;
      cur.noAnswer = row.no_answer || 0;
      cur.leftVoicemail = row.left_voicemail || 0;
      cur.gatekeeper = row.gatekeeper || 0;
      cur.gatekeeperCallback = row.gatekeeper_callback || 0;
      cur.gatekeeperSendEmail = row.gatekeeper_send_email || 0;
      cur.gatekeeperDeadEnd = row.gatekeeper_dead_end || 0;
      cur.wrongNumber = row.wrong_number || 0;
    }
    for (const row of subSectorQualifiedRows) ensureSub(row.sector, row.sub_sector).qualified = row.qualified || 0;
    for (const row of subSectorCallbackRows) ensureSub(row.sector, row.sub_sector).callbacksScheduled = row.callbacks_scheduled || 0;

    const bySubSector = Array.from(subMap.values()).sort((a, b) => b.calls - a.calls || b.qualified - a.qualified || a.sector.localeCompare(b.sector) || a.subSector.localeCompare(b.subSector));

    const sectorMap = new Map();
    for (const row of bySubSector) {
      const k = row.sector || 'Unknown';
      if (!sectorMap.has(k)) {
        sectorMap.set(k, {
          sector: k,
          calls: 0,
          answered: 0,
          answeredInterested: 0,
          qualified: 0,
          answeredNotInterested: 0,
          wantsMoreInfo: 0,
          wantsMoreInfoCallback: 0,
          wantsMoreInfoEmailOnly: 0,
          noAnswer: 0,
          leftVoicemail: 0,
          gatekeeper: 0,
          gatekeeperCallback: 0,
          gatekeeperSendEmail: 0,
          gatekeeperDeadEnd: 0,
          wrongNumber: 0,
          callbacksScheduled: 0,
        });
      }
      const cur = sectorMap.get(k);
      cur.calls += row.calls || 0;
      cur.answered += row.answered || 0;
      cur.answeredInterested += row.answeredInterested || 0;
      cur.qualified += row.qualified || 0;
      cur.answeredNotInterested += row.answeredNotInterested || 0;
      cur.wantsMoreInfo += row.wantsMoreInfo || 0;
      cur.wantsMoreInfoCallback += row.wantsMoreInfoCallback || 0;
      cur.wantsMoreInfoEmailOnly += row.wantsMoreInfoEmailOnly || 0;
      cur.noAnswer += row.noAnswer || 0;
      cur.leftVoicemail += row.leftVoicemail || 0;
      cur.gatekeeper += row.gatekeeper || 0;
      cur.gatekeeperCallback += row.gatekeeperCallback || 0;
      cur.gatekeeperSendEmail += row.gatekeeperSendEmail || 0;
      cur.gatekeeperDeadEnd += row.gatekeeperDeadEnd || 0;
      cur.wrongNumber += row.wrongNumber || 0;
      cur.callbacksScheduled += row.callbacksScheduled || 0;
    }
    const bySector = Array.from(sectorMap.values()).sort((a, b) => b.calls - a.calls || b.qualified - a.qualified || a.sector.localeCompare(b.sector));

    const revenueBandMap = new Map();
    const revenueBandKey = (sector, band) => `${sector || 'Unknown'}||${band || 'Unknown'}`;
    const ensureRevenueBand = (sector, band) => {
      const k = revenueBandKey(sector, band);
      if (!revenueBandMap.has(k)) {
        revenueBandMap.set(k, {
          sector: sector || 'Unknown',
          revenueBand: band || 'Unknown',
          calls: 0,
          answered: 0,
          qualified: 0,
          answerRate: 0,
          qualifyFromCallsRate: 0,
        });
      }
      return revenueBandMap.get(k);
    };

    for (const row of sectorRevenueCallRows) {
      const cur = ensureRevenueBand(row.sector, row.revenue_band);
      cur.calls = row.calls || 0;
      cur.answered = row.answered || 0;
    }
    for (const row of sectorRevenueQualifiedRows) {
      ensureRevenueBand(row.sector, row.revenue_band).qualified = row.qualified || 0;
    }

    const bySectorRevenueBand = Array.from(revenueBandMap.values())
      .map((r) => ({
        ...r,
        answerRate: pct(r.answered || 0, r.calls || 0),
        qualifyFromCallsRate: pct(r.qualified || 0, r.calls || 0),
      }))
      .sort((a, b) =>
        a.sector.localeCompare(b.sector)
        || ((REVENUE_BAND_ORDER[a.revenueBand] ?? 999) - (REVENUE_BAND_ORDER[b.revenueBand] ?? 999))
        || (b.calls - a.calls)
      );

    const employeeBandMap = new Map();
    const employeeBandKey = (sector, band) => `${sector || 'Unknown'}||${band || 'Unknown'}`;
    const ensureEmployeeBand = (sector, band) => {
      const k = employeeBandKey(sector, band);
      if (!employeeBandMap.has(k)) {
        employeeBandMap.set(k, {
          sector: sector || 'Unknown',
          employeeBand: band || 'Unknown',
          calls: 0,
          answered: 0,
          qualified: 0,
          answerRate: 0,
          qualifyFromCallsRate: 0,
        });
      }
      return employeeBandMap.get(k);
    };

    for (const row of sectorEmployeeCallRows) {
      const cur = ensureEmployeeBand(row.sector, row.employee_band);
      cur.calls = row.calls || 0;
      cur.answered = row.answered || 0;
    }
    for (const row of sectorEmployeeQualifiedRows) {
      ensureEmployeeBand(row.sector, row.employee_band).qualified = row.qualified || 0;
    }

    const bySectorEmployeeBand = Array.from(employeeBandMap.values())
      .map((r) => ({
        ...r,
        answerRate: pct(r.answered || 0, r.calls || 0),
        qualifyFromCallsRate: pct(r.qualified || 0, r.calls || 0),
      }))
      .sort((a, b) =>
        a.sector.localeCompare(b.sector)
        || ((EMPLOYEE_BAND_ORDER[a.employeeBand] ?? 999) - (EMPLOYEE_BAND_ORDER[b.employeeBand] ?? 999))
        || (b.calls - a.calls)
      );

    const callTotals = callTotalRows[0] || {};
    const manualCallTotals = manualCallTotalRows[0] || {};
    const manualMeetingTotals = manualMeetingTotalRows[0] || {};
    const stageMovement = stageMovementRows[0] || {};
    const funnelChain = funnelChainRows[0] || {};
    const timing = qualifyTimingRows[0] || {};
    const interestedStage = interestedStageRows[0] || {};
    const interestedLeads = interestedStage.interested_leads || 0;
    const qualifiedFromInterestedLeads = interestedStage.qualified_from_interested || 0;
    const summary = {
      calls: (callTotals.calls || 0) + (manualCallTotals.calls || 0),
      eventCalls: callTotals.calls || 0,
      manualCalls: manualCallTotals.calls || 0,
      answered: callTotals.answered || 0,
      answeredInterested: callTotals.answered_interested || 0,
      interestedLeads,
      qualifiedFromInterestedLeads,
      interestedToQualifiedRate: pct(qualifiedFromInterestedLeads, interestedLeads),
      qualified: qualifiedRows[0]?.qualified || 0,
      qualificationEvents: qualifiedRows[0]?.qualification_events || 0,
      meetingBooked: stageMovement.meeting_booked || 0,
      meetingAttended: stageMovement.meeting_attended || 0,
      proposal: stageMovement.proposal || 0,
      won: stageMovement.won || 0,
      funnelChain: {
        interestedFromQualified: funnelChain.interested_from_qualified || 0,
        meetingBookedFromInterested: funnelChain.meeting_booked_from_interested || 0,
        meetingAttendedFromBooked: funnelChain.meeting_attended_from_booked || 0,
        proposalFromAttended: funnelChain.proposal_from_attended || 0,
        scopingFromProposal: funnelChain.scoping_from_proposal || 0,
        wonFromScoping: funnelChain.won_from_scoping || 0,
      },
      avgQualifyHours: Number.isFinite(timing.avg_hours) ? Number(timing.avg_hours) : null,
      medianQualifyHours: Number.isFinite(timing.median_hours) ? Number(timing.median_hours) : null,
      qualifiedTimingLeads: timing.qualified_leads || 0,
      answeredNotInterested: callTotals.answered_not_interested || 0,
      wantsMoreInfo: callTotals.wants_more_info || 0,
      wantsMoreInfoCallback: callTotals.wants_more_info_callback || 0,
      wantsMoreInfoEmailOnly: callTotals.wants_more_info_email_only || 0,
      noAnswer: callTotals.no_answer || 0,
      leftVoicemail: callTotals.left_voicemail || 0,
      gatekeeper: callTotals.gatekeeper || 0,
      gatekeeperCallback: callTotals.gatekeeper_callback || 0,
      gatekeeperSendEmail: callTotals.gatekeeper_send_email || 0,
      gatekeeperDeadEnd: callTotals.gatekeeper_dead_end || 0,
      wrongNumber: callTotals.wrong_number || 0,
      callbacksScheduled: upcomingDedupedCallbacks.length || 0,
      manualMeetings: manualMeetingTotals.meetings || 0,
    };

    const ownerRowsForSummary = Array.from(ownerMap.values());
    const leaveHoursTotal = ownerRowsForSummary.reduce((sum, row) => sum + Number(row.leaveHours || 0), 0);
    const availableHoursTotal = ownerRowsForSummary.reduce((sum, row) => sum + Number(row.availableHours || 0), 0);
    const rawExpectedCalls = ownerRowsForSummary.length * rangeWorkdays * dailyCallTarget;
    const adjustedExpectedCalls = ownerRowsForSummary.reduce((sum, row) => sum + Number(row.adjustedCallTarget || 0), 0);

    summary.workdaysInRange = rangeWorkdays;
    summary.dailyCallTarget = dailyCallTarget;
    summary.repCount = ownerRowsForSummary.length;
    summary.leaveHoursTotal = leaveHoursTotal;
    summary.leaveDaysTotal = leaveHoursTotal / REPORT_WORKDAY_HOURS;
    summary.availableHoursTotal = availableHoursTotal;
    summary.rawExpectedCalls = rawExpectedCalls;
    summary.adjustedExpectedCalls = adjustedExpectedCalls;
    summary.adjustedAttainmentRate = adjustedExpectedCalls > 0 ? pct(summary.calls || 0, adjustedExpectedCalls) : 0;
    summary.callsPerAvailableHour = availableHoursTotal > 0 ? (Number(summary.calls || 0) / availableHoursTotal) : null;

    const pipelineSummary = opportunityRows.reduce((acc, row) => {
      const mrr = Number(row.mrr_value || 0);
      const oneOff = Number(row.one_off_value || 0);
      const callbackTs = row.callback_at ? new Date(row.callback_at).getTime() : NaN;

      acc.total_count += 1;
      acc.total_mrr += mrr;
      acc.total_one_off += oneOff;

      const age = opportunityAgeDays(opportunityStageTimestamp(row));
      if (age != null) {
        acc._age_sum += age;
        acc._age_count += 1;
      }

      if (!Number.isNaN(callbackTs)) {
        if (callbackTs < todayStart.getTime()) acc.overdue += 1;
        else if (callbackTs <= todayEnd.getTime()) acc.due_today += 1;
      }
      return acc;
    }, {
      total_count: 0,
      total_mrr: 0,
      total_one_off: 0,
      due_today: 0,
      overdue: 0,
      _age_sum: 0,
      _age_count: 0,
    });
    pipelineSummary.avg_stage_age_days = pipelineSummary._age_count ? (pipelineSummary._age_sum / pipelineSummary._age_count) : null;
    delete pipelineSummary._age_sum;
    delete pipelineSummary._age_count;

    const byPipelineStageMap = new Map();
    for (const row of opportunityRows) {
      const stage = String(row.opportunity_stage || 'unknown').toLowerCase();
      if (!byPipelineStageMap.has(stage)) {
        byPipelineStageMap.set(stage, {
          stage,
          count: 0,
          total_mrr: 0,
          total_one_off: 0,
          _age_sum: 0,
          _age_count: 0,
        });
      }
      const cur = byPipelineStageMap.get(stage);
      cur.count += 1;
      cur.total_mrr += Number(row.mrr_value || 0);
      cur.total_one_off += Number(row.one_off_value || 0);
      const age = opportunityAgeDays(opportunityStageTimestamp(row));
      if (age != null) {
        cur._age_sum += age;
        cur._age_count += 1;
      }
    }
    const byPipelineStage = Array.from(byPipelineStageMap.values())
      .map((row) => ({
        stage: row.stage,
        count: row.count,
        total_mrr: row.total_mrr,
        total_one_off: row.total_one_off,
        avg_age_days: row._age_count ? (row._age_sum / row._age_count) : null,
      }))
      .sort((a, b) => opportunityStageRank(a.stage) - opportunityStageRank(b.stage) || String(a.stage).localeCompare(String(b.stage)));

    const byPipelineOwnerMap = new Map();
    for (const row of opportunityRows) {
      const owner = row.owner || 'Unassigned';
      const owner_id = row.owner_id || '';
      const key = `${owner}||${owner_id}`;
      if (!byPipelineOwnerMap.has(key)) {
        byPipelineOwnerMap.set(key, {
          owner,
          owner_id,
          count: 0,
          total_mrr: 0,
          total_one_off: 0,
          won_count: 0,
          lost_count: 0,
          _age_sum: 0,
          _age_count: 0,
        });
      }
      const cur = byPipelineOwnerMap.get(key);
      cur.count += 1;
      cur.total_mrr += Number(row.mrr_value || 0);
      cur.total_one_off += Number(row.one_off_value || 0);
      if (String(row.opportunity_stage || '').toLowerCase() === 'won') cur.won_count += 1;
      if (String(row.opportunity_stage || '').toLowerCase() === 'lost') cur.lost_count += 1;
      const age = opportunityAgeDays(opportunityStageTimestamp(row));
      if (age != null) {
        cur._age_sum += age;
        cur._age_count += 1;
      }
    }
    const byPipelineOwner = Array.from(byPipelineOwnerMap.values())
      .map((row) => ({
        owner: row.owner,
        owner_id: row.owner_id,
        count: row.count,
        total_mrr: row.total_mrr,
        total_one_off: row.total_one_off,
        won_count: row.won_count,
        lost_count: row.lost_count,
        avg_age_days: row._age_count ? (row._age_sum / row._age_count) : null,
      }))
      .sort((a, b) => b.total_mrr - a.total_mrr || b.total_one_off - a.total_one_off || a.owner.localeCompare(b.owner));

    const pipelineLossReasonMap = new Map();
    for (const row of opportunityRows) {
      if (String(row.opportunity_stage || '').toLowerCase() !== 'lost') continue;
      const reason = String(row.loss_reason || '').trim() || 'Unknown';
      if (!pipelineLossReasonMap.has(reason)) {
        pipelineLossReasonMap.set(reason, { reason, count: 0, total_value: 0 });
      }
      const cur = pipelineLossReasonMap.get(reason);
      cur.count += 1;
      cur.total_value += Number(row.mrr_value || 0) + Number(row.one_off_value || 0);
    }
    const pipelineLossReasons = Array.from(pipelineLossReasonMap.values())
      .sort((a, b) => b.count - a.count || b.total_value - a.total_value || a.reason.localeCompare(b.reason));

    // Cumulative stage-reached counts (a lead that reached a later stage also reached earlier ones).
    const stageReached = opportunityRows.reduce((acc, row) => {
      if (row.qualified_at || row.opportunity_stage) acc.qualified += 1;
      if (row.meeting_booked_at) acc.meeting_booked += 1;
      if (row.meeting_no_show_at) acc.meeting_no_show += 1;
      if (row.meeting_attended_at) acc.meeting_attended += 1;
      if (row.scoping_at) acc.scoping += 1;
      if (row.proposal_at) acc.proposal += 1;
      if (row.won_at) acc.won += 1;
      if (row.lost_at) acc.lost += 1;
      return acc;
    }, { qualified: 0, meeting_booked: 0, meeting_no_show: 0, meeting_attended: 0, scoping: 0, proposal: 0, won: 0, lost: 0 });

    const performanceBySource = (() => {
      const cohorts = {
        apollo: {
          key: 'apollo',
          label: 'Apollo calls',
          opportunities: 0,
          meetingsBooked: 0,
          meetingsAttended: 0,
          won: 0,
        },
        manualCold: {
          key: 'manualCold',
          label: 'Manual entries / cold calls',
          opportunities: 0,
          meetingsBooked: 0,
          meetingsAttended: 0,
          won: 0,
        },
      };

      for (const row of opportunityRows) {
        const origin = String(row.opportunity_origin || '').toLowerCase();
        const bucket = (origin === 'manual_opportunity' || origin === 'manual_activity')
          ? cohorts.manualCold
          : cohorts.apollo;
        bucket.opportunities += 1;
        if (row.meeting_booked_at) bucket.meetingsBooked += 1;
        if (row.meeting_attended_at) bucket.meetingsAttended += 1;
        if (row.won_at) bucket.won += 1;
      }

      return Object.values(cohorts).map((row) => ({
        ...row,
        bookedRate: pct(row.meetingsBooked, row.opportunities),
        attendedFromBookedRate: pct(row.meetingsAttended, row.meetingsBooked),
        wonFromAttendedRate: pct(row.won, row.meetingsAttended),
        wonRate: pct(row.won, row.opportunities),
      }));
    })();

    return res.status(200).json({
      success: true,
      filters: { from, to, ownerId, source: srcMode, timeZone: BUSINESS_TIME_ZONE },
      summary,
      daily: mergedDayRows.map((r) => ({
        date: r.d,
        calls: r.calls,
        answered: r.answered,
        answeredInterested: r.answered_interested,
        qualified: r.qualified,
        qualificationEvents: r.qualification_events,
        meetingsBooked: r.meetings_booked,
        meetingsAttended: r.meetings_attended,
      })),
      hourly: mergedHourRows.map((r) => ({
        hour: r.hour_label,
        calls: r.calls,
        answered: r.answered,
        answeredInterested: r.answered_interested,
        qualified: r.qualified,
        qualificationEvents: r.qualification_events,
        meetingsBooked: r.meetings_booked,
        meetingsAttended: r.meetings_attended,
      })),
      ownerDaily: mergedOwnerDayRows.map((r) => ({
        date: r.d,
        owner: r.owner,
        ownerId: r.owner_id,
        calls: r.calls,
      })),
      ownerHourly: mergedOwnerHourRows.map((r) => ({
        hour: r.hour_label,
        owner: r.owner,
        ownerId: r.owner_id,
        calls: r.calls,
      })),
      byOwner: Array.from(ownerMap.values()).sort((a, b) => b.calls - a.calls || b.qualified - a.qualified || a.owner.localeCompare(b.owner)),
      availability: {
        workdayHours: REPORT_WORKDAY_HOURS,
        workdaysInRange: rangeWorkdays,
        dailyCallTarget,
      },
      bySector,
      bySectorRevenueBand,
      bySectorEmployeeBand,
      bySubSector,
      callbackQueue: callbackQueueRows.map((r) => ({
        owner: r.owner,
        ownerId: r.owner_id,
        sector: r.sector,
        subSector: r.sub_sector,
        totalCallbacks: r.total_callbacks,
        overdue: r.overdue,
        dueToday: r.due_today,
        due1To3Days: r.due_1_3_days,
        due4To7Days: r.due_4_7_days,
        dueLater: r.due_later,
        nextDueAt: r.next_due_at,
      })),
      pipeline: {
        summary: pipelineSummary,
        byStage: byPipelineStage,
        byOwner: byPipelineOwner,
        lossReasons: pipelineLossReasons,
        stageReached,
        performanceBySource,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
