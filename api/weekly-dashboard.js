import { getSql } from './db.js';
import { resolveIdentity, hasMinRole } from './session.js';
import { londonDateKey, londonMidnight, BUSINESS_TIME_ZONE } from './business-time.js';

const REP_DIRECTORY = [
  { id: '6FX5X4kH2JFJc6u9zhSC', name: 'Brendon Mwatsenekenyi' },
  { id: 'XbyxbOK1Q1raRCjjGx4O', name: 'Zain Safir-Sheikh' },
  { id: 's7OG2BM94q7uNRsHLqM7', name: 'Amir Ward' },
];

const SCORE_WEIGHTS = {
  dealsClosed: 100,
  meetingsAttended: 40,
  meetingsBooked: 25,
  qualifiedContacts: 15,
  calls: 1,
};

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function mondayDateKey(dateKey) {
  const base = new Date(`${dateKey}T00:00:00Z`);
  const mondayOffset = (base.getUTCDay() + 6) % 7;
  return new Date(base.getTime() - (mondayOffset * 86400000)).toISOString().slice(0, 10);
}

function parseWindow(query = {}) {
  const fromParam = String(query.from || '').trim();
  const toParam = String(query.to || '').trim();
  if (isDateKey(fromParam) && isDateKey(toParam)) {
    const from = londonMidnight(fromParam);
    const toExclusive = londonMidnight(toParam, 1);
    if (from && toExclusive) {
      return {
        fromDateKey: fromParam,
        toDateKey: toParam,
        fromIso: from.toISOString(),
        toIso: new Date(toExclusive.getTime() - 1).toISOString(),
        mode: 'custom_range',
      };
    }
  }

  const todayKey = londonDateKey(new Date());
  const weekStartKey = mondayDateKey(todayKey);
  const weekStart = londonMidnight(weekStartKey);
  return {
    fromDateKey: weekStartKey,
    toDateKey: todayKey,
    fromIso: weekStart ? weekStart.toISOString() : new Date().toISOString(),
    toIso: new Date().toISOString(),
    mode: 'current_week_to_now',
  };
}

function scoreFor(metrics) {
  return (metrics.dealsClosed * SCORE_WEIGHTS.dealsClosed)
    + (metrics.meetingsAttended * SCORE_WEIGHTS.meetingsAttended)
    + (metrics.meetingsBooked * SCORE_WEIGHTS.meetingsBooked)
    + (metrics.qualifiedContacts * SCORE_WEIGHTS.qualifiedContacts)
    + (metrics.calls * SCORE_WEIGHTS.calls);
}

function normalizeOwnerId(value) {
  return String(value || '').trim();
}

function normalizeOwnerName(value, fallback = 'Unassigned') {
  const name = String(value || '').trim();
  return name || fallback;
}

export default async function handler(req, res) {
  const identity = resolveIdentity(req);
  if (!identity) return res.status(401).json({ success: false, error: 'Not signed in' });
  if (!hasMinRole(identity, 'rep')) {
    return res.status(403).json({ success: false, error: 'You do not have access to weekly dashboard metrics' });
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
    const window = parseWindow(req.query || {});
    const ownerIdFilter = normalizeOwnerId(req.query?.ownerId || '');
    const filterOwner = ownerIdFilter || null;

    const callRows = await sql`
      SELECT
        COALESCE(NULLIF(TRIM(e.owner_id), ''), NULLIF(TRIM(l.owner_id), ''), '') AS owner_id,
        COALESCE(NULLIF(TRIM(e.owner_name), ''), NULLIF(TRIM(l.owner), ''), 'Unassigned') AS owner_name,
        COUNT(*)::int AS calls
      FROM queue_events e
      LEFT JOIN queue_leads l ON l.id = e.lead_id
      WHERE e.event_type = 'call'
        AND e.created_at >= ${window.fromIso}::timestamptz
        AND e.created_at <= ${window.toIso}::timestamptz
        AND (${filterOwner}::text IS NULL OR COALESCE(NULLIF(TRIM(e.owner_id), ''), NULLIF(TRIM(l.owner_id), ''), '') = ${filterOwner})
      GROUP BY 1, 2
    `;

    const qualifiedRows = await sql`
      SELECT
        COALESCE(NULLIF(TRIM(e.owner_id), ''), NULLIF(TRIM(l.owner_id), ''), '') AS owner_id,
        COALESCE(NULLIF(TRIM(e.owner_name), ''), NULLIF(TRIM(l.owner), ''), 'Unassigned') AS owner_name,
        COUNT(DISTINCT e.lead_id)::int AS qualified_contacts
      FROM queue_events e
      LEFT JOIN queue_leads l ON l.id = e.lead_id
      WHERE e.event_type = 'status_change'
        AND LOWER(COALESCE(e.to_status, '')) = 'qualified'
        AND e.created_at >= ${window.fromIso}::timestamptz
        AND e.created_at <= ${window.toIso}::timestamptz
        AND (${filterOwner}::text IS NULL OR COALESCE(NULLIF(TRIM(e.owner_id), ''), NULLIF(TRIM(l.owner_id), ''), '') = ${filterOwner})
      GROUP BY 1, 2
    `;

    const opportunityRows = await sql`
      SELECT
        COALESCE(NULLIF(TRIM(owner_id), ''), '') AS owner_id,
        COALESCE(NULLIF(TRIM(owner), ''), 'Unassigned') AS owner_name,
        COUNT(*) FILTER (
          WHERE meeting_booked_at IS NOT NULL
            AND meeting_booked_at >= ${window.fromIso}::timestamptz
            AND meeting_booked_at <= ${window.toIso}::timestamptz
        )::int AS meetings_booked,
        COUNT(*) FILTER (
          WHERE meeting_attended_at IS NOT NULL
            AND meeting_attended_at >= ${window.fromIso}::timestamptz
            AND meeting_attended_at <= ${window.toIso}::timestamptz
        )::int AS meetings_attended,
        COUNT(*) FILTER (
          WHERE won_at IS NOT NULL
            AND won_at >= ${window.fromIso}::timestamptz
            AND won_at <= ${window.toIso}::timestamptz
        )::int AS deals_closed
      FROM queue_leads
      WHERE archived_at IS NULL
        AND (${filterOwner}::text IS NULL OR COALESCE(NULLIF(TRIM(owner_id), ''), '') = ${filterOwner})
      GROUP BY 1, 2
    `;

    const board = new Map();
    const ensureRep = (ownerId, ownerName) => {
      const key = normalizeOwnerId(ownerId);
      if (!board.has(key)) {
        board.set(key, {
          ownerId: key,
          owner: normalizeOwnerName(ownerName),
          calls: 0,
          qualifiedContacts: 0,
          meetingsBooked: 0,
          meetingsAttended: 0,
          dealsClosed: 0,
          score: 0,
          rank: 0,
        });
      }
      return board.get(key);
    };

    const repSeed = REP_DIRECTORY
      .filter((rep) => !filterOwner || rep.id === filterOwner)
      .forEach((rep) => ensureRep(rep.id, rep.name));
    void repSeed;

    for (const row of callRows) {
      const rep = ensureRep(row.owner_id, row.owner_name);
      rep.calls += Number(row.calls || 0);
    }

    for (const row of qualifiedRows) {
      const rep = ensureRep(row.owner_id, row.owner_name);
      rep.qualifiedContacts += Number(row.qualified_contacts || 0);
    }

    for (const row of opportunityRows) {
      const rep = ensureRep(row.owner_id, row.owner_name);
      rep.meetingsBooked += Number(row.meetings_booked || 0);
      rep.meetingsAttended += Number(row.meetings_attended || 0);
      rep.dealsClosed += Number(row.deals_closed || 0);
    }

    const reps = Array.from(board.values())
      .map((rep) => ({
        ...rep,
        score: scoreFor(rep),
      }))
      .sort((a, b) => (
        b.score - a.score
        || b.dealsClosed - a.dealsClosed
        || b.meetingsAttended - a.meetingsAttended
        || b.meetingsBooked - a.meetingsBooked
        || b.qualifiedContacts - a.qualifiedContacts
        || b.calls - a.calls
        || a.owner.localeCompare(b.owner)
      ))
      .map((rep, idx) => ({ ...rep, rank: idx + 1 }));

    const totals = reps.reduce((acc, rep) => {
      acc.calls += rep.calls;
      acc.qualifiedContacts += rep.qualifiedContacts;
      acc.meetingsBooked += rep.meetingsBooked;
      acc.meetingsAttended += rep.meetingsAttended;
      acc.dealsClosed += rep.dealsClosed;
      return acc;
    }, {
      calls: 0,
      qualifiedContacts: 0,
      meetingsBooked: 0,
      meetingsAttended: 0,
      dealsClosed: 0,
    });

    return res.status(200).json({
      success: true,
      filters: {
        ownerId: filterOwner,
        from: window.fromDateKey,
        to: window.toDateKey,
        mode: window.mode,
        timeZone: BUSINESS_TIME_ZONE,
      },
      scoreWeights: SCORE_WEIGHTS,
      totals,
      reps,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
