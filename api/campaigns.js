import { getSql, initAuthTables, initQueueTable, isEmailSuppressed, writeAudit } from './db.js';
import { hasMinRole, resolveIdentity } from './session.js';

const MAX_BODY_BYTES = 512 * 1024;
const CAMPAIGN_STATUSES = new Set(['draft', 'active', 'paused', 'archived']);
const ENROLLMENT_STATUSES = new Set(['active', 'paused', 'stopped', 'completed']);
const MAX_STEPS = 30;

function bodySize(req) {
  const declared = Number.parseInt(req.headers?.['content-length'] || '0', 10);
  return Number.isFinite(declared) && declared > 0 ? declared : Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
}

function text(value, max = 10000) {
  return String(value ?? '').trim().slice(0, max);
}

function int(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function serializeCampaign(row, steps = []) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    campaignType: row.campaign_type,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activatedAt: row.activated_at,
    pausedAt: row.paused_at,
    archivedAt: row.archived_at,
    steps: steps.map(serializeStep),
  };
}

function serializeStep(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    stepOrder: row.step_order,
    stepName: row.step_name,
    subjectTemplate: row.subject_template,
    bodyTemplate: row.body_template,
    waitDays: row.wait_days,
    sendHour: row.send_hour,
    sendTimezone: row.send_timezone,
    active: row.active,
  };
}

function serializeEnrollment(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    leadId: row.lead_id,
    leadName: row.lead_name || null,
    companyName: row.company_name || null,
    email: row.email || null,
    ownerId: row.owner_id || null,
    status: row.status,
    currentStep: row.current_step,
    nextStepDue: row.next_step_due,
    enrolledAt: row.enrolled_at,
    lastSentAt: row.last_sent_at,
    lastEventAt: row.last_event_at,
    lastEventType: row.last_event_type,
    pausedAt: row.paused_at,
    pausedReason: row.paused_reason,
    stoppedAt: row.stopped_at,
    stoppedReason: row.stopped_reason,
  };
}

function validateStep(input, index) {
  const stepOrder = int(input.stepOrder, index + 1);
  const sendHour = int(input.sendHour, 9);
  const waitDays = int(input.waitDays, 0);
  if (stepOrder < 1 || stepOrder > MAX_STEPS) throw new Error(`Step ${index + 1} has an invalid order`);
  if (!text(input.stepName, 160)) throw new Error(`Step ${index + 1} needs a name`);
  if (!text(input.subjectTemplate, 500)) throw new Error(`Step ${index + 1} needs a subject`);
  if (!text(input.bodyTemplate, 50000)) throw new Error(`Step ${index + 1} needs a body`);
  if (waitDays < 0 || waitDays > 365) throw new Error(`Step ${index + 1} has an invalid wait period`);
  if (sendHour < 0 || sendHour > 23) throw new Error(`Step ${index + 1} has an invalid send hour`);
  return {
    stepOrder,
    stepName: text(input.stepName, 160),
    subjectTemplate: text(input.subjectTemplate, 500),
    bodyTemplate: text(input.bodyTemplate, 50000),
    waitDays,
    sendHour,
    sendTimezone: text(input.sendTimezone || 'Europe/London', 80) || 'Europe/London',
    active: input.active !== false,
  };
}

async function loadCampaign(sql, id) {
  const campaigns = await sql`SELECT * FROM email_campaigns WHERE id = ${id} LIMIT 1`;
  if (!campaigns[0]) return null;
  const steps = await sql`SELECT * FROM email_campaign_steps WHERE campaign_id = ${id} ORDER BY step_order ASC`;
  return serializeCampaign(campaigns[0], steps);
}

async function requireAdmin(identity) {
  if (!identity || !hasMinRole(identity, 'admin')) throw Object.assign(new Error('Admin access required'), { status: 403 });
}

async function writeCampaignAudit(sql, identity, event, campaignId, meta = {}) {
  await writeAudit(sql, {
    actorEmail: identity.email,
    actorRole: identity.role,
    event,
    target: `campaign:${campaignId}`,
    meta,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (bodySize(req) > MAX_BODY_BYTES) return res.status(413).json({ success: false, error: 'Request body too large' });

  const identity = resolveIdentity(req);
  if (!identity || !identity.email || identity.email === 'system') return res.status(401).json({ success: false, error: 'Not signed in' });

  try {
    const sql = getSql();
    await initAuthTables();
    await initQueueTable();
    const body = req.body || {};
    const action = text(body.action || 'list').toLowerCase();

    if (action === 'list') {
      const rows = await sql`
        SELECT c.*, COUNT(e.id)::int AS enrollment_count
        FROM email_campaigns c
        LEFT JOIN email_campaign_enrollments e ON e.campaign_id = c.id
        WHERE c.status <> 'archived'
        GROUP BY c.id
        ORDER BY c.updated_at DESC
      `;
      return res.status(200).json({ success: true, campaigns: rows.map((row) => ({ ...serializeCampaign(row), enrollmentCount: row.enrollment_count })) });
    }

    if (action === 'get') {
      const campaign = await loadCampaign(sql, int(body.id));
      if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });
      return res.status(200).json({ success: true, campaign });
    }

    await requireAdmin(identity);

    if (action === 'create') {
      const name = text(body.name, 160);
      if (!name) return res.status(400).json({ success: false, error: 'Campaign name is required' });
      const rows = await sql`
        INSERT INTO email_campaigns (name, description, campaign_type, status, created_by_user_id)
        VALUES (${name}, ${text(body.description, 2000) || null}, ${text(body.campaignType || 'growth', 40)}, 'draft', ${identity.uid || null})
        RETURNING *
      `;
      await writeCampaignAudit(sql, identity, 'campaign_created', rows[0].id);
      return res.status(201).json({ success: true, campaign: serializeCampaign(rows[0]) });
    }

    const campaignId = int(body.id);
    if (!campaignId) return res.status(400).json({ success: false, error: 'Campaign id is required' });
    const existing = await loadCampaign(sql, campaignId);
    if (!existing) return res.status(404).json({ success: false, error: 'Campaign not found' });

    if (action === 'update') {
      if (existing.status === 'archived') return res.status(409).json({ success: false, error: 'Archived campaigns cannot be edited' });
      const rows = await sql`
        UPDATE email_campaigns
        SET name = ${text(body.name || existing.name, 160)},
            description = ${text(body.description ?? existing.description, 2000) || null},
            updated_at = now()
        WHERE id = ${campaignId}
        RETURNING *
      `;
      await writeCampaignAudit(sql, identity, 'campaign_updated', campaignId);
      return res.status(200).json({ success: true, campaign: await loadCampaign(sql, rows[0].id) });
    }

    if (action === 'save-steps') {
      if (existing.status === 'archived' || existing.status === 'active') return res.status(409).json({ success: false, error: 'Pause the campaign before editing active steps' });
      if (!Array.isArray(body.steps) || !body.steps.length || body.steps.length > MAX_STEPS) return res.status(400).json({ success: false, error: `Provide between 1 and ${MAX_STEPS} steps` });
      const steps = body.steps.map(validateStep).sort((a, b) => a.stepOrder - b.stepOrder);
      if (new Set(steps.map((step) => step.stepOrder)).size !== steps.length) return res.status(400).json({ success: false, error: 'Step order must be unique' });
      await sql`DELETE FROM email_campaign_steps WHERE campaign_id = ${campaignId}`;
      for (const step of steps) {
        await sql`
          INSERT INTO email_campaign_steps (campaign_id, step_order, step_name, subject_template, body_template, wait_days, send_hour, send_timezone, active)
          VALUES (${campaignId}, ${step.stepOrder}, ${step.stepName}, ${step.subjectTemplate}, ${step.bodyTemplate}, ${step.waitDays}, ${step.sendHour}, ${step.sendTimezone}, ${step.active})
        `;
      }
      await sql`UPDATE email_campaigns SET updated_at = now() WHERE id = ${campaignId}`;
      await writeCampaignAudit(sql, identity, 'campaign_steps_saved', campaignId, { stepCount: steps.length });
      return res.status(200).json({ success: true, campaign: await loadCampaign(sql, campaignId) });
    }

    if (action === 'activate') {
      const steps = existing.steps.filter((step) => step.active);
      if (!steps.length) return res.status(400).json({ success: false, error: 'Add at least one active step before activating' });
      const orders = steps.map((step) => step.stepOrder);
      if (orders[0] !== 1 || orders.some((order, index) => index > 0 && order !== orders[index - 1] + 1)) return res.status(400).json({ success: false, error: 'Active steps must be numbered consecutively from 1' });
      const rows = await sql`
        UPDATE email_campaigns SET status = 'active', activated_at = COALESCE(activated_at, now()), paused_at = NULL, updated_at = now()
        WHERE id = ${campaignId} AND status <> 'archived' RETURNING *
      `;
      await writeCampaignAudit(sql, identity, 'campaign_activated', campaignId);
      return res.status(200).json({ success: true, campaign: await loadCampaign(sql, rows[0].id) });
    }

    if (action === 'pause' || action === 'archive') {
      const status = action === 'pause' ? 'paused' : 'archived';
      const rows = await sql`
        UPDATE email_campaigns SET status = ${status}, paused_at = CASE WHEN ${status} = 'paused' THEN now() ELSE paused_at END, archived_at = CASE WHEN ${status} = 'archived' THEN now() ELSE archived_at END, updated_at = now()
        WHERE id = ${campaignId} RETURNING *
      `;
      if (status === 'paused') await sql`UPDATE email_campaign_enrollments SET status = 'paused', paused_at = now(), paused_reason = 'campaign_paused', updated_at = now() WHERE campaign_id = ${campaignId} AND status = 'active'`;
      if (status === 'archived') await sql`UPDATE email_campaign_enrollments SET status = 'stopped', stopped_at = now(), stopped_reason = 'campaign_archived', updated_at = now() WHERE campaign_id = ${campaignId} AND status IN ('active', 'paused')`;
      await writeCampaignAudit(sql, identity, `campaign_${status}`, campaignId);
      return res.status(200).json({ success: true, campaign: await loadCampaign(sql, rows[0].id) });
    }

    if (action === 'clone') {
      const name = text(body.name, 160) || `${existing.name} copy`;
      const campaigns = await sql`
        INSERT INTO email_campaigns (name, description, campaign_type, status, created_by_user_id)
        VALUES (${name}, ${existing.description || null}, ${existing.campaignType}, 'draft', ${identity.uid || null}) RETURNING *
      `;
      for (const step of existing.steps) {
        await sql`
          INSERT INTO email_campaign_steps (campaign_id, step_order, step_name, subject_template, body_template, wait_days, send_hour, send_timezone, active)
          VALUES (${campaigns[0].id}, ${step.stepOrder}, ${step.stepName}, ${step.subjectTemplate}, ${step.bodyTemplate}, ${step.waitDays}, ${step.sendHour}, ${step.sendTimezone}, ${step.active})
        `;
      }
      await writeCampaignAudit(sql, identity, 'campaign_cloned', campaigns[0].id, { sourceCampaignId: campaignId });
      return res.status(201).json({ success: true, campaign: await loadCampaign(sql, campaigns[0].id) });
    }

    if (action === 'enroll') {
      const leadIds = (Array.isArray(body.leadIds) ? body.leadIds : [body.leadId])
        .map((value) => int(value))
        .filter((value) => value > 0);
      if (!leadIds.length) return res.status(400).json({ success: false, error: 'Lead id(s) required' });
      const leads = await sql`SELECT id, first_name, name, company_name, email, owner_id, archived_at, status FROM queue_leads WHERE id = ANY(${leadIds})`;
      const results = [];
      for (const lead of leads) {
        if (lead.archived_at) { results.push({ leadId: lead.id, status: 'blocked', reason: 'archived' }); continue; }
        if (!lead.email) { results.push({ leadId: lead.id, status: 'blocked', reason: 'missing_email' }); continue; }
        if (identity.role === 'rep' && String(lead.owner_id || '') !== String(identity.ghlOwnerId || '')) { results.push({ leadId: lead.id, status: 'blocked', reason: 'not_owner' }); continue; }
        if (await isEmailSuppressed(sql, lead.email)) { results.push({ leadId: lead.id, status: 'blocked', reason: 'suppressed' }); continue; }
        const enrollment = await sql`
          INSERT INTO email_campaign_enrollments (campaign_id, lead_id, status, current_step, next_step_due)
          VALUES (${campaignId}, ${lead.id}, 'active', 0, now())
          ON CONFLICT (campaign_id, lead_id) DO NOTHING
          RETURNING id
        `;
        results.push({ leadId: lead.id, status: enrollment[0] ? 'enrolled' : 'already_enrolled', enrollmentId: enrollment[0]?.id || null });
      }
      await writeCampaignAudit(sql, identity, 'campaign_leads_enrolled', campaignId, { results });
      return res.status(200).json({ success: true, results });
    }

    if (action === 'enrollments') {
      const rows = await sql`
        SELECT e.*, l.name AS lead_name, l.company_name, l.email, l.owner_id
        FROM email_campaign_enrollments e
        JOIN queue_leads l ON l.id = e.lead_id
        WHERE e.campaign_id = ${campaignId}
        ORDER BY e.updated_at DESC
      `;
      return res.status(200).json({ success: true, enrollments: rows.map(serializeEnrollment) });
    }

    if (['pause-enrollment', 'resume-enrollment', 'stop-enrollment'].includes(action)) {
      const enrollmentId = int(body.enrollmentId);
      if (!enrollmentId) return res.status(400).json({ success: false, error: 'Enrollment id is required' });
      const status = action === 'pause-enrollment' ? 'paused' : action === 'resume-enrollment' ? 'active' : 'stopped';
      const rows = await sql`
        UPDATE email_campaign_enrollments
        SET status = ${status},
            paused_at = CASE WHEN ${status} = 'paused' THEN now() ELSE NULL END,
            paused_reason = CASE WHEN ${status} = 'paused' THEN 'manual' ELSE NULL END,
            stopped_at = CASE WHEN ${status} = 'stopped' THEN now() ELSE NULL END,
            stopped_reason = CASE WHEN ${status} = 'stopped' THEN 'manual' ELSE NULL END,
            next_step_due = CASE WHEN ${status} = 'active' THEN COALESCE(next_step_due, now()) ELSE next_step_due END,
            updated_at = now()
        WHERE id = ${enrollmentId} AND campaign_id = ${campaignId}
        RETURNING *
      `;
      if (!rows[0]) return res.status(404).json({ success: false, error: 'Enrollment not found' });
      await writeCampaignAudit(sql, identity, `campaign_enrollment_${status}`, campaignId, { enrollmentId });
      return res.status(200).json({ success: true, enrollment: serializeEnrollment(rows[0]) });
    }

    if (action === 'report') {
      const rows = await sql`SELECT status, COUNT(*)::int AS count FROM email_campaign_enrollments WHERE campaign_id = ${campaignId} GROUP BY status ORDER BY status`;
      const sends = await sql`SELECT s.status, COUNT(*)::int AS count FROM email_campaign_sends s JOIN email_campaign_enrollments e ON e.id = s.enrollment_id WHERE e.campaign_id = ${campaignId} GROUP BY s.status ORDER BY s.status`;
      return res.status(200).json({ success: true, enrollmentStatuses: rows, sendStatuses: sends });
    }

    return res.status(400).json({ success: false, error: 'Unknown campaign action' });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.message });
  }
}
