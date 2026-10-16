/** Open opportunities with no next step (no note, no future callback, no future meeting) for N days. */

export const STALE_DAYS = 3;

export async function findStaleOpportunities(sql, { days = STALE_DAYS } = {}) {
  const rows = await sql`
    SELECT q.id, q.name, q.company_name, q.owner, q.owner_id, COALESCE(q.opportunity_stage, 'qualified') AS stage,
           GREATEST(COALESCE(q.qualified_at, q.created_at), COALESCE(ev.last_at, 'epoch'::timestamptz)) AS planned_at
    FROM queue_leads q
    LEFT JOIN LATERAL (
      SELECT MAX(e.created_at) AS last_at FROM queue_events e
      WHERE e.lead_id = q.id AND e.event_type IN ('opportunity_stage', 'opportunity_followup')
    ) ev ON TRUE
    WHERE q.archived_at IS NULL AND q.status = 'qualified'
      AND COALESCE(q.opportunity_stage, 'qualified') NOT IN ('won', 'lost', 'limbo')
      AND COALESCE(NULLIF(BTRIM(q.next_step_summary), ''), '') = ''
      AND COALESCE(q.callback_at, 'epoch'::timestamptz) <= now()
      AND COALESCE(q.meeting_scheduled_at, 'epoch'::timestamptz) <= now()
      AND NOT EXISTS (SELECT 1 FROM opportunity_meetings m WHERE m.lead_id = q.id AND m.status = 'scheduled' AND m.scheduled_for > now())
      AND GREATEST(COALESCE(q.qualified_at, q.created_at), COALESCE(ev.last_at, 'epoch'::timestamptz)) < now() - (${days}::int * interval '1 day')
    ORDER BY planned_at ASC
  `;
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    name: r.name || '',
    company: r.company_name || '',
    owner: r.owner || 'Unassigned',
    ownerId: r.owner_id || null,
    stage: r.stage,
    days: Math.max(days, Math.floor((now - new Date(r.planned_at).getTime()) / 86400000)),
  }));
}
