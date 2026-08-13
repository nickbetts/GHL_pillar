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
  proposalsSent: 65,
  qualifiedContacts: 15,
  callsAnswered: 0.5,
};

function addDaysKey(dateKey, days) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function mondayDateKey(dateKey) {
  const base = new Date(`${dateKey}T00:00:00Z`);
  const mondayOffset = (base.getUTCDay() + 6) % 7;
  return new Date(base.getTime() - (mondayOffset * 86400000)).toISOString().slice(0, 10);
}

function parseWindow(query = {}) {
  const rawOffset = Number.parseInt(String(query.weekOffset ?? '0'), 10);
  const weekOffset = Number.isFinite(rawOffset) ? Math.max(-520, Math.min(0, rawOffset)) : 0;

  const todayKey = londonDateKey(new Date());
  const currentWeekStartKey = mondayDateKey(todayKey);
  const weekStartKey = addDaysKey(currentWeekStartKey, weekOffset * 7);
  const weekEndKey = addDaysKey(weekStartKey, 6);

  const weekStart = londonMidnight(weekStartKey);
  const weekEndExclusive = londonMidnight(weekEndKey, 1);
  const isCurrentWeek = weekOffset === 0;

  const nowIso = new Date().toISOString();
  const weekEndIso = weekEndExclusive
    ? new Date(weekEndExclusive.getTime() - 1).toISOString()
    : nowIso;

  return {
    weekOffset,
    isCurrentWeek,
    fromDateKey: weekStartKey,
    toDateKey: isCurrentWeek ? todayKey : weekEndKey,
    weekStartKey,
    weekEndKey,
    fromIso: weekStart ? weekStart.toISOString() : nowIso,
    toIso: isCurrentWeek ? nowIso : weekEndIso,
    mode: isCurrentWeek ? 'current_week_to_now' : 'past_week_full',
  };
}

function scoreFor(metrics) {
  return Math.round((metrics.dealsClosed * SCORE_WEIGHTS.dealsClosed)
    + (metrics.meetingsAttended * SCORE_WEIGHTS.meetingsAttended)
    + (metrics.meetingsBooked * SCORE_WEIGHTS.meetingsBooked)
    + (metrics.proposalsSent * SCORE_WEIGHTS.proposalsSent)
    + (metrics.qualifiedContacts * SCORE_WEIGHTS.qualifiedContacts)
    + (metrics.calls * SCORE_WEIGHTS.callsAnswered));
}

function normalizeOwnerId(value) {
  return String(value || '').trim();
}

function normalizeOwnerName(value, fallback = 'Unassigned') {
  const name = String(value || '').trim();
  return name || fallback;
}

function previousWeekWindow(window) {
  const weekStartKey = addDaysKey(window.weekStartKey, -7);
  const weekEndKey = addDaysKey(window.weekStartKey, -1);
  const weekStart = londonMidnight(weekStartKey);
  const weekEndExclusive = londonMidnight(window.weekStartKey);
  const weekEndIso = weekEndExclusive
    ? new Date(weekEndExclusive.getTime() - 1).toISOString()
    : new Date().toISOString();
  return {
    weekStartKey,
    weekEndKey,
    fromIso: weekStart ? weekStart.toISOString() : new Date().toISOString(),
    toIso: weekEndIso,
  };
}

async function fetchMetricRows(sql, window, filterOwner) {
  const callRows = await sql`
    SELECT
      COALESCE(NULLIF(TRIM(e.owner_id), ''), NULLIF(TRIM(l.owner_id), ''), '') AS owner_id,
      COALESCE(NULLIF(TRIM(e.owner_name), ''), NULLIF(TRIM(l.owner), ''), 'Unassigned') AS owner_name,
      COUNT(*) FILTER (
        WHERE (
          COALESCE(e.meta->>'outcome', '') IN ('Answered - interested', 'Answered - wants info')
          OR COALESCE(e.meta->>'actionKey', '') IN ('answered_interested', 'wants_info_callback', 'wants_info_email_only')
        )
      )::int AS calls
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

  const proposalRows = await sql`
    SELECT
      COALESCE(NULLIF(TRIM(l.owner_id), ''), '') AS owner_id,
      MAX(COALESCE(NULLIF(TRIM(l.owner), ''), 'Unassigned')) AS owner_name,
      COUNT(*)::int AS proposals_sent
    FROM queue_leads l
    WHERE l.archived_at IS NULL
      AND l.proposal_sent_at IS NOT NULL
      AND l.proposal_sent_at >= ${window.fromIso}::timestamptz
      AND l.proposal_sent_at <= ${window.toIso}::timestamptz
      AND (${filterOwner}::text IS NULL OR COALESCE(NULLIF(TRIM(l.owner_id), ''), '') = ${filterOwner})
    GROUP BY 1
  `;

  // Meetings are counted from the opportunity_meetings ledger (one row per
  // meeting) so multiple meetings on the same opportunity each count. Leads
  // marked booked/attended via a stage change without a ledger row (legacy /
  // drag-to-lane path) are added on so nothing is lost.
  const opportunityRows = await sql`
    WITH meeting_ledger AS (
      SELECT
        COALESCE(NULLIF(TRIM(m.primary_owner_id), ''), NULLIF(TRIM(l.owner_id), ''), '') AS owner_id,
        MAX(COALESCE(NULLIF(TRIM(m.primary_owner_name), ''), NULLIF(TRIM(l.owner), ''), 'Unassigned')) AS owner_name,
        COUNT(*) FILTER (
          WHERE m.booked_at IS NOT NULL
            AND m.booked_at >= ${window.fromIso}::timestamptz
            AND m.booked_at <= ${window.toIso}::timestamptz
        )::int AS meetings_booked,
        COUNT(*) FILTER (
          WHERE m.status = 'completed'
            AND COALESCE(m.occurred_at, m.scheduled_for) >= ${window.fromIso}::timestamptz
            AND COALESCE(m.occurred_at, m.scheduled_for) <= ${window.toIso}::timestamptz
        )::int AS meetings_attended
      FROM opportunity_meetings m
      LEFT JOIN queue_leads l ON l.id = m.lead_id
      WHERE l.archived_at IS NULL
      GROUP BY 1
    ),
    legacy_leads AS (
      SELECT
        COALESCE(NULLIF(TRIM(l.owner_id), ''), '') AS owner_id,
        MAX(COALESCE(NULLIF(TRIM(l.owner), ''), 'Unassigned')) AS owner_name,
        COUNT(*) FILTER (
          WHERE l.meeting_booked_at IS NOT NULL
            AND l.meeting_booked_at >= ${window.fromIso}::timestamptz
            AND l.meeting_booked_at <= ${window.toIso}::timestamptz
            AND NOT EXISTS (SELECT 1 FROM opportunity_meetings mm WHERE mm.lead_id = l.id)
        )::int AS meetings_booked,
        COUNT(*) FILTER (
          WHERE l.meeting_attended_at IS NOT NULL
            AND l.meeting_attended_at >= ${window.fromIso}::timestamptz
            AND l.meeting_attended_at <= ${window.toIso}::timestamptz
            AND NOT EXISTS (SELECT 1 FROM opportunity_meetings mm WHERE mm.lead_id = l.id AND mm.status = 'completed')
        )::int AS meetings_attended
      FROM queue_leads l
      WHERE l.archived_at IS NULL
      GROUP BY 1
    ),
    proposal_credit AS (
      SELECT
        COALESCE(NULLIF(TRIM(l.owner_id), ''), '') AS owner_id,
        MAX(COALESCE(NULLIF(TRIM(l.owner), ''), 'Unassigned')) AS owner_name,
        COUNT(*) FILTER (
          WHERE l.proposal_at IS NOT NULL
            AND l.proposal_at >= ${window.fromIso}::timestamptz
            AND l.proposal_at <= ${window.toIso}::timestamptz
            AND l.meeting_attended_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM opportunity_meetings mm WHERE mm.lead_id = l.id AND mm.status = 'completed')
        )::int AS meetings_attended
      FROM queue_leads l
      WHERE l.archived_at IS NULL
      GROUP BY 1
    ),
    deal_counts AS (
      SELECT
        COALESCE(NULLIF(TRIM(owner_id), ''), '') AS owner_id,
        MAX(COALESCE(NULLIF(TRIM(owner), ''), 'Unassigned')) AS owner_name,
        COUNT(*) FILTER (
          WHERE won_at IS NOT NULL
            AND won_at >= ${window.fromIso}::timestamptz
            AND won_at <= ${window.toIso}::timestamptz
        )::int AS deals_closed
      FROM queue_leads
      WHERE archived_at IS NULL
      GROUP BY 1
    )
    SELECT
      owner_id,
      MAX(owner_name) AS owner_name,
      SUM(meetings_booked)::int AS meetings_booked,
      SUM(meetings_attended)::int AS meetings_attended,
      SUM(deals_closed)::int AS deals_closed
    FROM (
      SELECT owner_id, owner_name, meetings_booked, meetings_attended, 0 AS deals_closed FROM meeting_ledger
      UNION ALL
      SELECT owner_id, owner_name, meetings_booked, meetings_attended, 0 AS deals_closed FROM legacy_leads
      UNION ALL
      SELECT owner_id, owner_name, 0 AS meetings_booked, meetings_attended, 0 AS deals_closed FROM proposal_credit
      UNION ALL
      SELECT owner_id, owner_name, 0 AS meetings_booked, 0 AS meetings_attended, deals_closed FROM deal_counts
    ) combined
    GROUP BY owner_id
    HAVING (${filterOwner}::text IS NULL OR owner_id = ${filterOwner})
  `;

  return { callRows, qualifiedRows, proposalRows, opportunityRows };
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
    const priorWindow = previousWeekWindow(window);
    const ownerIdFilter = normalizeOwnerId(req.query?.ownerId || '');
    const filterOwner = ownerIdFilter || null;
    const currentRows = await fetchMetricRows(sql, window, filterOwner);
    const previousRows = await fetchMetricRows(sql, priorWindow, filterOwner);

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
          proposalsSent: 0,
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

    for (const row of currentRows.callRows) {
      const rep = ensureRep(row.owner_id, row.owner_name);
      rep.calls += Number(row.calls || 0);
    }

    for (const row of currentRows.qualifiedRows) {
      const rep = ensureRep(row.owner_id, row.owner_name);
      rep.qualifiedContacts += Number(row.qualified_contacts || 0);
    }

    for (const row of currentRows.proposalRows) {
      const rep = ensureRep(row.owner_id, row.owner_name);
      rep.proposalsSent += Number(row.proposals_sent || 0);
    }

    for (const row of currentRows.opportunityRows) {
      const rep = ensureRep(row.owner_id, row.owner_name);
      rep.meetingsBooked += Number(row.meetings_booked || 0);
      rep.meetingsAttended += Number(row.meetings_attended || 0);
      rep.dealsClosed += Number(row.deals_closed || 0);
    }

    const previousBoard = new Map();
    const ensurePreviousRep = (ownerId, ownerName) => {
      const key = normalizeOwnerId(ownerId);
      if (!previousBoard.has(key)) {
        previousBoard.set(key, {
          ownerId: key,
          owner: normalizeOwnerName(ownerName),
          calls: 0,
          qualifiedContacts: 0,
          meetingsBooked: 0,
          meetingsAttended: 0,
          proposalsSent: 0,
          dealsClosed: 0,
        });
      }
      return previousBoard.get(key);
    };

    REP_DIRECTORY
      .filter((rep) => !filterOwner || rep.id === filterOwner)
      .forEach((rep) => ensurePreviousRep(rep.id, rep.name));

    for (const row of previousRows.callRows) {
      const rep = ensurePreviousRep(row.owner_id, row.owner_name);
      rep.calls += Number(row.calls || 0);
    }

    for (const row of previousRows.qualifiedRows) {
      const rep = ensurePreviousRep(row.owner_id, row.owner_name);
      rep.qualifiedContacts += Number(row.qualified_contacts || 0);
    }

    for (const row of previousRows.proposalRows) {
      const rep = ensurePreviousRep(row.owner_id, row.owner_name);
      rep.proposalsSent += Number(row.proposals_sent || 0);
    }

    for (const row of previousRows.opportunityRows) {
      const rep = ensurePreviousRep(row.owner_id, row.owner_name);
      rep.meetingsBooked += Number(row.meetings_booked || 0);
      rep.meetingsAttended += Number(row.meetings_attended || 0);
      rep.dealsClosed += Number(row.deals_closed || 0);
    }

    const reps = Array.from(board.values())
      .map((rep) => {
        const prev = previousBoard.get(rep.ownerId) || {
          calls: 0,
          qualifiedContacts: 0,
          meetingsBooked: 0,
          meetingsAttended: 0,
          proposalsSent: 0,
          dealsClosed: 0,
        };
        const score = scoreFor(rep);
        const previousScore = scoreFor(prev);
        return {
          ...rep,
          score,
          previous: {
            score: previousScore,
            calls: Number(prev.calls || 0),
            qualifiedContacts: Number(prev.qualifiedContacts || 0),
            meetingsBooked: Number(prev.meetingsBooked || 0),
            meetingsAttended: Number(prev.meetingsAttended || 0),
            proposalsSent: Number(prev.proposalsSent || 0),
            dealsClosed: Number(prev.dealsClosed || 0),
          },
          deltas: {
            score: score - previousScore,
            calls: Number(rep.calls || 0) - Number(prev.calls || 0),
            qualifiedContacts: Number(rep.qualifiedContacts || 0) - Number(prev.qualifiedContacts || 0),
            meetingsBooked: Number(rep.meetingsBooked || 0) - Number(prev.meetingsBooked || 0),
            meetingsAttended: Number(rep.meetingsAttended || 0) - Number(prev.meetingsAttended || 0),
            proposalsSent: Number(rep.proposalsSent || 0) - Number(prev.proposalsSent || 0),
            dealsClosed: Number(rep.dealsClosed || 0) - Number(prev.dealsClosed || 0),
          },
        };
      })
      .sort((a, b) => (
        b.score - a.score
        || b.dealsClosed - a.dealsClosed
        || b.meetingsAttended - a.meetingsAttended
        || b.meetingsBooked - a.meetingsBooked
        || b.proposalsSent - a.proposalsSent
        || b.qualifiedContacts - a.qualifiedContacts
        || b.calls - a.calls
        || a.owner.localeCompare(b.owner)
      ))
      .map((rep, idx) => ({ ...rep, rank: idx + 1 }));

    let avatarByOwner = new Map();
    try {
      const avatarRows = await sql`
        SELECT ghl_owner_id, avatar, avatar_color
        FROM app_users
        WHERE ghl_owner_id IS NOT NULL AND ghl_owner_id <> ''
      `;
      avatarByOwner = new Map(avatarRows.map((row) => [String(row.ghl_owner_id), { avatar: row.avatar || null, avatarColor: row.avatar_color || null }]));
    } catch { /* avatars are best-effort */ }

    for (const rep of reps) {
      const face = avatarByOwner.get(String(rep.ownerId));
      rep.avatar = face?.avatar || null;
      rep.avatarColor = face?.avatarColor || null;
    }

    const totals = reps.reduce((acc, rep) => {
      acc.calls += rep.calls;
      acc.qualifiedContacts += rep.qualifiedContacts;
      acc.meetingsBooked += rep.meetingsBooked;
      acc.meetingsAttended += rep.meetingsAttended;
      acc.proposalsSent += rep.proposalsSent;
      acc.dealsClosed += rep.dealsClosed;
      return acc;
    }, {
      calls: 0,
      qualifiedContacts: 0,
      meetingsBooked: 0,
      meetingsAttended: 0,
      proposalsSent: 0,
      dealsClosed: 0,
    });

    const totalsPrevious = reps.reduce((acc, rep) => {
      const prev = rep.previous || {};
      acc.calls += Number(prev.calls || 0);
      acc.qualifiedContacts += Number(prev.qualifiedContacts || 0);
      acc.meetingsBooked += Number(prev.meetingsBooked || 0);
      acc.meetingsAttended += Number(prev.meetingsAttended || 0);
      acc.proposalsSent += Number(prev.proposalsSent || 0);
      acc.dealsClosed += Number(prev.dealsClosed || 0);
      return acc;
    }, {
      calls: 0,
      qualifiedContacts: 0,
      meetingsBooked: 0,
      meetingsAttended: 0,
      proposalsSent: 0,
      dealsClosed: 0,
    });

    const totalsDeltas = {
      calls: totals.calls - totalsPrevious.calls,
      qualifiedContacts: totals.qualifiedContacts - totalsPrevious.qualifiedContacts,
      meetingsBooked: totals.meetingsBooked - totalsPrevious.meetingsBooked,
      meetingsAttended: totals.meetingsAttended - totalsPrevious.meetingsAttended,
      proposalsSent: totals.proposalsSent - totalsPrevious.proposalsSent,
      dealsClosed: totals.dealsClosed - totalsPrevious.dealsClosed,
    };

    return res.status(200).json({
      success: true,
      filters: {
        ownerId: filterOwner,
        from: window.fromDateKey,
        to: window.toDateKey,
        weekStart: window.weekStartKey,
        weekEnd: window.weekEndKey,
        weekOffset: window.weekOffset,
        isCurrentWeek: window.isCurrentWeek,
        mode: window.mode,
        timeZone: BUSINESS_TIME_ZONE,
      },
      scoreWeights: SCORE_WEIGHTS,
      totals,
      totalsPrevious,
      totalsDeltas,
      reps,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
