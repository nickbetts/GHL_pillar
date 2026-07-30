import { getSql } from './db.js';
import { resolveIdentity, hasMinRole } from './session.js';

async function ensureEventsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS queue_events (
      id              BIGSERIAL PRIMARY KEY,
      lead_id         BIGINT NOT NULL REFERENCES queue_leads(id) ON DELETE CASCADE,
      event_type      TEXT NOT NULL,
      from_status     TEXT,
      to_status       TEXT,
      owner_id        TEXT,
      owner_name      TEXT,
      meta            JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS queue_events_created_idx ON queue_events (created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_events_lead_idx ON queue_events (lead_id)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_events_type_idx ON queue_events (event_type)`;
}

async function ensureLeadColumns(sql) {
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS sector TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS sub_sector TEXT`;
}

function startOfDayIso(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfDayIso(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function defaultRange(days = 30) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - days + 1);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

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

export default async function handler(req, res) {
  const identity = resolveIdentity(req);
  if (!identity) {
    return res.status(401).json({ success: false, error: 'Not signed in' });
  }
  if (!hasMinRole(identity, 'manager')) {
    return res.status(403).json({ success: false, error: 'Reports are available to managers and admins' });
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
    await ensureLeadColumns(sql);

    const fallback = defaultRange(30);
    const from = startOfDayIso(req.query?.from) || fallback.from;
    const to = endOfDayIso(req.query?.to) || fallback.to;
    const ownerId = req.query?.ownerId || null;
    const srcMode = (req.query?.source === 'inbound') ? 'inbound' : 'outbound';

    const dayRows = await sql`
      SELECT
        DATE(qe.created_at) AS d,
        COUNT(*) FILTER (WHERE qe.event_type = 'call')::int AS calls,
        COUNT(*) FILTER (WHERE qe.event_type = 'call' AND ((qe.meta->>'outcome') ILIKE 'Answered%' OR COALESCE(NULLIF(qe.meta->>'durationSec','')::int, 0) > 0))::int AS answered,
        COUNT(*) FILTER (WHERE qe.event_type = 'status_change' AND qe.to_status = 'qualified')::int AS qualified
      FROM queue_events qe
      JOIN queue_leads ql ON ql.id = qe.lead_id
      WHERE qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
      GROUP BY DATE(qe.created_at)
      ORDER BY DATE(qe.created_at)
    `;

    const callTotalRows = await sql`
      SELECT
        COUNT(*)::int AS calls,
        COUNT(*) FILTER (WHERE (qe.meta->>'outcome') ILIKE 'Answered%' OR COALESCE(NULLIF(qe.meta->>'durationSec','')::int, 0) > 0)::int AS answered,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'Answered - not interested')::int AS answered_not_interested,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'Answered - wants info')::int AS wants_more_info,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'No answer')::int AS no_answer,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'Left voicemail')::int AS left_voicemail,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'Gatekeeper')::int AS gatekeeper,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'Wrong number')::int AS wrong_number
      FROM queue_events qe
      JOIN queue_leads ql ON ql.id = qe.lead_id
      WHERE qe.event_type = 'call'
      AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
    `;

    const qualifiedRows = await sql`
      SELECT
        COUNT(*)::int AS qualified
      FROM queue_events qe
      JOIN queue_leads ql ON ql.id = qe.lead_id
      WHERE qe.event_type = 'status_change'
      AND qe.to_status = 'qualified'
      AND qe.created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR qe.owner_id = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
    `;

    const callbacksRows = await sql`
      SELECT COUNT(*)::int AS callbacks_scheduled
      FROM queue_leads ql
      WHERE ql.callback_at IS NOT NULL
      AND ql.callback_at >= now()
      AND (${ownerId}::text IS NULL OR ql.owner_id = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
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
        COUNT(*) FILTER (WHERE (qe.meta->>'outcome') ILIKE 'Answered%' OR COALESCE(NULLIF(qe.meta->>'durationSec','')::int, 0) > 0)::int AS answered,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'Answered - not interested')::int AS answered_not_interested,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'Answered - wants info')::int AS wants_more_info,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'No answer')::int AS no_answer,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'Left voicemail')::int AS left_voicemail,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'Gatekeeper')::int AS gatekeeper,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'Wrong number')::int AS wrong_number
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

    const ownerCallbackRows = await sql`
      SELECT
        COALESCE(ql.owner, 'Unknown') AS owner,
        COALESCE(ql.owner_id, '') AS owner_id,
        COUNT(*)::int AS callbacks_scheduled
      FROM queue_leads ql
      WHERE ql.callback_at IS NOT NULL
      AND ql.callback_at >= now()
      AND (${ownerId}::text IS NULL OR ql.owner_id = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
      GROUP BY 1,2
    `;

    const subSectorCallRows = await sql`
      SELECT
        COALESCE(NULLIF(TRIM(ql.sector), ''), 'Unknown') AS sector,
        COALESCE(NULLIF(TRIM(ql.sub_sector), ''), 'Unknown') AS sub_sector,
        COUNT(*)::int AS calls,
        COUNT(*) FILTER (WHERE (qe.meta->>'outcome') ILIKE 'Answered%' OR COALESCE(NULLIF(qe.meta->>'durationSec','')::int, 0) > 0)::int AS answered,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'Answered - not interested')::int AS answered_not_interested,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'Answered - wants info')::int AS wants_more_info,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'No answer')::int AS no_answer,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'Left voicemail')::int AS left_voicemail,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'Gatekeeper')::int AS gatekeeper,
        COUNT(*) FILTER (WHERE qe.meta->>'outcome' = 'Wrong number')::int AS wrong_number
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

    const subSectorCallbackRows = await sql`
      SELECT
        COALESCE(NULLIF(TRIM(ql.sector), ''), 'Unknown') AS sector,
        COALESCE(NULLIF(TRIM(ql.sub_sector), ''), 'Unknown') AS sub_sector,
        COUNT(*)::int AS callbacks_scheduled
      FROM queue_leads ql
      WHERE ql.callback_at IS NOT NULL
      AND ql.callback_at >= now()
      AND (${ownerId}::text IS NULL OR ql.owner_id = ${ownerId})
      AND ((${srcMode}::text='outbound' AND ql.source IS DISTINCT FROM 'inbound') OR (${srcMode}::text='inbound' AND ql.source='inbound'))
      GROUP BY 1,2
    `;

    const ownerMap = new Map();
    const ownerKey = (owner, ownerIdValue) => `${owner || 'Unknown'}||${ownerIdValue || ''}`;
    const ensureOwner = (owner, ownerIdValue) => {
      const k = ownerKey(owner, ownerIdValue);
      if (!ownerMap.has(k)) {
        ownerMap.set(k, {
          owner: owner || 'Unknown',
          ownerId: ownerIdValue || '',
          calls: 0,
          answered: 0,
          qualified: 0,
          answeredNotInterested: 0,
          wantsMoreInfo: 0,
          noAnswer: 0,
          leftVoicemail: 0,
          gatekeeper: 0,
          wrongNumber: 0,
          callbacksScheduled: 0,
        });
      }
      return ownerMap.get(k);
    };

    for (const row of ownerCallRows) ensureOwner(row.owner, row.owner_id).calls = row.c || 0;
    for (const row of ownerOutcomeRows) {
      const cur = ensureOwner(row.owner, row.owner_id);
      cur.answered = row.answered || 0;
      cur.answeredNotInterested = row.answered_not_interested || 0;
      cur.wantsMoreInfo = row.wants_more_info || 0;
      cur.noAnswer = row.no_answer || 0;
      cur.leftVoicemail = row.left_voicemail || 0;
      cur.gatekeeper = row.gatekeeper || 0;
      cur.wrongNumber = row.wrong_number || 0;
    }
    for (const row of ownerQualifiedRows) ensureOwner(row.owner, row.owner_id).qualified = row.qualified || 0;
    for (const row of ownerCallbackRows) ensureOwner(row.owner, row.owner_id).callbacksScheduled = row.callbacks_scheduled || 0;

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
          qualified: 0,
          answeredNotInterested: 0,
          wantsMoreInfo: 0,
          noAnswer: 0,
          leftVoicemail: 0,
          gatekeeper: 0,
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
      cur.answeredNotInterested = row.answered_not_interested || 0;
      cur.wantsMoreInfo = row.wants_more_info || 0;
      cur.noAnswer = row.no_answer || 0;
      cur.leftVoicemail = row.left_voicemail || 0;
      cur.gatekeeper = row.gatekeeper || 0;
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
          qualified: 0,
          answeredNotInterested: 0,
          wantsMoreInfo: 0,
          noAnswer: 0,
          leftVoicemail: 0,
          gatekeeper: 0,
          wrongNumber: 0,
          callbacksScheduled: 0,
        });
      }
      const cur = sectorMap.get(k);
      cur.calls += row.calls || 0;
      cur.answered += row.answered || 0;
      cur.qualified += row.qualified || 0;
      cur.answeredNotInterested += row.answeredNotInterested || 0;
      cur.wantsMoreInfo += row.wantsMoreInfo || 0;
      cur.noAnswer += row.noAnswer || 0;
      cur.leftVoicemail += row.leftVoicemail || 0;
      cur.gatekeeper += row.gatekeeper || 0;
      cur.wrongNumber += row.wrongNumber || 0;
      cur.callbacksScheduled += row.callbacksScheduled || 0;
    }
    const bySector = Array.from(sectorMap.values()).sort((a, b) => b.calls - a.calls || b.qualified - a.qualified || a.sector.localeCompare(b.sector));

    const callTotals = callTotalRows[0] || {};
    const summary = {
      calls: callTotals.calls || 0,
      answered: callTotals.answered || 0,
      qualified: qualifiedRows[0]?.qualified || 0,
      answeredNotInterested: callTotals.answered_not_interested || 0,
      wantsMoreInfo: callTotals.wants_more_info || 0,
      noAnswer: callTotals.no_answer || 0,
      leftVoicemail: callTotals.left_voicemail || 0,
      gatekeeper: callTotals.gatekeeper || 0,
      wrongNumber: callTotals.wrong_number || 0,
      callbacksScheduled: callbacksRows[0]?.callbacks_scheduled || 0,
    };

    return res.status(200).json({
      success: true,
      filters: { from, to, ownerId, source: srcMode },
      summary,
      daily: dayRows.map((r) => ({
        date: r.d,
        calls: r.calls,
        answered: r.answered,
        qualified: r.qualified,
      })),
      byOwner: Array.from(ownerMap.values()).sort((a, b) => b.calls - a.calls || b.qualified - a.qualified || a.owner.localeCompare(b.owner)),
      bySector,
      bySubSector,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
