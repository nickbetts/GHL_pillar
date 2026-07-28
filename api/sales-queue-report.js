import { getSql } from './db.js';
import { checkAuth } from './auth.js';

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

export default async function handler(req, res) {
  if (!checkAuth(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
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

    const fallback = defaultRange(30);
    const from = startOfDayIso(req.query?.from) || fallback.from;
    const to = endOfDayIso(req.query?.to) || fallback.to;
    const ownerId = req.query?.ownerId || null;

    const createdRows = await sql`
      SELECT COUNT(*)::int AS c
      FROM queue_leads
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
    `;

    const touchesRows = await sql`
      SELECT COUNT(*)::int AS c
      FROM queue_events
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND event_type IN ('status_change', 'note', 'disposition', 'reassign')
      AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
    `;

    const statusRows = await sql`
      SELECT to_status, COUNT(*)::int AS c
      FROM queue_events
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND event_type = 'status_change'
      AND to_status IS NOT NULL
      AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
      GROUP BY to_status
    `;

    const dayRows = await sql`
      SELECT
        DATE(created_at) AS d,
        COUNT(*)::int AS touches,
        COUNT(*) FILTER (WHERE event_type = 'status_change' AND to_status IN ('to_call_back','wants_more_info','no_answer'))::int AS worked,
        COUNT(*) FILTER (WHERE event_type = 'status_change' AND to_status = 'qualified')::int AS qualified,
        COUNT(*) FILTER (WHERE event_type = 'status_change' AND to_status = 'converted')::int AS converted
      FROM queue_events
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at)
    `;

    const ownerRows = await sql`
      SELECT
        COALESCE(owner_name, 'Unknown') AS owner,
        COALESCE(owner_id, '') AS owner_id,
        COUNT(*) FILTER (WHERE event_type = 'status_change' AND to_status IN ('to_call_back','wants_more_info','no_answer'))::int AS worked,
        COUNT(*) FILTER (WHERE event_type = 'status_change' AND to_status = 'qualified')::int AS qualified,
        COUNT(*) FILTER (WHERE event_type = 'status_change' AND to_status = 'converted')::int AS converted,
        COUNT(*) FILTER (WHERE event_type = 'reassign')::int AS reassigned,
        COUNT(*)::int AS total_events
      FROM queue_events
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      GROUP BY COALESCE(owner_name, 'Unknown'), COALESCE(owner_id, '')
      ORDER BY total_events DESC, owner ASC
    `;

    const currentPipelineRows = await sql`
      SELECT
        status,
        COUNT(*)::int AS c
      FROM queue_leads
      WHERE (${ownerId}::text IS NULL OR owner_id = ${ownerId})
      GROUP BY status
      ORDER BY status
    `;

    const statusMap = Object.fromEntries(statusRows.map((r) => [r.to_status, r.c]));
    const pipelineMap = Object.fromEntries(currentPipelineRows.map((r) => [r.status, r.c]));

    return res.status(200).json({
      success: true,
      filters: { from, to, ownerId },
      summary: {
        leadsCreated: createdRows[0]?.c || 0,
        touches: touchesRows[0]?.c || 0,
        toCallBack: statusMap.to_call_back || 0,
        wantsMoreInfo: statusMap.wants_more_info || 0,
        noAnswer: statusMap.no_answer || 0,
        qualified: statusMap.qualified || 0,
        converted: statusMap.converted || 0,
        notInterested: statusMap.not_interested || 0,
      },
      pipelineSnapshot: {
        toContact: pipelineMap.to_contact || 0,
        toCallBack: pipelineMap.to_call_back || 0,
        wantsMoreInfo: pipelineMap.wants_more_info || 0,
        noAnswer: pipelineMap.no_answer || 0,
        qualified: pipelineMap.qualified || 0,
        converted: pipelineMap.converted || 0,
        notInterested: pipelineMap.not_interested || 0,
      },
      daily: dayRows.map((r) => ({
        date: r.d,
        touches: r.touches,
        worked: r.worked,
        qualified: r.qualified,
        converted: r.converted,
      })),
      byOwner: ownerRows.map((r) => ({
        owner: r.owner,
        ownerId: r.owner_id,
        worked: r.worked,
        qualified: r.qualified,
        converted: r.converted,
        reassigned: r.reassigned,
        totalEvents: r.total_events,
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
