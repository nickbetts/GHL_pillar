import { getSql, initAuthTables, initQueueTable, isEmailSuppressed, writeAudit } from './db.js';
import { hasMinRole, resolveIdentity } from './session.js';
import { GENERAL_VARIANTS, composeTemplate } from '../email-template-data.js';

const MAX_BODY_BYTES = 512 * 1024;
const CAMPAIGN_STATUSES = new Set(['draft', 'active', 'paused', 'archived']);
const ENROLLMENT_STATUSES = new Set(['active', 'paused', 'stopped', 'completed']);
const MAX_STEPS = 30;
const RULE_MATCH_LOGIC = new Set(['all', 'any']);
const TRIGGER_FIELDS = new Set(['queue_status', 'sector', 'sub_sector']);
const STOP_FIELDS = new Set(['disposition']);
const RULE_OPERATORS = new Set(['equals', 'in']);

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

function normalizeRuleValue(operator, rawValue) {
  if (operator === 'in') {
    const items = Array.isArray(rawValue)
      ? rawValue
      : String(rawValue ?? '')
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean);
    return items.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  }
  return String(rawValue ?? '').trim().toLowerCase();
}

function normalizeRule(input, index, type = 'trigger') {
  const field = text(input?.field || '', 80).toLowerCase();
  const operator = text(input?.operator || 'equals', 20).toLowerCase();
  const active = input?.active !== false;
  const sortOrder = int(input?.sortOrder, index + 1);
  const allowed = type === 'stop' ? STOP_FIELDS : TRIGGER_FIELDS;
  if (!allowed.has(field)) throw new Error(`Rule ${index + 1} uses an unsupported field: ${field}`);
  if (!RULE_OPERATORS.has(operator)) throw new Error(`Rule ${index + 1} uses an unsupported operator: ${operator}`);
  const normalizedValue = normalizeRuleValue(operator, input?.value);
  if (operator === 'in' && (!Array.isArray(normalizedValue) || !normalizedValue.length)) {
    throw new Error(`Rule ${index + 1} needs at least one value`);
  }
  if (operator === 'equals' && !String(normalizedValue || '').trim()) {
    throw new Error(`Rule ${index + 1} needs a value`);
  }
  return {
    ruleType: type,
    fieldName: field,
    operator,
    valueText: operator === 'equals' ? String(normalizedValue) : null,
    valueJson: operator === 'in' ? normalizedValue : null,
    active,
    sortOrder,
  };
}

async function loadCampaignRules(sql, campaignId) {
  const rows = await sql`
    SELECT id, rule_type, field_name, operator, value_text, value_json, sort_order, active
    FROM email_campaign_trigger_rules
    WHERE campaign_id = ${campaignId}
    ORDER BY sort_order ASC, id ASC
  `;
  return rows.map((row) => ({
    id: row.id,
    ruleType: row.rule_type,
    field: row.field_name,
    operator: row.operator,
    value: row.operator === 'in' ? (Array.isArray(row.value_json) ? row.value_json : []) : row.value_text,
    active: row.active,
    sortOrder: row.sort_order,
  }));
}

async function loadCampaignRuleSet(sql, campaignId) {
  const rows = await sql`
    SELECT campaign_id, match_logic, include_existing_on_activate, continuous_enroll, auto_stop_enabled
    FROM email_campaign_rule_sets
    WHERE campaign_id = ${campaignId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return {
      matchLogic: 'all',
      includeExistingOnActivate: false,
      continuousEnroll: false,
      autoStopEnabled: false,
    };
  }
  return {
    matchLogic: row.match_logic,
    includeExistingOnActivate: row.include_existing_on_activate,
    continuousEnroll: row.continuous_enroll,
    autoStopEnabled: row.auto_stop_enabled,
  };
}

function leadFieldValue(lead, field) {
  if (field === 'queue_status') return String(lead.status || '').trim().toLowerCase();
  if (field === 'sector') return String(lead.sector || '').trim().toLowerCase();
  if (field === 'sub_sector') return String(lead.sub_sector || '').trim().toLowerCase();
  if (field === 'disposition') return String(lead.disposition || '').trim().toLowerCase();
  return '';
}

function evaluateRule(rule, lead) {
  const actual = leadFieldValue(lead, rule.field);
  if (!actual) return false;
  if (rule.operator === 'equals') {
    return actual === String(rule.value || '').trim().toLowerCase();
  }
  if (rule.operator === 'in') {
    const values = Array.isArray(rule.value) ? rule.value.map((item) => String(item).trim().toLowerCase()) : [];
    return values.includes(actual);
  }
  return false;
}

function ruleMatchesLead(lead, rules, matchLogic) {
  const activeRules = rules.filter((rule) => rule.active !== false);
  if (!activeRules.length) return false;
  if (matchLogic === 'any') return activeRules.some((rule) => evaluateRule(rule, lead));
  return activeRules.every((rule) => evaluateRule(rule, lead));
}

async function findMatchingLeads(sql, campaignId, triggerRules, matchLogic, options = {}) {
  const stopRules = Array.isArray(options.stopRules) ? options.stopRules.filter((rule) => rule.active !== false) : [];
  const autoStopEnabled = options.autoStopEnabled === true;
  const candidates = await sql`
    SELECT id, status, sector, sub_sector, disposition, email, archived_at
    FROM queue_leads
    WHERE archived_at IS NULL
      AND COALESCE(email, '') <> ''
      AND id NOT IN (
        SELECT lead_id FROM email_campaign_enrollments WHERE campaign_id = ${campaignId}
      )
    ORDER BY id DESC
    LIMIT 20000
  `;
  return candidates.filter((lead) => {
    if (!ruleMatchesLead(lead, triggerRules, matchLogic)) return false;
    if (autoStopEnabled && stopRules.length && ruleMatchesLead(lead, stopRules, matchLogic)) return false;
    return true;
  });
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
    sendMinute: row.send_minute,
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
    enrolledVia: row.enrolled_via || 'manual',
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
  const sendMinute = int(input.sendMinute, 0);
  const waitDays = int(input.waitDays, 0);
  if (stepOrder < 1 || stepOrder > MAX_STEPS) throw new Error(`Step ${index + 1} has an invalid order`);
  if (!text(input.stepName, 160)) throw new Error(`Step ${index + 1} needs a name`);
  if (!text(input.subjectTemplate, 500)) throw new Error(`Step ${index + 1} needs a subject`);
  if (!text(input.bodyTemplate, 50000)) throw new Error(`Step ${index + 1} needs a body`);
  if (waitDays < 0 || waitDays > 365) throw new Error(`Step ${index + 1} has an invalid wait period`);
  if (sendHour < 0 || sendHour > 23) throw new Error(`Step ${index + 1} has an invalid send hour`);
  if (sendMinute < 0 || sendMinute > 59) throw new Error(`Step ${index + 1} has an invalid send minute`);
  return {
    stepOrder,
    stepName: text(input.stepName, 160),
    subjectTemplate: text(input.subjectTemplate, 500),
    bodyTemplate: text(input.bodyTemplate, 50000),
    waitDays,
    sendHour,
    sendMinute,
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

    const adminActions = new Set([
      'create',
      'seed-growth',
      'update',
      'save-steps',
      'activate',
      'pause',
      'archive',
      'clone',
      'get-rules',
      'save-rules',
      'preview-rule-matches',
      'run-backfill',
    ]);
    if (adminActions.has(action)) await requireAdmin(identity);

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

    if (action === 'seed-growth') {
      const existingGrowth = await sql`SELECT id FROM email_campaigns WHERE name = 'I3 Growth LP - General sequence' AND status <> 'archived' ORDER BY id DESC LIMIT 1`;
      if (existingGrowth[0]) return res.status(200).json({ success: true, created: false, campaign: await loadCampaign(sql, existingGrowth[0].id) });
      const campaigns = await sql`
        INSERT INTO email_campaigns (name, description, campaign_type, status, created_by_user_id)
        VALUES ('I3 Growth LP - General sequence', 'Generic post-call Growth sequence for inbound leads.', 'growth', 'draft', ${identity.uid || null})
        ON CONFLICT (lower(name)) WHERE status <> 'archived' DO NOTHING
        RETURNING *
      `;
      if (!campaigns[0]) {
        const existingSeed = await sql`SELECT * FROM email_campaigns WHERE lower(name) = lower('I3 Growth LP - General sequence') AND status <> 'archived' ORDER BY id DESC LIMIT 1`;
        return res.status(200).json({ success: true, created: false, campaign: await loadCampaign(sql, existingSeed[0].id) });
      }
      for (const [index, variant] of GENERAL_VARIANTS.entries()) {
        const template = composeTemplate('All sectors', variant.key);
        await sql`
          INSERT INTO email_campaign_steps (campaign_id, step_order, step_name, subject_template, body_template, wait_days, send_hour, send_minute, send_timezone, active)
          VALUES (${campaigns[0].id}, ${index + 1}, ${variant.label}, ${template.subject}, ${template.body}, ${index === 0 ? 0 : index === 1 ? 2 : 3}, 9, 0, 'Europe/London', TRUE)
        `;
      }
      await writeCampaignAudit(sql, identity, 'campaign_growth_seeded', campaigns[0].id, { stepCount: GENERAL_VARIANTS.length });
      return res.status(201).json({ success: true, created: true, campaign: await loadCampaign(sql, campaigns[0].id) });
    }

    const campaignId = int(body.id);
    if (!campaignId) return res.status(400).json({ success: false, error: 'Campaign id is required' });
    const existing = await loadCampaign(sql, campaignId);
    if (!existing) return res.status(404).json({ success: false, error: 'Campaign not found' });

    if (action === 'get-rules') {
      const rules = await loadCampaignRules(sql, campaignId);
      const ruleSet = await loadCampaignRuleSet(sql, campaignId);
      return res.status(200).json({
        success: true,
        triggerRules: rules.filter((rule) => rule.ruleType === 'trigger'),
        stopRules: rules.filter((rule) => rule.ruleType === 'stop'),
        ruleSet,
      });
    }

    if (action === 'save-rules') {
      if (existing.status === 'archived') return res.status(409).json({ success: false, error: 'Archived campaigns cannot be edited' });
      const triggerInput = Array.isArray(body.triggerRules) ? body.triggerRules : [];
      const stopInput = Array.isArray(body.stopRules) ? body.stopRules : [];
      const triggerRules = triggerInput.map((rule, index) => normalizeRule(rule, index, 'trigger'));
      const stopRules = stopInput.map((rule, index) => normalizeRule(rule, index, 'stop'));
      const matchLogic = text(body.matchLogic || 'all', 10).toLowerCase();
      if (!RULE_MATCH_LOGIC.has(matchLogic)) return res.status(400).json({ success: false, error: 'Match logic must be all or any' });
      const includeExistingOnActivate = body.includeExistingOnActivate === true;
      const continuousEnroll = body.continuousEnroll === true;
      const autoStopEnabled = body.autoStopEnabled === true;
      if (continuousEnroll && !triggerRules.length) {
        return res.status(400).json({ success: false, error: 'Add at least one trigger rule before enabling continuous enrollment' });
      }

      await sql`DELETE FROM email_campaign_trigger_rules WHERE campaign_id = ${campaignId}`;
      for (const rule of [...triggerRules, ...stopRules]) {
        await sql`
          INSERT INTO email_campaign_trigger_rules (campaign_id, rule_type, field_name, operator, value_text, value_json, sort_order, active)
          VALUES (${campaignId}, ${rule.ruleType}, ${rule.fieldName}, ${rule.operator}, ${rule.valueText}, ${rule.valueJson ? JSON.stringify(rule.valueJson) : null}, ${rule.sortOrder}, ${rule.active})
        `;
      }
      await sql`
        INSERT INTO email_campaign_rule_sets (campaign_id, match_logic, include_existing_on_activate, continuous_enroll, auto_stop_enabled, updated_at)
        VALUES (${campaignId}, ${matchLogic}, ${includeExistingOnActivate}, ${continuousEnroll}, ${autoStopEnabled}, now())
        ON CONFLICT (campaign_id) DO UPDATE SET
          match_logic = EXCLUDED.match_logic,
          include_existing_on_activate = EXCLUDED.include_existing_on_activate,
          continuous_enroll = EXCLUDED.continuous_enroll,
          auto_stop_enabled = EXCLUDED.auto_stop_enabled,
          updated_at = now()
      `;

      await writeCampaignAudit(sql, identity, 'campaign_rules_saved', campaignId, {
        triggerRules: triggerRules.length,
        stopRules: stopRules.length,
        matchLogic,
        includeExistingOnActivate,
        continuousEnroll,
        autoStopEnabled,
      });

      const savedRules = await loadCampaignRules(sql, campaignId);
      const ruleSet = await loadCampaignRuleSet(sql, campaignId);
      return res.status(200).json({
        success: true,
        triggerRules: savedRules.filter((rule) => rule.ruleType === 'trigger'),
        stopRules: savedRules.filter((rule) => rule.ruleType === 'stop'),
        ruleSet,
      });
    }

    if (action === 'preview-rule-matches') {
      const rules = await loadCampaignRules(sql, campaignId);
      const triggerRules = rules.filter((rule) => rule.ruleType === 'trigger');
      if (!triggerRules.length) return res.status(200).json({ success: true, count: 0, leads: [] });
      const ruleSet = await loadCampaignRuleSet(sql, campaignId);
      const stopRules = rules.filter((rule) => rule.ruleType === 'stop');
      const matches = await findMatchingLeads(sql, campaignId, triggerRules, ruleSet.matchLogic, {
        stopRules,
        autoStopEnabled: ruleSet.autoStopEnabled,
      });
      const leadIds = matches.slice(0, 50).map((lead) => Number(lead.id));
      const leads = leadIds.length
        ? await sql`SELECT id, name, company_name, email, owner_id, status, sector, sub_sector FROM queue_leads WHERE id = ANY(${leadIds}) ORDER BY id DESC`
        : [];
      return res.status(200).json({ success: true, count: matches.length, leads });
    }

    if (action === 'run-backfill') {
      const rules = await loadCampaignRules(sql, campaignId);
      const triggerRules = rules.filter((rule) => rule.ruleType === 'trigger');
      if (!triggerRules.length) return res.status(200).json({ success: true, enrolled: 0, skipped: 0, reason: 'no_rules' });
      const ruleSet = await loadCampaignRuleSet(sql, campaignId);
      const stopRules = rules.filter((rule) => rule.ruleType === 'stop');
      const matches = await findMatchingLeads(sql, campaignId, triggerRules, ruleSet.matchLogic, {
        stopRules,
        autoStopEnabled: ruleSet.autoStopEnabled,
      });
      const cap = Math.max(1, Math.min(5000, int(body.maxLeads, 500)));
      const sample = matches.slice(0, cap);
      let enrolled = 0;
      let skipped = 0;
      for (const lead of sample) {
        if (!lead.email) { skipped += 1; continue; }
        if (await isEmailSuppressed(sql, lead.email)) { skipped += 1; continue; }
        const rows = await sql`
          INSERT INTO email_campaign_enrollments (campaign_id, lead_id, status, enrolled_via, current_step, next_step_due)
          VALUES (${campaignId}, ${lead.id}, 'active', 'backfill', 0, now())
          ON CONFLICT (campaign_id, lead_id) DO NOTHING
          RETURNING id
        `;
        if (rows[0]) enrolled += 1;
        else skipped += 1;
      }
      await writeCampaignAudit(sql, identity, 'campaign_rules_backfill_run', campaignId, {
        matched: matches.length,
        processed: sample.length,
        enrolled,
        skipped,
        cap,
      });
      return res.status(200).json({ success: true, matched: matches.length, processed: sample.length, enrolled, skipped, cap });
    }

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
      const historicalSends = await sql`SELECT 1 FROM email_campaign_sends s JOIN email_campaign_enrollments e ON e.id = s.enrollment_id WHERE e.campaign_id = ${campaignId} LIMIT 1`;
      if (historicalSends.length) return res.status(409).json({ success: false, error: 'This campaign has send history and its steps are locked' });
      if (!Array.isArray(body.steps) || !body.steps.length || body.steps.length > MAX_STEPS) return res.status(400).json({ success: false, error: `Provide between 1 and ${MAX_STEPS} steps` });
      const steps = body.steps.map(validateStep).sort((a, b) => a.stepOrder - b.stepOrder);
      if (new Set(steps.map((step) => step.stepOrder)).size !== steps.length) return res.status(400).json({ success: false, error: 'Step order must be unique' });
      await sql`DELETE FROM email_campaign_steps WHERE campaign_id = ${campaignId}`;
      for (const step of steps) {
        await sql`
          INSERT INTO email_campaign_steps (campaign_id, step_order, step_name, subject_template, body_template, wait_days, send_hour, send_minute, send_timezone, active)
          VALUES (${campaignId}, ${step.stepOrder}, ${step.stepName}, ${step.subjectTemplate}, ${step.bodyTemplate}, ${step.waitDays}, ${step.sendHour}, ${step.sendMinute}, ${step.sendTimezone}, ${step.active})
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

      const ruleSet = await loadCampaignRuleSet(sql, campaignId);
      let backfillResult = null;
      if (ruleSet.includeExistingOnActivate || body.includeExistingOnActivate === true) {
        const rules = await loadCampaignRules(sql, campaignId);
        const triggerRules = rules.filter((rule) => rule.ruleType === 'trigger');
        const stopRules = rules.filter((rule) => rule.ruleType === 'stop');
        if (triggerRules.length) {
          const matches = await findMatchingLeads(sql, campaignId, triggerRules, ruleSet.matchLogic, {
            stopRules,
            autoStopEnabled: ruleSet.autoStopEnabled,
          });
          const cap = 5000;
          let enrolled = 0;
          let skipped = 0;
          for (const lead of matches.slice(0, cap)) {
            if (!lead.email) { skipped += 1; continue; }
            if (await isEmailSuppressed(sql, lead.email)) { skipped += 1; continue; }
            const rows = await sql`
              INSERT INTO email_campaign_enrollments (campaign_id, lead_id, status, enrolled_via, current_step, next_step_due)
              VALUES (${campaignId}, ${lead.id}, 'active', 'backfill', 0, now())
              ON CONFLICT (campaign_id, lead_id) DO NOTHING
              RETURNING id
            `;
            if (rows[0]) enrolled += 1;
            else skipped += 1;
          }
          backfillResult = { matched: matches.length, enrolled, skipped, cap };
        }
      }

      const rows = await sql`
        UPDATE email_campaigns SET status = 'active', activated_at = COALESCE(activated_at, now()), paused_at = NULL, updated_at = now()
        WHERE id = ${campaignId} AND status <> 'archived' RETURNING *
      `;
      await writeCampaignAudit(sql, identity, 'campaign_activated', campaignId, { backfillResult });
      return res.status(200).json({ success: true, campaign: await loadCampaign(sql, rows[0].id), backfillResult });
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
          INSERT INTO email_campaign_steps (campaign_id, step_order, step_name, subject_template, body_template, wait_days, send_hour, send_minute, send_timezone, active)
          VALUES (${campaigns[0].id}, ${step.stepOrder}, ${step.stepName}, ${step.subjectTemplate}, ${step.bodyTemplate}, ${step.waitDays}, ${step.sendHour}, ${step.sendMinute}, ${step.sendTimezone}, ${step.active})
        `;
      }
      await writeCampaignAudit(sql, identity, 'campaign_cloned', campaigns[0].id, { sourceCampaignId: campaignId });
      return res.status(201).json({ success: true, campaign: await loadCampaign(sql, campaigns[0].id) });
    }

    if (action === 'enroll') {
      if (existing.status !== 'active') return res.status(409).json({ success: false, error: 'Only active campaigns can enroll leads' });
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
          INSERT INTO email_campaign_enrollments (campaign_id, lead_id, status, enrolled_via, current_step, next_step_due)
          VALUES (${campaignId}, ${lead.id}, 'active', 'manual', 0, now())
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
          AND (${identity.role !== 'rep'} OR l.owner_id = ${identity.ghlOwnerId || null})
        ORDER BY e.updated_at DESC
      `;
      return res.status(200).json({ success: true, enrollments: rows.map(serializeEnrollment) });
    }

    if (['pause-enrollment', 'resume-enrollment', 'stop-enrollment'].includes(action)) {
      const enrollmentId = int(body.enrollmentId);
      if (!enrollmentId) return res.status(400).json({ success: false, error: 'Enrollment id is required' });
      const status = action === 'pause-enrollment' ? 'paused' : action === 'resume-enrollment' ? 'active' : 'stopped';
      const rows = await sql`
        UPDATE email_campaign_enrollments AS e
        SET status = ${status},
            paused_at = CASE WHEN ${status} = 'paused' THEN now() ELSE NULL END,
            paused_reason = CASE WHEN ${status} = 'paused' THEN 'manual' ELSE NULL END,
            stopped_at = CASE WHEN ${status} = 'stopped' THEN now() ELSE NULL END,
            stopped_reason = CASE WHEN ${status} = 'stopped' THEN 'manual' ELSE NULL END,
            next_step_due = CASE WHEN ${status} = 'active' THEN COALESCE(next_step_due, now()) ELSE next_step_due END,
            updated_at = now()
        WHERE e.id = ${enrollmentId} AND e.campaign_id = ${campaignId}
          AND (${identity.role !== 'rep'} OR EXISTS (SELECT 1 FROM queue_leads l WHERE l.id = e.lead_id AND l.owner_id = ${identity.ghlOwnerId || null}))
        RETURNING *
      `;
      if (!rows[0]) return res.status(404).json({ success: false, error: 'Enrollment not found' });
      await writeCampaignAudit(sql, identity, `campaign_enrollment_${status}`, campaignId, { enrollmentId });
      return res.status(200).json({ success: true, enrollment: serializeEnrollment(rows[0]) });
    }

    if (action === 'report') {
      const rows = await sql`SELECT status, COUNT(*)::int AS count FROM email_campaign_enrollments WHERE campaign_id = ${campaignId} GROUP BY status ORDER BY status`;
      const enrollmentSources = await sql`SELECT enrolled_via AS source, COUNT(*)::int AS count FROM email_campaign_enrollments WHERE campaign_id = ${campaignId} GROUP BY enrolled_via ORDER BY enrolled_via`;
      const sends = await sql`SELECT s.status, COUNT(*)::int AS count FROM email_campaign_sends s JOIN email_campaign_enrollments e ON e.id = s.enrollment_id WHERE e.campaign_id = ${campaignId} GROUP BY s.status ORDER BY s.status`;
      const events = await sql`SELECT ev.event_type AS status, COUNT(*)::int AS count FROM email_campaign_events ev JOIN email_campaign_enrollments e ON e.id = ev.enrollment_id WHERE e.campaign_id = ${campaignId} GROUP BY ev.event_type ORDER BY ev.event_type`;
      const activity = await sql`
        SELECT
          s.id AS send_id,
          l.name AS lead_name,
          l.company_name,
          l.email AS recipient_email,
          l.owner AS owner_name,
          st.step_order,
          st.step_name,
          s.status AS send_status,
          s.sent_at,
          s.last_event_at,
          s.last_event_type,
          e.status AS enrollment_status,
          e.stopped_at,
          e.stopped_reason,
          COUNT(ev.id) FILTER (WHERE ev.event_type = 'delivered')::int AS delivered_count,
          COUNT(ev.id) FILTER (WHERE ev.event_type = 'opened')::int AS opened_count,
          COUNT(ev.id) FILTER (WHERE ev.event_type = 'clicked')::int AS clicked_count
        FROM email_campaign_sends s
        JOIN email_campaign_enrollments e ON e.id = s.enrollment_id
        JOIN queue_leads l ON l.id = e.lead_id
        JOIN email_campaign_steps st ON st.id = s.step_id
        LEFT JOIN email_campaign_events ev ON ev.send_id = s.id
        WHERE e.campaign_id = ${campaignId}
        GROUP BY s.id, l.name, l.company_name, l.email, l.owner, st.step_order, st.step_name,
                 s.status, s.sent_at, s.last_event_at, s.last_event_type, e.status, e.stopped_at, e.stopped_reason
        ORDER BY s.id DESC
        LIMIT 5000
      `;
      const testSends = await sql`
        SELECT
          id,
          sender_name,
          sender_email,
          recipient_name,
          recipient_email,
          status,
          sent_at,
          created_at,
          error,
          provider_message_id
        FROM email_send_logs
        WHERE template_key LIKE ${`campaign:${campaignId}:step:%`}
          AND lead_id IS NULL
        ORDER BY created_at DESC
        LIMIT 500
      `;
      const ruleActivity = await sql`
        SELECT created_at, event, meta
        FROM auth_audit
        WHERE target = ${`campaign:${campaignId}`}
          AND event IN ('campaign_rules_saved', 'campaign_rules_backfill_run', 'campaign_rules_auto_enroll', 'campaign_rule_stop_applied', 'campaign_activated')
        ORDER BY created_at DESC
        LIMIT 200
      `;
      return res.status(200).json({ success: true, enrollmentStatuses: rows, enrollmentSources, sendStatuses: sends, eventStatuses: events, activity, testSends, ruleActivity });
    }

    return res.status(400).json({ success: false, error: 'Unknown campaign action' });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.message });
  }
}
