import { getSql, initAuthTables, initQueueTable, initTimeOffTable } from './db.js';
import { resolveIdentity, hasMinRole } from './session.js';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_HISTORY = 12;

function datasetMeta(rows, description, grain, period) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    description,
    grain,
    period,
    rows: safeRows.length,
    columns: safeRows[0] ? Object.keys(safeRows[0]) : [],
  };
}

function normalizeAnswer(text) {
  let out = String(text || '').replace(/\r/g, '').trim();
  out = out.replace(/^#{1,6}\s*/gm, '');
  out = out.replace(/\*\*(.*?)\*\*/g, '$1');
  out = out.replace(/^\s*[-*_]{3,}\s*$/gm, '');
  out = out.replace(/^\|[-|:\s]+\|\s*$/gm, '');
  out = out.replace(/^\|.*\|\s*$/gm, '');
  out = out.replace(/^[\t ]*[-*]\s+/gm, '- ');
  out = out.replace(/\n\s*\n\s*\n+/g, '\n\n');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}

function requestBytes(req) {
  const declared = Number.parseInt(req.headers?.['content-length'] || '0', 10);
  if (Number.isFinite(declared) && declared > 0) return declared;
  return Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
}

function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 8000) }))
    .slice(-MAX_HISTORY);
}

async function tableExists(sql, tableName) {
  try {
    const rows = await sql`SELECT to_regclass(${tableName}) AS reg`;
    return !!rows?.[0]?.reg;
  } catch {
    return false;
  }
}

async function columnExists(sql, tableName, columnName) {
  try {
    const rows = await sql`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
      LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function getDataBundle(sql) {
  const hasQueueEvents = await tableExists(sql, 'queue_events');
  const hasActivityBlocks = await tableExists(sql, 'manual_activity_blocks');
  const hasManualCalls = await tableExists(sql, 'manual_call_logs');
  const hasManualMeetings = await tableExists(sql, 'manual_meeting_logs');
  const hasLeadNotes = await tableExists(sql, 'lead_notes');

  const [
    hasQualifiedAt,
    hasMeetingBookedAt,
    hasMeetingNoShowAt,
    hasMeetingAttendedAt,
    hasScopingAt,
    hasProposalAt,
    hasWonAt,
    hasLostAt,
  ] = await Promise.all([
    columnExists(sql, 'queue_leads', 'qualified_at'),
    columnExists(sql, 'queue_leads', 'meeting_booked_at'),
    columnExists(sql, 'queue_leads', 'meeting_no_show_at'),
    columnExists(sql, 'queue_leads', 'meeting_attended_at'),
    columnExists(sql, 'queue_leads', 'scoping_at'),
    columnExists(sql, 'queue_leads', 'proposal_at'),
    columnExists(sql, 'queue_leads', 'won_at'),
    columnExists(sql, 'queue_leads', 'lost_at'),
  ]);
  const hasLeadStageColumns = hasQualifiedAt && hasMeetingBookedAt && hasMeetingNoShowAt && hasMeetingAttendedAt && hasScopingAt && hasProposalAt && hasWonAt && hasLostAt;

  const leadsBySourceStatusOwner = await sql`
    SELECT
      COALESCE(NULLIF(source, ''), 'outbound') AS source,
      status,
      COALESCE(owner, 'Unassigned') AS owner,
      COALESCE(owner_id, 'unassigned') AS owner_id,
      COUNT(*)::int AS leads
    FROM queue_leads
    WHERE archived_at IS NULL
    GROUP BY 1,2,3,4
    ORDER BY leads DESC
  `;

  const leadAging = await sql`
    SELECT
      COALESCE(NULLIF(source, ''), 'outbound') AS source,
      AVG(EXTRACT(EPOCH FROM (now() - created_at)) / 3600)::numeric(10,2) AS avg_age_hours,
      AVG(EXTRACT(EPOCH FROM (now() - updated_at)) / 3600)::numeric(10,2) AS avg_stale_hours,
      COUNT(*)::int AS leads
    FROM queue_leads
    WHERE archived_at IS NULL
    GROUP BY 1
    ORDER BY leads DESC
  `;

  const leadsCreatedDaily = await sql`
    SELECT
      DATE(created_at AT TIME ZONE 'Europe/London') AS day,
      COALESCE(NULLIF(source, ''), 'outbound') AS source,
      COUNT(*)::int AS created
    FROM queue_leads
    WHERE archived_at IS NULL
      AND created_at >= now() - interval '90 days'
    GROUP BY 1,2
    ORDER BY day ASC, source ASC
  `;

  const pipelineByOwnerStatus = await sql`
    SELECT
      COALESCE(owner, 'Unassigned') AS owner,
      COALESCE(owner_id, 'unassigned') AS owner_id,
      status,
      COUNT(*)::int AS leads
    FROM queue_leads
    WHERE archived_at IS NULL
    GROUP BY 1,2,3
    ORDER BY owner ASC, leads DESC
  `;

  const callbackPressureByOwner = await sql`
    SELECT
      COALESCE(owner, 'Unassigned') AS owner,
      COALESCE(owner_id, 'unassigned') AS owner_id,
      COUNT(*)::int AS callbacks,
      AVG(EXTRACT(EPOCH FROM (now() - updated_at)) / 3600)::numeric(10,2) AS avg_callback_stale_hours
    FROM queue_leads
    WHERE archived_at IS NULL
      AND COALESCE(status, '') ILIKE 'callback%'
    GROUP BY 1,2
    ORDER BY callbacks DESC
  `;

  const leadFlow7d = hasQueueEvents
    ? await sql`
        SELECT
          DATE(qe.created_at AT TIME ZONE 'Europe/London') AS day,
          COALESCE(qe.owner_name, ql.owner, 'Unknown') AS owner,
          COALESCE(NULLIF(qe.meta->>'source', ''), NULLIF(ql.source, ''), 'unknown') AS source,
          qe.to_status,
          COUNT(*)::int AS events
        FROM queue_events qe
        LEFT JOIN queue_leads ql ON ql.id = qe.lead_id
        WHERE qe.event_type = 'status_change'
          AND qe.created_at >= now() - interval '7 days'
        GROUP BY 1,2,3,4
        ORDER BY day ASC, events DESC
      `
    : [];

  const callHourly = hasQueueEvents
    ? await sql`
        SELECT
          EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Europe/London'))::int AS hour,
          COUNT(*)::int AS calls,
          COUNT(*) FILTER (WHERE COALESCE(meta->>'outcome', '') ILIKE 'Answered%')::int AS answered
        FROM queue_events
        WHERE event_type = 'call'
          AND created_at >= now() - interval '30 days'
        GROUP BY 1
        ORDER BY 1 ASC
      `
    : [];

  const callByOwnerOutcome = hasQueueEvents
    ? await sql`
        SELECT
          COALESCE(owner_name, 'Unknown') AS owner,
          COALESCE(meta->>'outcome', 'Unknown') AS outcome,
          COUNT(*)::int AS calls
        FROM queue_events
        WHERE event_type = 'call'
          AND created_at >= now() - interval '30 days'
        GROUP BY 1,2
        ORDER BY calls DESC
      `
    : [];

  const callActivityDaily = hasQueueEvents || hasManualCalls
    ? await sql`
        WITH call_activity AS (
          SELECT
            COALESCE(qe.owner_id, ql.owner_id, 'unknown') AS owner_id,
            COALESCE(qe.owner_name, ql.owner, 'Unknown') AS owner,
            DATE(qe.created_at AT TIME ZONE 'Europe/London') AS day,
            COALESCE(qe.meta->>'outcome', '') AS outcome,
            COALESCE(qe.meta->>'actionKey', '') AS action_key,
            qe.created_at AS created_at
          FROM queue_events qe
          LEFT JOIN queue_leads ql ON ql.id = qe.lead_id
          WHERE qe.event_type = 'call'
            AND qe.created_at >= now() - interval '90 days'

          UNION ALL

          SELECT
            COALESCE(m.owner_id, 'unknown') AS owner_id,
            COALESCE(m.owner_name, 'Unknown') AS owner,
            DATE(m.created_at AT TIME ZONE 'Europe/London') AS day,
            COALESCE(m.meta->>'outcome', '') AS outcome,
            COALESCE(m.meta->>'actionKey', 'manual_old_lead') AS action_key,
            m.created_at AS created_at
          FROM manual_call_logs m
          WHERE m.created_at >= now() - interval '90 days'
        )
        SELECT
          day,
          owner,
          owner_id,
          COUNT(*)::int AS calls,
          COUNT(*) FILTER (WHERE outcome ILIKE 'Answered%')::int AS answered,
          COUNT(*) FILTER (WHERE outcome = 'Answered - interested' OR action_key = 'answered_interested')::int AS interested,
          COUNT(*) FILTER (WHERE outcome = 'Answered - wants info' OR action_key IN ('wants_info_callback', 'wants_info_email_only'))::int AS wants_info,
          COUNT(*) FILTER (WHERE outcome ILIKE 'No answer%' OR action_key = 'no_answer')::int AS no_answer,
          COUNT(*) FILTER (WHERE outcome ILIKE '%voicemail%' OR action_key = 'voicemail')::int AS voicemail,
          COUNT(*) FILTER (WHERE outcome = 'Gatekeeper' OR action_key IN ('gatekeeper_callback', 'gatekeeper_send_email', 'gatekeeper_dead_end'))::int AS gatekeeper,
          COUNT(*) FILTER (WHERE outcome = 'Wrong number' OR action_key = 'wrong_number')::int AS wrong_number
        FROM call_activity
        GROUP BY 1,2,3
        ORDER BY day ASC, calls DESC
      `
    : [];

  const callHourlyByOwner = hasQueueEvents || hasManualCalls
    ? await sql`
        WITH call_activity AS (
          SELECT
            COALESCE(qe.owner_id, ql.owner_id, 'unknown') AS owner_id,
            COALESCE(qe.owner_name, ql.owner, 'Unknown') AS owner,
            EXTRACT(HOUR FROM (qe.created_at AT TIME ZONE 'Europe/London'))::int AS hour,
            COALESCE(qe.meta->>'outcome', '') AS outcome,
            COALESCE(qe.meta->>'actionKey', '') AS action_key,
            qe.created_at AS created_at
          FROM queue_events qe
          LEFT JOIN queue_leads ql ON ql.id = qe.lead_id
          WHERE qe.event_type = 'call'
            AND qe.created_at >= now() - interval '30 days'

          UNION ALL

          SELECT
            COALESCE(m.owner_id, 'unknown') AS owner_id,
            COALESCE(m.owner_name, 'Unknown') AS owner,
            EXTRACT(HOUR FROM (m.created_at AT TIME ZONE 'Europe/London'))::int AS hour,
            COALESCE(m.meta->>'outcome', '') AS outcome,
            COALESCE(m.meta->>'actionKey', 'manual_old_lead') AS action_key,
            m.created_at AS created_at
          FROM manual_call_logs m
          WHERE m.created_at >= now() - interval '30 days'
        )
        SELECT
          owner,
          owner_id,
          hour,
          COUNT(*)::int AS calls,
          COUNT(*) FILTER (WHERE outcome ILIKE 'Answered%')::int AS answered,
          COUNT(*) FILTER (WHERE outcome = 'Answered - interested' OR action_key = 'answered_interested')::int AS interested
        FROM call_activity
        GROUP BY 1,2,3
        ORDER BY owner ASC, hour ASC
      `
    : [];

  const callWeekdayByOwner = hasQueueEvents || hasManualCalls
    ? await sql`
        WITH call_activity AS (
          SELECT
            COALESCE(qe.owner_id, ql.owner_id, 'unknown') AS owner_id,
            COALESCE(qe.owner_name, ql.owner, 'Unknown') AS owner,
            EXTRACT(DOW FROM (qe.created_at AT TIME ZONE 'Europe/London'))::int AS dow,
            COALESCE(qe.meta->>'outcome', '') AS outcome,
            COALESCE(qe.meta->>'actionKey', '') AS action_key,
            qe.created_at AS created_at
          FROM queue_events qe
          LEFT JOIN queue_leads ql ON ql.id = qe.lead_id
          WHERE qe.event_type = 'call'
            AND qe.created_at >= now() - interval '90 days'

          UNION ALL

          SELECT
            COALESCE(m.owner_id, 'unknown') AS owner_id,
            COALESCE(m.owner_name, 'Unknown') AS owner,
            EXTRACT(DOW FROM (m.created_at AT TIME ZONE 'Europe/London'))::int AS dow,
            COALESCE(m.meta->>'outcome', '') AS outcome,
            COALESCE(m.meta->>'actionKey', 'manual_old_lead') AS action_key,
            m.created_at AS created_at
          FROM manual_call_logs m
          WHERE m.created_at >= now() - interval '90 days'
        )
        SELECT
          owner,
          owner_id,
          dow,
          COUNT(*)::int AS calls,
          COUNT(*) FILTER (WHERE outcome ILIKE 'Answered%')::int AS answered,
          COUNT(*) FILTER (WHERE outcome = 'Answered - interested' OR action_key = 'answered_interested')::int AS interested
        FROM call_activity
        GROUP BY 1,2,3
        ORDER BY owner ASC, dow ASC
      `
    : [];

  const sourceToStatus30d = hasQueueEvents
    ? await sql`
        SELECT
          COALESCE(NULLIF(qe.meta->>'source', ''), NULLIF(ql.source, ''), 'unknown') AS source,
          qe.to_status,
          COUNT(*)::int AS transitions
        FROM queue_events qe
        LEFT JOIN queue_leads ql ON ql.id = qe.lead_id
        WHERE qe.event_type = 'status_change'
          AND qe.created_at >= now() - interval '30 days'
        GROUP BY 1,2
        ORDER BY source ASC, transitions DESC
      `
    : [];

  const repComparison7d = hasQueueEvents || hasManualCalls
    ? await sql`
        WITH call_activity AS (
          SELECT
            COALESCE(qe.owner_id, ql.owner_id, 'unknown') AS owner_id,
            COALESCE(qe.owner_name, ql.owner, 'Unknown') AS owner,
            qe.created_at AS created_at,
            COALESCE(qe.meta->>'outcome', '') AS outcome,
            COALESCE(qe.meta->>'actionKey', '') AS action_key
          FROM queue_events qe
          LEFT JOIN queue_leads ql ON ql.id = qe.lead_id
          WHERE qe.event_type = 'call'
            AND qe.created_at >= now() - interval '14 days'

          UNION ALL

          SELECT
            COALESCE(m.owner_id, 'unknown') AS owner_id,
            COALESCE(m.owner_name, 'Unknown') AS owner,
            m.created_at AS created_at,
            COALESCE(m.meta->>'outcome', '') AS outcome,
            COALESCE(m.meta->>'actionKey', 'manual_old_lead') AS action_key
          FROM manual_call_logs m
          WHERE m.created_at >= now() - interval '14 days'
        )
        SELECT
          owner,
          owner_id,
          COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS calls_7d,
          COUNT(*) FILTER (WHERE created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days')::int AS calls_prev_7d,
          COUNT(*) FILTER (
            WHERE created_at >= now() - interval '7 days'
              AND (outcome = 'Answered - interested' OR action_key = 'answered_interested')
          )::int AS interested_7d,
          COUNT(*) FILTER (
            WHERE created_at >= now() - interval '14 days'
              AND created_at < now() - interval '7 days'
              AND (outcome = 'Answered - interested' OR action_key = 'answered_interested')
          )::int AS interested_prev_7d
        FROM call_activity
        GROUP BY 1,2
        ORDER BY owner ASC
      `
    : [];

  const globalComparison = hasQueueEvents
    ? await sql`
        SELECT
          COUNT(*) FILTER (WHERE event_type = 'call' AND created_at >= now() - interval '7 days')::int AS calls_7d,
          COUNT(*) FILTER (WHERE event_type = 'call' AND created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days')::int AS calls_prev_7d,
          COUNT(*) FILTER (
            WHERE event_type = 'call'
              AND created_at >= now() - interval '7 days'
              AND (COALESCE(meta->>'outcome', '') = 'Answered - interested' OR COALESCE(meta->>'actionKey', '') = 'answered_interested')
          )::int AS interested_7d,
          COUNT(*) FILTER (
            WHERE event_type = 'call'
              AND created_at >= now() - interval '14 days'
              AND created_at < now() - interval '7 days'
              AND (COALESCE(meta->>'outcome', '') = 'Answered - interested' OR COALESCE(meta->>'actionKey', '') = 'answered_interested')
          )::int AS interested_prev_7d,
          COUNT(*) FILTER (
            WHERE event_type = 'status_change'
              AND created_at >= now() - interval '7 days'
              AND to_status = 'qualified'
          )::int AS qualified_7d,
          COUNT(*) FILTER (
            WHERE event_type = 'status_change'
              AND created_at >= now() - interval '14 days'
              AND created_at < now() - interval '7 days'
              AND to_status = 'qualified'
          )::int AS qualified_prev_7d
        FROM queue_events
        WHERE created_at >= now() - interval '14 days'
      `
    : [];

  const callActionSplit30d = hasQueueEvents || hasManualCalls
    ? await sql`
        WITH call_activity AS (
          SELECT
            COALESCE(qe.owner_id, ql.owner_id, 'unknown') AS owner_id,
            COALESCE(qe.owner_name, ql.owner, 'Unknown') AS owner,
            COALESCE(NULLIF(qe.meta->>'source', ''), NULLIF(ql.source, ''), 'unknown') AS source,
            COALESCE(qe.meta->>'outcome', '') AS outcome,
            COALESCE(qe.meta->>'actionKey', '') AS action_key
          FROM queue_events qe
          LEFT JOIN queue_leads ql ON ql.id = qe.lead_id
          WHERE qe.event_type = 'call'
            AND qe.created_at >= now() - interval '30 days'

          UNION ALL

          SELECT
            COALESCE(m.owner_id, 'unknown') AS owner_id,
            COALESCE(m.owner_name, 'Unknown') AS owner,
            COALESCE(NULLIF(m.source, ''), 'unknown') AS source,
            COALESCE(m.meta->>'outcome', '') AS outcome,
            COALESCE(m.meta->>'actionKey', 'manual_old_lead') AS action_key
          FROM manual_call_logs m
          WHERE m.created_at >= now() - interval '30 days'
        )
        SELECT
          owner,
          owner_id,
          source,
          COUNT(*)::int AS calls,
          COUNT(*) FILTER (WHERE outcome ILIKE 'Answered%')::int AS answered,
          COUNT(*) FILTER (WHERE outcome = 'Answered - interested' OR action_key = 'answered_interested')::int AS answered_interested,
          COUNT(*) FILTER (WHERE outcome = 'Answered - not interested' OR action_key = 'answered_not_interested')::int AS answered_not_interested,
          COUNT(*) FILTER (WHERE outcome = 'Answered - wants info' OR action_key IN ('wants_info_callback', 'wants_info_email_only'))::int AS wants_more_info,
          COUNT(*) FILTER (WHERE action_key = 'wants_info_callback')::int AS wants_more_info_callback,
          COUNT(*) FILTER (WHERE action_key = 'wants_info_email_only')::int AS wants_more_info_email_only,
          COUNT(*) FILTER (WHERE outcome ILIKE 'No answer%' OR action_key = 'no_answer')::int AS no_answer,
          COUNT(*) FILTER (WHERE outcome ILIKE '%voicemail%' OR action_key = 'voicemail')::int AS voicemail,
          COUNT(*) FILTER (WHERE outcome = 'Gatekeeper' OR action_key IN ('gatekeeper_callback', 'gatekeeper_send_email', 'gatekeeper_dead_end'))::int AS gatekeeper,
          COUNT(*) FILTER (WHERE action_key = 'gatekeeper_callback')::int AS gatekeeper_callback,
          COUNT(*) FILTER (WHERE action_key = 'gatekeeper_send_email')::int AS gatekeeper_send_email,
          COUNT(*) FILTER (WHERE action_key = 'gatekeeper_dead_end')::int AS gatekeeper_dead_end,
          COUNT(*) FILTER (WHERE outcome = 'Wrong number' OR action_key = 'wrong_number')::int AS wrong_number
        FROM call_activity
        GROUP BY 1,2,3
        ORDER BY calls DESC
      `
    : [];

  const interestedToQualified30d = hasQueueEvents
    ? await sql`
        WITH interested AS (
          SELECT
            qe.lead_id,
            MIN(qe.created_at) AS first_interested_at
          FROM queue_events qe
          WHERE qe.event_type = 'call'
            AND qe.created_at >= now() - interval '30 days'
            AND (
              COALESCE(qe.meta->>'actionKey', '') = 'answered_interested'
              OR COALESCE(qe.meta->>'outcome', '') = 'Answered - interested'
            )
          GROUP BY qe.lead_id
        ), qualified_after AS (
          SELECT
            i.lead_id,
            MIN(qe.created_at) AS first_qualified_after_interested
          FROM interested i
          JOIN queue_events qe ON qe.lead_id = i.lead_id
          WHERE qe.event_type = 'status_change'
            AND qe.to_status = 'qualified'
            AND qe.created_at >= i.first_interested_at
          GROUP BY i.lead_id
        )
        SELECT
          COALESCE(NULLIF(ql.source, ''), 'unknown') AS source,
          COALESCE(ql.owner, 'Unassigned') AS owner,
          COALESCE(ql.owner_id, 'unassigned') AS owner_id,
          COUNT(*)::int AS interested_leads,
          COUNT(qa.lead_id)::int AS qualified_from_interested,
          AVG(EXTRACT(EPOCH FROM (qa.first_qualified_after_interested - i.first_interested_at)) / 3600.0)::numeric(10,2) AS avg_hours_to_qualify_after_interest,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (qa.first_qualified_after_interested - i.first_interested_at)) / 3600.0)::numeric(10,2) AS median_hours_to_qualify_after_interest
        FROM interested i
        LEFT JOIN qualified_after qa ON qa.lead_id = i.lead_id
        LEFT JOIN queue_leads ql ON ql.id = i.lead_id
        GROUP BY 1,2,3
        ORDER BY interested_leads DESC
      `
    : [];

  const qualificationVelocityBySource90d = hasLeadStageColumns
    ? await sql`
        SELECT
          COALESCE(NULLIF(source, ''), 'unknown') AS source,
          COUNT(*)::int AS qualified_leads,
          AVG(EXTRACT(EPOCH FROM (qualified_at - created_at)) / 3600.0)::numeric(10,2) AS avg_hours_to_qualified,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (qualified_at - created_at)) / 3600.0)::numeric(10,2) AS median_hours_to_qualified
        FROM queue_leads
        WHERE archived_at IS NULL
          AND qualified_at IS NOT NULL
          AND qualified_at >= now() - interval '90 days'
          AND created_at IS NOT NULL
          AND qualified_at >= created_at
        GROUP BY 1
        ORDER BY qualified_leads DESC
      `
    : [];

  const qualificationVelocityByOwner90d = hasLeadStageColumns
    ? await sql`
        SELECT
          COALESCE(owner, 'Unassigned') AS owner,
          COALESCE(owner_id, 'unassigned') AS owner_id,
          COUNT(*)::int AS qualified_leads,
          AVG(EXTRACT(EPOCH FROM (qualified_at - created_at)) / 3600.0)::numeric(10,2) AS avg_hours_to_qualified,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (qualified_at - created_at)) / 3600.0)::numeric(10,2) AS median_hours_to_qualified
        FROM queue_leads
        WHERE archived_at IS NULL
          AND qualified_at IS NOT NULL
          AND qualified_at >= now() - interval '90 days'
          AND created_at IS NOT NULL
          AND qualified_at >= created_at
        GROUP BY 1,2
        ORDER BY qualified_leads DESC
      `
    : [];

  const meetingStageProgression90d = hasLeadStageColumns
    ? await sql`
        SELECT
          COALESCE(owner, 'Unassigned') AS owner,
          COALESCE(owner_id, 'unassigned') AS owner_id,
          COALESCE(NULLIF(source, ''), 'unknown') AS source,
          COUNT(*) FILTER (WHERE qualified_at >= now() - interval '90 days')::int AS qualified,
          COUNT(*) FILTER (WHERE meeting_booked_at >= now() - interval '90 days')::int AS meeting_booked,
          COUNT(*) FILTER (WHERE meeting_no_show_at >= now() - interval '90 days')::int AS meeting_no_show,
          COUNT(*) FILTER (WHERE meeting_attended_at >= now() - interval '90 days')::int AS meeting_attended,
          COUNT(*) FILTER (WHERE scoping_at >= now() - interval '90 days')::int AS scoping,
          COUNT(*) FILTER (WHERE proposal_at >= now() - interval '90 days')::int AS proposal,
          COUNT(*) FILTER (WHERE won_at >= now() - interval '90 days')::int AS won,
          COUNT(*) FILTER (WHERE lost_at >= now() - interval '90 days')::int AS lost
        FROM queue_leads
        WHERE archived_at IS NULL
        GROUP BY 1,2,3
        ORDER BY qualified DESC
      `
    : [];

  const manualMeetingsByOwner30d = hasManualMeetings
    ? await sql`
        SELECT
          COALESCE(owner_name, 'Unknown') AS owner,
          COALESCE(owner_id, 'unknown') AS owner_id,
          COALESCE(NULLIF(source, ''), 'unknown') AS source,
          COUNT(*)::int AS meetings,
          COUNT(*) FILTER (WHERE COALESCE(meta->>'outcome', '') = 'attended')::int AS attended,
          COUNT(*) FILTER (WHERE COALESCE(meta->>'outcome', '') = 'no_show')::int AS no_show
        FROM manual_meeting_logs
        WHERE created_at >= now() - interval '30 days'
        GROUP BY 1,2,3
        ORDER BY meetings DESC
      `
    : [];

  const activityByHour = hasActivityBlocks
    ? await sql`
        SELECT
          EXTRACT(HOUR FROM (starts_at AT TIME ZONE 'Europe/London'))::int AS hour,
          COUNT(*)::int AS blocks
        FROM manual_activity_blocks
        WHERE starts_at >= now() - interval '30 days'
        GROUP BY 1
        ORDER BY 1 ASC
      `
    : [];

  const activityByOwner = hasActivityBlocks
    ? await sql`
        SELECT
          COALESCE(owner_name, 'Unknown') AS owner,
          COUNT(*)::int AS blocks,
          SUM(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 3600.0)::numeric(10,2) AS hours
        FROM manual_activity_blocks
        WHERE starts_at >= now() - interval '30 days'
        GROUP BY 1
        ORDER BY blocks DESC
      `
    : [];

  const activityByType30d = hasActivityBlocks
    ? await sql`
        SELECT
          COALESCE(NULLIF(title, ''), 'Untitled') AS title,
          COALESCE(NULLIF(source, ''), 'unknown') AS source,
          COUNT(*)::int AS blocks,
          SUM(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 3600.0)::numeric(10,2) AS hours
        FROM manual_activity_blocks
        WHERE starts_at >= now() - interval '30 days'
        GROUP BY 1,2
        ORDER BY blocks DESC
      `
    : [];

  const activityWeekdayByOwner30d = hasActivityBlocks
    ? await sql`
        SELECT
          COALESCE(owner_name, 'Unknown') AS owner,
          COALESCE(owner_id, 'unknown') AS owner_id,
          EXTRACT(DOW FROM (starts_at AT TIME ZONE 'Europe/London'))::int AS dow,
          COUNT(*)::int AS blocks,
          SUM(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 3600.0)::numeric(10,2) AS hours
        FROM manual_activity_blocks
        WHERE starts_at >= now() - interval '30 days'
        GROUP BY 1,2,3
        ORDER BY owner ASC, dow ASC
      `
    : [];

  const manualCallsByOwner = hasManualCalls
    ? await sql`
        SELECT
          COALESCE(owner_name, 'Unknown') AS owner,
          COUNT(*)::int AS calls,
          COUNT(*) FILTER (WHERE COALESCE(meta->>'outcome', '') ILIKE 'Answered%')::int AS answered
        FROM manual_call_logs
        WHERE created_at >= now() - interval '30 days'
        GROUP BY 1
        ORDER BY calls DESC
      `
    : [];

  const activeTimeOff = await sql`
    SELECT
      owner_id,
      start_date,
      end_date,
      day_part,
      COALESCE(hours_off, 0)::numeric(10,2) AS hours_off
    FROM rep_time_off
    WHERE canceled_at IS NULL
      AND end_date >= ((now() AT TIME ZONE 'Europe/London')::date - 30)
      AND start_date <= ((now() AT TIME ZONE 'Europe/London')::date + 30)
    ORDER BY start_date DESC
  `;

  const leadNotesByOwner30d = hasLeadNotes
    ? await sql`
        SELECT
          COALESCE(ln.owner_name, ql.owner, 'Unknown') AS owner,
          COALESCE(ln.owner_id, ql.owner_id, 'unknown') AS owner_id,
          COALESCE(NULLIF(ql.source, ''), 'unknown') AS source,
          COUNT(*)::int AS notes,
          COUNT(DISTINCT ln.lead_id)::int AS leads_with_notes
        FROM lead_notes ln
        LEFT JOIN queue_leads ql ON ql.id = ln.lead_id
        WHERE ln.created_at >= now() - interval '30 days'
        GROUP BY 1,2,3
        ORDER BY notes DESC
      `
    : [];

  const leadNoteThemes30d = hasLeadNotes
    ? await sql`
        WITH tokens AS (
          SELECT LOWER(token) AS token
          FROM lead_notes ln,
          LATERAL regexp_split_to_table(COALESCE(ln.note, ''), E'[^a-zA-Z0-9]+') AS token
          WHERE ln.created_at >= now() - interval '30 days'
        )
        SELECT
          token,
          COUNT(*)::int AS mentions
        FROM tokens
        WHERE char_length(token) >= 4
          AND token <> ALL (ARRAY[
            'this','that','with','have','from','your','they','them','were','been','will','would','could','should',
            'just','into','about','over','under','also','then','than','when','where','what','which','there','their',
            'call','called','note','noted','lead','leads','today','yesterday','tomorrow','next','last','only','very',
            'more','less','info','want','wants','sent','send','email','emails','reply','replied','customer','client'
          ])
        GROUP BY token
        ORDER BY mentions DESC, token ASC
        LIMIT 30
      `
    : [];

  const quietHours = [];
  if (callHourly.length) {
    const values = callHourly.map((r) => Number(r.calls || 0)).sort((a, b) => a - b);
    const q1 = values[Math.floor(values.length * 0.25)] || 0;
    for (const row of callHourly) {
      if (Number(row.calls || 0) <= q1) quietHours.push(Number(row.hour));
    }
  }

  const quietHourActivityOverlap = activityByHour
    .filter((row) => quietHours.includes(Number(row.hour)))
    .map((row) => ({ hour: Number(row.hour), blocks: Number(row.blocks || 0) }));

  const dataCatalog = {
    leadsBySourceStatusOwner: datasetMeta(leadsBySourceStatusOwner, 'Current lead inventory by source/status/owner', 'source x status x owner', 'current snapshot'),
    leadAging: datasetMeta(leadAging, 'Lead age and staleness by source', 'source', 'current snapshot'),
    leadsCreatedDaily: datasetMeta(leadsCreatedDaily, 'New leads created per day by source', 'day x source', 'last_90_days'),
    pipelineByOwnerStatus: datasetMeta(pipelineByOwnerStatus, 'Pipeline distribution by owner and status', 'owner x status', 'current snapshot'),
    callbackPressureByOwner: datasetMeta(callbackPressureByOwner, 'Callback backlog and staleness by owner', 'owner', 'current snapshot'),
    leadFlow7d: datasetMeta(leadFlow7d, 'Recent status-change events by day/owner/source/to_status', 'day x owner x source x to_status', 'last_7_days'),
    sourceToStatus30d: datasetMeta(sourceToStatus30d, 'Source-to-status transition counts', 'source x to_status', 'last_30_days'),
    callActionSplit30d: datasetMeta(callActionSplit30d, 'Call outcome/action-key splits by owner/source', 'owner x source', 'last_30_days'),
    interestedToQualified30d: datasetMeta(interestedToQualified30d, 'Interested-to-qualified conversion and time-to-qualify', 'source x owner', 'last_30_days'),
    qualificationVelocityBySource90d: datasetMeta(qualificationVelocityBySource90d, 'Qualification velocity by source', 'source', 'last_90_days'),
    qualificationVelocityByOwner90d: datasetMeta(qualificationVelocityByOwner90d, 'Qualification velocity by owner', 'owner', 'last_90_days'),
    meetingStageProgression90d: datasetMeta(meetingStageProgression90d, 'Meeting and later-stage progression by owner/source', 'owner x source', 'last_90_days'),
    manualMeetingsByOwner30d: datasetMeta(manualMeetingsByOwner30d, 'Manual meeting logs by owner/source', 'owner x source', 'last_30_days'),
    callHourly: datasetMeta(callHourly, 'Calls by hour, with answered subset', 'hour', 'last_30_days'),
    callByOwnerOutcome: datasetMeta(callByOwnerOutcome, 'Call outcomes by owner', 'owner x outcome', 'last_30_days'),
    callActivityDaily: datasetMeta(callActivityDaily, 'Daily call outcomes by owner (queue + manual)', 'day x owner', 'last_90_days'),
    callHourlyByOwner: datasetMeta(callHourlyByOwner, 'Call hour profile by owner', 'owner x hour', 'last_30_days'),
    callWeekdayByOwner: datasetMeta(callWeekdayByOwner, 'Call weekday profile by owner', 'owner x dow', 'last_90_days'),
    repComparison7d: datasetMeta(repComparison7d, 'Rep comparison current 7d vs previous 7d', 'owner', 'rolling_14_days'),
    globalComparison: datasetMeta(globalComparison, 'Global 7d vs previous 7d movement for key KPIs', 'global', 'rolling_14_days'),
    activityByHour: datasetMeta(activityByHour, 'Manual activity blocks by start hour', 'hour', 'last_30_days'),
    activityByOwner: datasetMeta(activityByOwner, 'Manual activity blocks and hours by owner', 'owner', 'last_30_days'),
    activityByType30d: datasetMeta(activityByType30d, 'Manual activity block type/source mix', 'title x source', 'last_30_days'),
    activityWeekdayByOwner30d: datasetMeta(activityWeekdayByOwner30d, 'Manual activity blocks by owner weekday pattern', 'owner x dow', 'last_30_days'),
    manualCallsByOwner: datasetMeta(manualCallsByOwner, 'Manual old-lead calls by owner', 'owner', 'last_30_days'),
    leadNotesByOwner30d: datasetMeta(leadNotesByOwner30d, 'Lead-note volume by owner/source', 'owner x source', 'last_30_days'),
    leadNoteThemes30d: datasetMeta(leadNoteThemes30d, 'Most-mentioned note terms', 'token', 'last_30_days'),
    activeTimeOff: datasetMeta(activeTimeOff, 'Rep time-off windows and hours', 'owner x date range', '±30_days'),
    quietHourActivityOverlap: datasetMeta(quietHourActivityOverlap, 'Activity blocks overlapping statistically quiet call hours', 'hour', 'last_30_days'),
  };

  return {
    generatedAt: new Date().toISOString(),
    windows: {
      calls: 'last_30_days',
      leadFlow: 'last_7_days',
      activity: 'last_30_days',
      callsDaily: 'last_90_days',
      comparisons: 'rolling_14_days',
      meetings: 'last_30_days_and_90_days',
      notes: 'last_30_days',
      qualificationVelocity: 'last_90_days',
    },
    dataHealth: {
      hasQueueEvents,
      hasActivityBlocks,
      hasManualCalls,
      hasManualMeetings,
      hasLeadNotes,
      hasLeadStageColumns,
    },
    dataCatalog,
    leadsBySourceStatusOwner,
    leadAging,
    leadsCreatedDaily,
    pipelineByOwnerStatus,
    callbackPressureByOwner,
    leadFlow7d,
    sourceToStatus30d,
    callActionSplit30d,
    interestedToQualified30d,
    qualificationVelocityBySource90d,
    qualificationVelocityByOwner90d,
    meetingStageProgression90d,
    manualMeetingsByOwner30d,
    callHourly,
    callByOwnerOutcome,
    callActivityDaily,
    callHourlyByOwner,
    callWeekdayByOwner,
    repComparison7d,
    globalComparison,
    activityByHour,
    activityByOwner,
    activityByType30d,
    activityWeekdayByOwner30d,
    manualCallsByOwner,
    leadNotesByOwner30d,
    leadNoteThemes30d,
    activeTimeOff,
    quietHourActivityOverlap,
  };
}

async function askAnthropic({ question, history, bundle }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const configuredModel = String(process.env.ANTHROPIC_MODEL || '').trim();
  const modelCandidates = [
    configuredModel,
    'claude-sonnet-5',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5-20250929',
    'claude-3-7-sonnet-latest',
    'claude-3-5-sonnet-20241022',
  ].filter((v, i, arr) => v && arr.indexOf(v) === i);

  const systemPrompt = [
    'You are an internal analytics copilot for i3 Sales operations.',
    'You are talking to admins. Use only the provided data bundle and conversation context.',
    'You have broad multi-grain data: hourly, daily, weekly window comparisons, owner-level comparisons, source-level transitions, pipeline snapshots, meeting progression, note themes, activity blocks, and time-off.',
    'Always prefer the strongest evidence from the most relevant datasets and explicitly name which datasets were used.',
    'If data is missing, say exactly what is missing and why the conclusion is uncertain.',
    'Provide practical conclusions, anomalies, and actions.',
    'When asked about trends or drops, quantify with counts/percentages where possible.',
    'If asked for comparisons (e.g., Apollo vs outreach), use source-level evidence from the bundle.',
    'Output plain text only. Do not use markdown tables, code blocks, emojis, or heading markers.',
    'Use this exact section structure and order: Summary, Evidence, Comparisons, Actions, Data limits.',
    'Under Actions, provide exactly 3 numbered actions when enough evidence exists; otherwise provide 1-2 actions and explain why.',
  ].join(' ');

  const trimmedHistory = history.slice(-MAX_HISTORY).map((m) => ({
    role: m.role,
    content: [{ type: 'text', text: m.content }],
  }));

  const userPrompt = [
    'QUESTION:',
    question,
    '',
    'DATA_CATALOG_JSON:',
    JSON.stringify(bundle.dataCatalog || {}),
    '',
    'DATA_BUNDLE_JSON:',
    JSON.stringify(bundle),
  ].join('\n');

  const modelErrors = [];

  for (const model of modelCandidates) {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1400,
        temperature: 0.2,
        system: systemPrompt,
        messages: [...trimmedHistory, { role: 'user', content: [{ type: 'text', text: userPrompt }] }],
      }),
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : { error: { message: await response.text() } };

    if (response.ok) {
      const text = Array.isArray(payload?.content)
        ? payload.content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n\n').trim()
        : '';

      return {
        model: payload?.model || model,
        usage: payload?.usage || null,
        answer: normalizeAnswer(text || 'No response text returned by model.'),
      };
    }

    const message = String(payload?.error?.message || `Anthropic API request failed (${response.status})`);
    const lc = message.toLowerCase();
    const errType = String(payload?.error?.type || '').toLowerCase();
    const isModelError =
      lc.startsWith('model:') ||
      lc.includes('model ') ||
      lc.includes('model_') ||
      (lc.includes('model') && (lc.includes('not found') || lc.includes('invalid') || lc.includes('unsupported'))) ||
      (errType === 'invalid_request_error' && lc.includes('model'));

    modelErrors.push(`${model}: ${message}`);
    if (!isModelError) {
      throw new Error(message);
    }
  }

  throw new Error(`No supported Anthropic model available for this key. Tried: ${modelErrors.join(' | ')}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (requestBytes(req) > MAX_BODY_BYTES) {
    return res.status(413).json({ success: false, error: 'Request body too large' });
  }

  const identity = resolveIdentity(req);
  if (!identity) {
    return res.status(401).json({ success: false, error: 'Not signed in' });
  }
  if (!hasMinRole(identity, 'admin')) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const body = req.body || {};
  const question = String(body.question || '').trim();
  if (!question) {
    return res.status(400).json({ success: false, error: 'Question is required' });
  }

  let sql;
  try {
    sql = getSql();
    await initAuthTables();
    await initQueueTable();
    await initTimeOffTable();
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  try {
    const history = normalizeHistory(body.history);
    const bundle = await getDataBundle(sql);
    const result = await askAnthropic({ question, history, bundle });

    return res.status(200).json({
      success: true,
      answer: result.answer,
      model: result.model,
      usage: result.usage,
      generatedAt: bundle.generatedAt,
      dataHealth: bundle.dataHealth,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
