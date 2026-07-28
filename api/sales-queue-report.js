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

function employeeBucketExpr() {
  return `
    CASE
      WHEN company_employees IS NULL THEN 'Unknown'
      WHEN company_employees <= 10 THEN '1-10'
      WHEN company_employees <= 25 THEN '11-25'
      WHEN company_employees <= 50 THEN '26-50'
      WHEN company_employees <= 100 THEN '51-100'
      WHEN company_employees <= 250 THEN '101-250'
      WHEN company_employees <= 500 THEN '251-500'
      WHEN company_employees <= 1000 THEN '501-1000'
      ELSE '1000+'
    END
  `;
}

function revenueBucketExpr() {
  return `
    CASE
      WHEN company_revenue IS NULL THEN 'Unknown'
      WHEN NULLIF(REGEXP_REPLACE(company_revenue, '[^0-9]', '', 'g'), '')::bigint <= 300000 THEN '0-300k'
      WHEN NULLIF(REGEXP_REPLACE(company_revenue, '[^0-9]', '', 'g'), '')::bigint <= 1000000 THEN '300k-1m'
      WHEN NULLIF(REGEXP_REPLACE(company_revenue, '[^0-9]', '', 'g'), '')::bigint <= 2000000 THEN '1m-2m'
      WHEN NULLIF(REGEXP_REPLACE(company_revenue, '[^0-9]', '', 'g'), '')::bigint <= 5000000 THEN '2m-5m'
      ELSE '5m+'
    END
  `;
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

    const sectorRows = await sql`
      SELECT
        COALESCE(NULLIF(TRIM(sector), ''), 'Unknown') AS sector,
        COALESCE(NULLIF(TRIM(sub_sector), ''), 'Unknown') AS sub_sector,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('to_call_back','wants_more_info','no_answer','qualified','converted'))::int AS worked,
        COUNT(*) FILTER (WHERE status IN ('qualified','converted'))::int AS qualified,
        COUNT(*) FILTER (WHERE status = 'converted')::int AS converted,
        COUNT(*) FILTER (WHERE status = 'to_call_back')::int AS to_call_back,
        COUNT(*) FILTER (WHERE status = 'wants_more_info')::int AS wants_more_info,
        COUNT(*) FILTER (WHERE status = 'no_answer')::int AS no_answer,
        COUNT(*) FILTER (WHERE status = 'not_interested')::int AS not_interested
      FROM queue_leads
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
      GROUP BY 1, 2
      ORDER BY 1, total DESC, 2
    `;

    const sectorMap = new Map();
    const sectorBenchmarks = [];
    for (const row of sectorRows) {
      const sectorKey = row.sector;
      if (!sectorMap.has(sectorKey)) {
        sectorMap.set(sectorKey, {
          sector: sectorKey,
          total: 0,
          worked: 0,
          qualified: 0,
          converted: 0,
          toCallBack: 0,
          wantsMoreInfo: 0,
          noAnswer: 0,
          notInterested: 0,
        });
      }
      mergeCounts(sectorMap.get(sectorKey), row);
      sectorBenchmarks.push(withRates(row));
    }

    const bySector = Array.from(sectorMap.values())
      .map((row) => withRates(row))
      .sort((a, b) => b.total - a.total || a.sector.localeCompare(b.sector));

    const bySubSector = sectorBenchmarks
      .map((row) => ({
        sector: row.sector,
        subSector: row.sub_sector,
        total: row.total,
        worked: row.worked,
        qualified: row.qualified,
        converted: row.converted,
        toCallBack: row.to_call_back,
        wantsMoreInfo: row.wants_more_info,
        noAnswer: row.no_answer,
        notInterested: row.not_interested,
        workedRate: row.workedRate,
        qualificationRate: row.qualificationRate,
        conversionRate: row.conversionRate,
        closeRate: row.closeRate,
      }))
      .sort((a, b) => b.total - a.total || a.sector.localeCompare(b.sector) || a.subSector.localeCompare(b.subSector));

    const sectorEmployeeRows = await sql`
      SELECT
        COALESCE(NULLIF(TRIM(sector), ''), 'Unknown') AS sector,
        ${sql.unsafe(employeeBucketExpr())} AS bucket,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('to_call_back','wants_more_info','no_answer','qualified','converted'))::int AS worked,
        COUNT(*) FILTER (WHERE status IN ('qualified','converted'))::int AS qualified,
        COUNT(*) FILTER (WHERE status = 'converted')::int AS converted
      FROM queue_leads
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
      GROUP BY 1, 2
      ORDER BY 1, total DESC, 2
    `;

    const sectorRevenueRows = await sql`
      SELECT
        COALESCE(NULLIF(TRIM(sector), ''), 'Unknown') AS sector,
        ${sql.unsafe(revenueBucketExpr())} AS bucket,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('to_call_back','wants_more_info','no_answer','qualified','converted'))::int AS worked,
        COUNT(*) FILTER (WHERE status IN ('qualified','converted'))::int AS qualified,
        COUNT(*) FILTER (WHERE status = 'converted')::int AS converted
      FROM queue_leads
      WHERE created_at BETWEEN ${from}::timestamptz AND ${to}::timestamptz
      AND (${ownerId}::text IS NULL OR owner_id = ${ownerId})
      GROUP BY 1, 2
      ORDER BY 1, total DESC, 2
    `;

    const bySectorEmployee = sectorEmployeeRows.map((row) => ({
      sector: row.sector,
      employeeBucket: row.bucket,
      total: row.total,
      worked: row.worked,
      qualified: row.qualified,
      converted: row.converted,
      workedRate: pct(row.worked, row.total),
      qualificationRate: pct(row.qualified, row.total),
      conversionRate: pct(row.converted, row.total),
      closeRate: pct(row.converted, row.qualified),
    }));

    const bySectorRevenue = sectorRevenueRows.map((row) => ({
      sector: row.sector,
      revenueBucket: row.bucket,
      total: row.total,
      worked: row.worked,
      qualified: row.qualified,
      converted: row.converted,
      workedRate: pct(row.worked, row.total),
      qualificationRate: pct(row.qualified, row.total),
      conversionRate: pct(row.converted, row.total),
      closeRate: pct(row.converted, row.qualified),
    }));

    const sectorLeaders = [...bySector]
      .filter((row) => row.total >= 5)
      .sort((a, b) => b.conversionRate - a.conversionRate || b.qualificationRate - a.qualificationRate || b.total - a.total)
      .slice(0, 5);

    const subSectorLeaders = [...bySubSector]
      .filter((row) => row.total >= 5)
      .sort((a, b) => b.conversionRate - a.conversionRate || b.qualificationRate - a.qualificationRate || b.total - a.total)
      .slice(0, 10);

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
        worked: statusRows.reduce((sum, row) => sum + ((row.to_status === 'to_call_back' || row.to_status === 'wants_more_info' || row.to_status === 'no_answer' || row.to_status === 'qualified' || row.to_status === 'converted') ? row.c : 0), 0),
        toCallBack: statusMap.to_call_back || 0,
        wantsMoreInfo: statusMap.wants_more_info || 0,
        noAnswer: statusMap.no_answer || 0,
        qualified: statusMap.qualified || 0,
        converted: statusMap.converted || 0,
        notInterested: statusMap.not_interested || 0,
        workedRate: pct(
          (statusMap.to_call_back || 0) + (statusMap.wants_more_info || 0) + (statusMap.no_answer || 0) + (statusMap.qualified || 0) + (statusMap.converted || 0),
          createdRows[0]?.c || 0
        ),
        qualificationRate: pct((statusMap.qualified || 0) + (statusMap.converted || 0), createdRows[0]?.c || 0),
        conversionRate: pct(statusMap.converted || 0, createdRows[0]?.c || 0),
        closeRate: pct(statusMap.converted || 0, (statusMap.qualified || 0) + (statusMap.converted || 0)),
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
      bySector,
      bySubSector,
      bySectorEmployee,
      bySectorRevenue,
      sectorLeaders,
      subSectorLeaders,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
