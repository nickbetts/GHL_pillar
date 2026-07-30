/**
 * Apollo Sales Queue — Neon-backed staging store + gated GHL integration.
 *
 * Flow:
 *   1. Leads are enqueued from Apollo (via MCP curation or an Apollo list) into
 *      Postgres at status `to_contact`. They do NOT touch GHL yet.
 *   2. Reps work them on the board: to_contact -> contacted.
 *   3. GATE: moving a lead to `converted` is the ONLY thing that writes to GHL
 *      (contact + opportunity/deal). `qualified` is queue-only.
 *   4. `not_interested` leads stay out of GHL entirely.
 *
 * Endpoints:
 *   GET  /api/apollo-sales-queue            -> board data grouped by status
 *   POST /api/apollo-sales-queue { action } -> enqueue | status | note | convert | reassign
 */

import { get, post, put } from './ghl.js';
import { getSql } from './db.js';
import { apolloFetch } from './apollo-client.js';
import { resolveIdentity, canRunAction, hasMinRole } from './session.js';

const LOCATION_ID = process.env.GHL_LOCATION_ID;
const PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const QUALIFIED_STAGE_ID = process.env.GHL_QUALIFIED_STAGE_ID;
const CONVERTED_STAGE_ID = process.env.GHL_CONVERTED_STAGE_ID;

const STATUSES = ['to_contact', 'to_call_back', 'wants_more_info', 'no_answer', 'qualified', 'not_interested'];
const PRIORITIES = ['hot', 'warm', 'cold'];
// Engagement temperature is derived from status: every lead starts cold and warms up as it progresses.
const STATUS_PRIORITY = { to_contact: 'cold', no_answer: 'cold', not_interested: 'cold', to_call_back: 'warm', wants_more_info: 'hot', qualified: 'hot' };
function statusPriority(status) { return STATUS_PRIORITY[status] || 'cold'; }
// Qualifying is the single gate that writes to GHL (contact + opportunity + qualify fields).
const GHL_STATUSES = new Set(['qualified']);

// Round-robin sales reps (GHL user IDs)
const ROUND_ROBIN = [
  { name: 'Brendon Mwatsenekenyi', id: '6FX5X4kH2JFJc6u9zhSC' },
  { name: 'Zain Safir-Sheikh', id: 'XbyxbOK1Q1raRCjjGx4O' },
  { name: 'Amir Ward', id: 's7OG2BM94q7uNRsHLqM7' },
];

function repById(ownerId) {
  return ROUND_ROBIN.find((r) => r.id === ownerId) || null;
}

/**
 * Deterministic round-robin assignment for newly ingested leads.
 * Uses current table count to spread assignments in sequence.
 */
async function pickNextRoundRobinOwner(sql) {
  const rows = await sql`SELECT COUNT(*)::int AS c FROM queue_leads`;
  const idx = (rows?.[0]?.c || 0) % ROUND_ROBIN.length;
  return ROUND_ROBIN[idx];
}

/** Least-loaded round-robin: assign to whichever rep owns the fewest leads. */
async function pickRoundRobinOwner(sql) {
  const rows = await sql`
    SELECT owner_id, COUNT(*)::int AS c FROM queue_leads
    WHERE owner_id IS NOT NULL GROUP BY owner_id
  `;
  const counts = Object.fromEntries(rows.map((r) => [r.owner_id, r.c]));
  let best = ROUND_ROBIN[0];
  let bestCount = Infinity;
  for (const rep of ROUND_ROBIN) {
    const c = counts[rep.id] || 0;
    if (c < bestCount) {
      bestCount = c;
      best = rep;
    }
  }
  return best;
}

// ── Apollo normalisation ────────────────────────────────────────────────────

function classifyPriority({ title, employees, revenue }) {
  const t = String(title || '').toLowerCase();
  if (/vp|director|head|chief|founder|owner|president|partner|ceo|cto|cfo|cmo/.test(t) || employees >= 1000 || revenue >= 5000000) {
    return 'hot';
  }
  if (/manager|lead|principal|consultant/.test(t) || employees >= 200 || revenue >= 1000000) {
    return 'warm';
  }
  return 'cold';
}

function normalizeContact(rawContact) {
  const contact = rawContact?.contact || rawContact || {};
  const org = rawContact?.organization || rawContact?.company || contact?.organization || {};

  const email = contact?.email || rawContact?.email;
  const firstName = contact?.first_name || (contact?.name ? contact.name.split(' ')[0] : undefined);
  const lastName = contact?.last_name || (contact?.name ? contact.name.split(' ').slice(1).join(' ') : undefined);
  const name = contact?.name || [firstName, lastName].filter(Boolean).join(' ');

  const phone =
    contact?.phone_number ||
    contact?.phone_numbers?.[0]?.raw_number ||
    contact?.phone_numbers?.[0] ||
    org?.phone ||
    org?.primary_phone?.number;

  const website = org?.website_url || (org?.primary_domain ? `https://${org.primary_domain}` : undefined) || org?.domain;
  const employees = org?.estimated_num_employees || org?.num_employees || org?.employee_count;
  const revenueRaw = org?.annual_revenue ?? org?.organization_revenue;
  const revenue = typeof revenueRaw === 'string' ? parseInt(revenueRaw.replace(/[^0-9]/g, ''), 10) : revenueRaw;
  const industry = org?.industry;
  const sector = rawContact?.sector || org?.sector || null;
  const subSector = rawContact?.sub_sector || rawContact?.subSector || org?.sub_sector || org?.subSector || null;

  return {
    apollo_id: rawContact?.id || contact?.id || null,
    first_name: firstName || null,
    last_name: lastName || null,
    name: name || null,
    title: contact?.title || null,
    email: email || null,
    phone: phone || null,
    company_name: org?.name || null,
    company_website: website || null,
    company_industry: industry || null,
    sector,
    sub_sector: subSector,
    company_employees: Number.isFinite(employees) ? employees : null,
    company_revenue: Number.isFinite(revenue) ? String(revenue) : (revenueRaw ? String(revenueRaw) : null),
    linkedin_url: contact?.linkedin_url || null,
    priority: classifyPriority({ title: contact?.title, employees, revenue }),
    raw: rawContact,
  };
}

// ── DB helpers ──────────────────────────────────────────────────────────────

async function upsertLead(sql, lead) {
  if (!lead.email) return 0;
  const owner = await pickNextRoundRobinOwner(sql);
  const rows = await sql`
    INSERT INTO queue_leads (
      apollo_id, first_name, last_name, name, title, email, phone,
      company_name, company_website, company_industry, sector, sub_sector, company_employees,
      company_revenue, linkedin_url, priority, owner, owner_id, raw, last_touch_at
    ) VALUES (
      ${lead.apollo_id}, ${lead.first_name}, ${lead.last_name}, ${lead.name},
      ${lead.title}, ${lead.email}, ${lead.phone}, ${lead.company_name},
      ${lead.company_website}, ${lead.company_industry}, ${lead.sector}, ${lead.sub_sector}, ${lead.company_employees},
      ${lead.company_revenue}, ${lead.linkedin_url}, ${'cold'}, ${owner.name}, ${owner.id},
      ${JSON.stringify(lead.raw)}, now()
    )
    ON CONFLICT (email) DO UPDATE SET
      apollo_id         = COALESCE(EXCLUDED.apollo_id, queue_leads.apollo_id),
      first_name        = COALESCE(EXCLUDED.first_name, queue_leads.first_name),
      last_name         = COALESCE(EXCLUDED.last_name, queue_leads.last_name),
      name              = COALESCE(EXCLUDED.name, queue_leads.name),
      title             = COALESCE(EXCLUDED.title, queue_leads.title),
      phone             = COALESCE(EXCLUDED.phone, queue_leads.phone),
      company_name      = COALESCE(EXCLUDED.company_name, queue_leads.company_name),
      company_website   = COALESCE(EXCLUDED.company_website, queue_leads.company_website),
      company_industry  = COALESCE(EXCLUDED.company_industry, queue_leads.company_industry),
      sector            = COALESCE(queue_leads.sector, EXCLUDED.sector),
      sub_sector        = COALESCE(queue_leads.sub_sector, EXCLUDED.sub_sector),
      company_employees = COALESCE(EXCLUDED.company_employees, queue_leads.company_employees),
      company_revenue   = COALESCE(EXCLUDED.company_revenue, queue_leads.company_revenue),
      linkedin_url      = COALESCE(EXCLUDED.linkedin_url, queue_leads.linkedin_url),
      owner             = COALESCE(queue_leads.owner, EXCLUDED.owner),
      owner_id          = COALESCE(queue_leads.owner_id, EXCLUDED.owner_id),
      raw               = EXCLUDED.raw,
      updated_at        = now()
    RETURNING id
  `;
  return rows.length;
}

function rowToClient(row) {
  return {
    id: row.id,
    apolloId: row.apollo_id,
    name: row.name,
    firstName: row.first_name,
    lastName: row.last_name,
    title: row.title,
    email: row.email,
    phone: row.phone,
    companyName: row.company_name,
    companyWebsite: row.company_website,
    companyIndustry: row.company_industry,
    sector: row.sector,
    subSector: row.sub_sector,
    companyEmployees: row.company_employees,
    companyRevenue: row.company_revenue,
    linkedinUrl: row.linkedin_url,
    priority: row.priority,
    status: row.status,
    callNotes: row.call_notes,
    owner: row.owner,
    ownerId: row.owner_id,
    disposition: row.disposition,
    callbackAt: row.callback_at,
    qualifyAnswers: row.qualify_answers || null,
    apolloSynced: row.apollo_synced,
    lastTouchAt: row.last_touch_at,
    ghlContactId: row.ghl_contact_id,
    ghlOpportunityId: row.ghl_opportunity_id,
    source: row.source || 'outbound',
  };
}

// ── GHL integration (only reached via the qualify gate) ─────────────────────

// Qualify questionnaire answer keys → GHL contact custom field names (resolved to IDs at runtime).
// Services are mirrored to a legacy field and a dedicated field for cleaner reporting migration.
const QUALIFY_FIELD_NAMES = {
  services: ['Interested Service Line', 'Services Interested In'],
  budget: ['Marketing Budget Range'],
  timeline: ['Campaign Launch Timeline'],
  painPoint: ['Key Pain Point'],
  agencyBefore: ['Previous Agency Experience'],
};

// Reporting continuity fields mirrored to GHL contact so queue and GHL stay joinable.
const REPORTING_FIELD_NAMES = {
  queueLeadId: 'Queue Lead ID',
  apolloContactId: 'Apollo Contact ID',
  queueSource: 'Queue Source',
  sector: 'Lead Sector',
  subSector: 'Lead Sub-sector',
  queueStatus: 'Queue Status',
  queueOwner: 'Queue Owner',
  qualificationDate: 'Qualification Date',
  callbackDate: 'Next Callback Date',
  qualificationNotes: 'Qualification Notes',
};

const OPPORTUNITY_REPORTING_FIELD_NAMES = {
  sector: 'Lead Sector',
  subSector: 'Lead Sub-sector',
  services: 'Services Interested In',
  qualificationNotes: 'Qualification Notes',
};

const QUALIFY_SERVICE_OPTIONS = ['Web Design', 'SEO', 'Paid Ads', 'AIO'];

function toIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function normalizeQualifyAnswers(answers) {
  if (!answers || typeof answers !== 'object') return null;
  const out = {};

  const servicesRaw = Array.isArray(answers.services)
    ? answers.services
    : (typeof answers.services === 'string' && answers.services.trim() ? [answers.services.trim()] : []);
  if (servicesRaw.length) {
    const deduped = [...new Set(servicesRaw.map((v) => String(v || '').trim()).filter(Boolean))];
    const allowed = deduped.filter((v) => QUALIFY_SERVICE_OPTIONS.includes(v));
    if (allowed.length) out.services = allowed;
  }

  for (const key of ['budget', 'timeline', 'painPoint', 'agencyBefore']) {
    const v = typeof answers[key] === 'string' ? answers[key].trim() : answers[key];
    if (v) out[key] = String(v);
  }

  return Object.keys(out).length ? out : null;
}

let _contactFieldMap = null;
let _opportunityFieldMap = null;
async function getContactFieldMap() {
  if (_contactFieldMap) return _contactFieldMap;
  if (!LOCATION_ID || !process.env.GHL_TOKEN) return {};
  try {
    const res = await fetch(`https://services.leadconnectorhq.com/locations/${LOCATION_ID}/customFields?model=contact`, {
      headers: { Authorization: `Bearer ${process.env.GHL_TOKEN}`, Version: '2021-07-28', Accept: 'application/json' },
    });
    const data = await res.json().catch(() => null);
    const map = {};
    for (const f of (data?.customFields || [])) map[String(f.name).toLowerCase()] = { id: f.id, dataType: f.dataType };
    _contactFieldMap = map;
    return map;
  } catch { return {}; }
}

async function getOpportunityFieldMap() {
  if (_opportunityFieldMap) return _opportunityFieldMap;
  if (!LOCATION_ID || !process.env.GHL_TOKEN) return {};
  try {
    const res = await fetch(`https://services.leadconnectorhq.com/locations/${LOCATION_ID}/customFields?model=opportunity`, {
      headers: { Authorization: `Bearer ${process.env.GHL_TOKEN}`, Version: '2021-07-28', Accept: 'application/json' },
    });
    const data = await res.json().catch(() => null);
    const map = {};
    for (const f of (data?.customFields || [])) map[String(f.name).toLowerCase()] = { id: f.id, dataType: f.dataType };
    _opportunityFieldMap = map;
    return map;
  } catch { return {}; }
}

function buildQualifyCustomFields(answers, fieldMap) {
  const out = [];
  if (!answers || !fieldMap) return out;
  for (const [key, fieldNames] of Object.entries(QUALIFY_FIELD_NAMES)) {
    const val = answers[key];
    if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) continue;
    const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
    for (const fieldName of names) {
      const field = fieldMap[fieldName.toLowerCase()];
      if (!field) continue;
      out.push({ id: field.id, value: Array.isArray(val) ? val : String(val) });
    }
  }
  return out;
}

function buildReportingCustomFields({ lead, owner, status, qualifiedAt, callbackAt, qualificationNotes }, fieldMap) {
  const out = [];
  if (!fieldMap || !lead) return out;

  const values = {
    queueLeadId: lead.id != null ? String(lead.id) : null,
    apolloContactId: lead.apollo_id || null,
    queueSource: lead.source || 'outbound',
    sector: lead.sector || null,
    subSector: lead.sub_sector || null,
    queueStatus: status || lead.status || null,
    queueOwner: owner?.name || lead.owner || null,
    qualificationDate: toIsoDate(qualifiedAt),
    callbackDate: toIsoDate(callbackAt || lead.callback_at),
    qualificationNotes: qualificationNotes || null,
  };

  for (const [key, fieldName] of Object.entries(REPORTING_FIELD_NAMES)) {
    const val = values[key];
    if (val == null || val === '') continue;
    const field = fieldMap[fieldName.toLowerCase()];
    if (!field) continue;
    out.push({ id: field.id, value: String(val) });
  }
  return out;
}

function parseLeadQualifyAnswers(lead) {
  if (!lead) return null;
  if (lead.qualify_answers && typeof lead.qualify_answers === 'object') return lead.qualify_answers;
  if (typeof lead.qualify_answers === 'string') {
    try { return JSON.parse(lead.qualify_answers); } catch { return null; }
  }
  return null;
}

function buildOpportunityReportingCustomFields({ lead, answers, qualificationNotes }, fieldMap) {
  const out = [];
  if (!fieldMap || !lead) return out;

  const leadAnswers = answers || parseLeadQualifyAnswers(lead) || {};
  const values = {
    sector: lead.sector || null,
    subSector: lead.sub_sector || null,
    services: Array.isArray(leadAnswers.services) ? leadAnswers.services : null,
    qualificationNotes: qualificationNotes || null,
  };

  for (const [key, fieldName] of Object.entries(OPPORTUNITY_REPORTING_FIELD_NAMES)) {
    const val = values[key];
    if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) continue;
    const field = fieldMap[fieldName.toLowerCase()];
    if (!field) continue;
    out.push({ id: field.id, value: Array.isArray(val) ? val : String(val) });
  }

  return out;
}

function mergeCustomFields(...groups) {
  const seen = new Set();
  const out = [];
  for (const g of groups) {
    for (const f of (g || [])) {
      if (!f?.id || seen.has(f.id)) continue;
      seen.add(f.id);
      out.push(f);
    }
  }
  return out;
}

async function ensureGhlContact(lead, owner, customFields = []) {
  let contactId = lead.ghl_contact_id;
  if (!contactId) {
    try {
      const existing = await get(`/contacts/${lead.email}`, { locationId: LOCATION_ID });
      if (existing?.contact?.id) contactId = existing.contact.id;
    } catch {
      // not found — create below
    }
  }

  if (!contactId) {
    const created = await post('/contacts/', {
      locationId: LOCATION_ID,
      firstName: lead.first_name || undefined,
      lastName: lead.last_name || undefined,
      name: lead.name || undefined,
      email: lead.email,
      phone: lead.phone || undefined,
      companyName: lead.company_name || undefined,
      website: lead.company_website || undefined,
      source: 'Apollo Queue',
      assignedTo: owner?.id || undefined,
      tags: ['apollo-queue', 'sales-qualified'],
      ...(customFields.length ? { customFields } : {}),
    });
    return created?.contact?.id || null;
  }

  if (customFields.length) {
    try { await put(`/contacts/${contactId}`, { customFields }); } catch { /* best effort */ }
  }
  return contactId;
}

async function ensureGhlOpportunity(lead, contactId, { stageId, monetaryValue, owner, customFields = [] }) {
  if (!PIPELINE_ID || !stageId) {
    return { id: lead.ghl_opportunity_id || null, skipped: true, reason: 'Pipeline/stage not configured' };
  }

  if (lead.ghl_opportunity_id) {
    await put(`/opportunities/${lead.ghl_opportunity_id}`, {
      pipelineId: PIPELINE_ID,
      pipelineStageId: stageId,
      status: 'open',
      ...(owner?.id ? { assignedTo: owner.id } : {}),
      ...(monetaryValue ? { monetaryValue } : {}),
      ...(customFields.length ? { customFields } : {}),
    });
    return { id: lead.ghl_opportunity_id, skipped: false };
  }

  const created = await post('/opportunities/', {
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    pipelineStageId: stageId,
    name: `${lead.company_name || lead.name || lead.email} — Apollo`,
    status: 'open',
    contactId,
    ...(owner?.id ? { assignedTo: owner.id } : {}),
    ...(monetaryValue ? { monetaryValue } : {}),
    ...(customFields.length ? { customFields } : {}),
  });

  return { id: created?.opportunity?.id || null, skipped: false };
}

async function syncGhlOpportunityCustomFields(opportunityId, customFields = []) {
  if (!opportunityId || !customFields.length) return;
  try {
    await put(`/opportunities/${opportunityId}`, { customFields });
  } catch {
    // best effort
  }
}

/** Best-effort writeback to Apollo (guarded by APOLLO_WRITEBACK=true). */
async function apolloWriteback(lead, stageLabel) {
  if (process.env.APOLLO_WRITEBACK !== 'true' || !lead.apollo_id) {
    return { skipped: true };
  }
  try {
    await apolloFetch(`/contacts/${lead.apollo_id}`, {
      method: 'PUT',
      body: JSON.stringify({ label_names: [`GHL: ${stageLabel}`] }),
    });
    return { skipped: false, ok: true };
  } catch (error) {
    return { skipped: false, ok: false, error: error.message };
  }
}

async function pushToGhl(lead, { owner, contactCustomFields = [], opportunityCustomFields = [] }) {
  const contactId = await ensureGhlContact(lead, owner, contactCustomFields);
  const stageId = QUALIFIED_STAGE_ID;
  const opportunity = await ensureGhlOpportunity(lead, contactId, { stageId, owner, customFields: opportunityCustomFields });
  const apollo = await apolloWriteback(lead, 'Qualified');
  return {
    contactId,
    opportunityId: opportunity.id,
    opportunitySkipped: opportunity.skipped,
    reason: opportunity.reason,
    owner: owner ? owner.name : null,
    apollo,
  };
}

async function loadLead(sql, id) {
  const rows = await sql`SELECT * FROM queue_leads WHERE id = ${id} LIMIT 1`;
  return rows[0] || null;
}

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

async function logQueueEvent(sql, {
  leadId,
  eventType,
  fromStatus = null,
  toStatus = null,
  ownerId = null,
  ownerName = null,
  meta = null,
}) {
  if (!leadId || !eventType) return;
  await ensureEventsTable(sql);
  await sql`
    INSERT INTO queue_events (lead_id, event_type, from_status, to_status, owner_id, owner_name, meta)
    VALUES (${leadId}, ${eventType}, ${fromStatus}, ${toStatus}, ${ownerId}, ${ownerName}, ${meta ? JSON.stringify(meta) : null})
  `;
}

/** Keep only the significant national digits so +44 / 0-prefixed numbers match. */
export function phoneMatchKey(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.slice(-9);
}

/** Find the queue lead whose phone matches an inbound/outbound call number. */
export async function findLeadByPhone(sql, phone) {
  const key = phoneMatchKey(phone);
  if (!key) return null;
  const rows = await sql`
    SELECT id, name, owner, owner_id, status, phone
    FROM queue_leads
    WHERE RIGHT(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9) = ${key}
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Record a telephony call against a lead as a `call` event and refresh the
 * lead's last-touch timestamp. Shared by the 3CX webhook and manual logging.
 */
export async function recordCall(sql, { lead, direction, fromNumber, toNumber, agent, durationSec, outcome, recordingUrl, callId, provider = '3cx', startedAt = null, raw = null }) {
  if (!lead?.id) return { success: false, error: 'No matching lead' };
  await ensureEventsTable(sql);
  const meta = {
    provider,
    direction: direction || null,
    from: fromNumber || null,
    to: toNumber || null,
    agent: agent || null,
    durationSec: Number.isFinite(Number(durationSec)) ? Number(durationSec) : null,
    outcome: outcome || null,
    recordingUrl: recordingUrl || null,
    callId: callId || null,
    startedAt: startedAt || null,
  };
  if (raw) meta.raw = raw;
  await logQueueEvent(sql, {
    leadId: lead.id,
    eventType: 'call',
    ownerId: lead.owner_id || null,
    ownerName: lead.owner || null,
    meta,
  });
  await sql`UPDATE queue_leads SET last_touch_at = now(), updated_at = now() WHERE id = ${lead.id}`;
  return { success: true, leadId: lead.id };
}

async function loadCallHistory(sql, leadId) {
  await ensureEventsTable(sql);
  const rows = await sql`
    SELECT id, event_type, owner_name, meta, created_at
    FROM queue_events
    WHERE lead_id = ${leadId} AND event_type = 'call'
    ORDER BY created_at DESC
    LIMIT 50
  `;
  return rows.map((r) => ({
    id: r.id,
    at: r.created_at,
    owner: r.owner_name,
    ...(r.meta || {}),
  }));
}

// ── Candidate pool (pre-enrichment bank, no credits spent) ──────────────────

async function ensureCandidatesTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS queue_candidates (
      id                BIGSERIAL PRIMARY KEY,
      apollo_id         TEXT UNIQUE,
      first_name        TEXT,
      last_name         TEXT,
      name              TEXT,
      title             TEXT,
      company_name      TEXT,
      company_domain    TEXT,
      company_website   TEXT,
      company_industry  TEXT,
      company_employees INTEGER,
      company_revenue   TEXT,
      linkedin_url      TEXT,
      sector            TEXT,
      sub_sector        TEXT,
      priority          TEXT DEFAULT 'warm',
      has_email         BOOLEAN DEFAULT FALSE,
      has_phone         BOOLEAN DEFAULT FALSE,
      tier              INTEGER DEFAULT 2,
      wave              INTEGER,
      released          BOOLEAN DEFAULT FALSE,
      released_at       TIMESTAMPTZ,
      enqueued          BOOLEAN DEFAULT FALSE,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE queue_candidates ADD COLUMN IF NOT EXISTS tier INTEGER DEFAULT 2`;
  await sql`ALTER TABLE queue_candidates ADD COLUMN IF NOT EXISTS role_fit BOOLEAN`;
  await sql`ALTER TABLE queue_candidates ADD COLUMN IF NOT EXISTS role_reason TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS queue_candidates_wave_idx ON queue_candidates (wave)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_candidates_released_idx ON queue_candidates (released)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_candidates_sector_idx ON queue_candidates (sector)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_candidates_role_fit_idx ON queue_candidates (role_fit)`;
}

// Job roles that would never buy web design / paid ads for a marketing agency.
const UNFIT_REASONS = ['hr', 'it/tech', 'finance', 'legal/compliance', 'operations', 'procurement', 'health & safety/quality'];

/**
 * Vet every banked candidate by job title and flag whether the role would
 * plausibly buy marketing services (web design / paid ads). Owner / founder /
 * MD / CEO / marketing signals always win, so an owner of an HR firm is kept.
 * Pure back-office functional leaders (HR, IT, finance, legal, ops, procurement,
 * health & safety) are flagged unfit. Nothing is deleted — only flagged.
 */
async function vetRoles(sql) {
  await ensureCandidatesTable(sql);
  await sql`
    WITH classified AS (
      SELECT id,
        CASE
          WHEN COALESCE(title, '') ~* '(owner|founder|co-?founder|proprietor|principal|managing director|managing partner|chief executive|(^|[^a-z])ceo([^a-z]|$)|(^|[^a-z])md([^a-z]|$)|president)' THEN 'decision maker'
          WHEN COALESCE(title, '') ~* '(marketing|(^|[^a-z])cmo([^a-z]|$)|growth|(^|[^a-z])brand|demand generation|digital (marketing|director)|commercial director|sales (and|&) marketing|ecommerce director|e-commerce director)' THEN 'marketing buyer'
          WHEN COALESCE(title, '') ~* '(chief people|(^|[^a-z])chro([^a-z]|$)|hr director|director of hr|head of hr|head of people|human resources director|hr manager|people (and|&) culture|talent acquisition)' THEN 'hr'
          WHEN COALESCE(title, '') ~* '(chief technology|chief information officer|(^|[^a-z])cto([^a-z]|$)|(^|[^a-z])cio([^a-z]|$)|(^|[^a-z])ciso([^a-z]|$)|head of (it|engineering|technology)|it director|director of it|information security|software (engineer|developer)|devops)' THEN 'it/tech'
          WHEN COALESCE(title, '') ~* '(chief financial|(^|[^a-z])cfo([^a-z]|$)|finance director|director of finance|financial controller|head of finance|vp finance|finance manager|payroll manager)' THEN 'finance'
          WHEN COALESCE(title, '') ~* '(general counsel|head of legal|legal director|legal counsel|(^|[^a-z])dpo([^a-z]|$)|data protection officer|compliance officer|compliance manager|head of compliance)' THEN 'legal/compliance'
          WHEN COALESCE(title, '') ~* '(chief operating|(^|[^a-z])coo([^a-z]|$)|operations director|director of operations|operations manager|head of operations|operations lead)' THEN 'operations'
          WHEN COALESCE(title, '') ~* '(procurement|purchasing|supply chain)' THEN 'procurement'
          WHEN COALESCE(title, '') ~* '(health (and|&) safety|(^|[^a-z])hse([^a-z]|$)|quality (manager|director|assurance)|facilities (manager|director)|environmental)' THEN 'health & safety/quality'
          WHEN COALESCE(title, '') ~* '(director|partner|head of|chief|proprietor)' THEN 'senior (kept)'
          ELSE 'other (kept)'
        END AS reason
      FROM queue_candidates
    )
    UPDATE queue_candidates c
    SET role_reason = cl.reason,
        role_fit = CASE WHEN cl.reason IN ('hr','it/tech','finance','legal/compliance','operations','procurement','health & safety/quality') THEN FALSE ELSE TRUE END,
        updated_at = now()
    FROM classified cl
    WHERE c.id = cl.id
  `;

  const byReason = await sql`
    SELECT COALESCE(role_reason, 'unvetted') AS reason,
           COUNT(*)::int AS total,
           BOOL_OR(role_fit) AS fit
    FROM queue_candidates
    GROUP BY COALESCE(role_reason, 'unvetted')
    ORDER BY total DESC
  `;
  const fitRows = await sql`SELECT COUNT(*)::int AS c FROM queue_candidates WHERE role_fit = TRUE`;
  const unfitRows = await sql`SELECT COUNT(*)::int AS c FROM queue_candidates WHERE role_fit = FALSE`;
  return {
    fit: fitRows[0]?.c || 0,
    unfit: unfitRows[0]?.c || 0,
    byReason: byReason.map((r) => ({ reason: r.reason, total: r.total, fit: r.fit === true })),
  };
}

/** Bulk upsert a batch of pre-enrichment candidates via a single JSON insert. */
async function bankCandidates(sql, candidates) {
  await ensureCandidatesTable(sql);
  const clean = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && c.apollo_id)
    .map((c) => ({
      apollo_id: String(c.apollo_id),
      first_name: c.first_name ?? null,
      last_name: c.last_name ?? null,
      name: c.name ?? null,
      title: c.title ?? null,
      company_name: c.company_name ?? null,
      company_domain: c.company_domain ?? null,
      company_website: c.company_website ?? null,
      company_industry: c.company_industry ?? null,
      company_employees: Number.isFinite(c.company_employees) ? c.company_employees : null,
      company_revenue: c.company_revenue != null ? String(c.company_revenue) : null,
      linkedin_url: c.linkedin_url ?? null,
      sector: c.sector ?? null,
      sub_sector: c.sub_sector ?? null,
      priority: c.priority ?? 'warm',
      has_email: c.has_email === true,
      has_phone: c.has_phone === true,
      tier: Number.isFinite(c.tier) ? c.tier : 2,
    }));

  if (!clean.length) return 0;

  // Dedupe within the batch: ON CONFLICT cannot affect the same row twice.
  const deduped = Array.from(new Map(clean.map((c) => [c.apollo_id, c])).values());

  const rows = await sql`
    INSERT INTO queue_candidates (
      apollo_id, first_name, last_name, name, title, company_name, company_domain,
      company_website, company_industry, company_employees, company_revenue,
      linkedin_url, sector, sub_sector, priority, has_email, has_phone, tier
    )
    SELECT
      apollo_id, first_name, last_name, name, title, company_name, company_domain,
      company_website, company_industry, company_employees, company_revenue,
      linkedin_url, sector, sub_sector, priority, has_email, has_phone, tier
    FROM json_to_recordset(${JSON.stringify(deduped)}::json) AS x(
      apollo_id text, first_name text, last_name text, name text, title text,
      company_name text, company_domain text, company_website text, company_industry text,
      company_employees integer, company_revenue text, linkedin_url text,
      sector text, sub_sector text, priority text, has_email boolean, has_phone boolean, tier integer
    )
    ON CONFLICT (apollo_id) DO UPDATE SET
      title             = COALESCE(EXCLUDED.title, queue_candidates.title),
      company_name      = COALESCE(EXCLUDED.company_name, queue_candidates.company_name),
      company_domain    = COALESCE(EXCLUDED.company_domain, queue_candidates.company_domain),
      sector            = COALESCE(queue_candidates.sector, EXCLUDED.sector),
      sub_sector        = COALESCE(queue_candidates.sub_sector, EXCLUDED.sub_sector),
      priority          = COALESCE(EXCLUDED.priority, queue_candidates.priority),
      has_email         = EXCLUDED.has_email,
      has_phone         = EXCLUDED.has_phone,
      tier              = LEAST(queue_candidates.tier, EXCLUDED.tier),
      updated_at        = now()
    RETURNING id
  `;
  return rows.length;
}

/**
 * List banked candidates for a wave / backup page.
 *
 * Waves are computed directly from the banked pool — a candidate does NOT need
 * a `release-wave` call to appear. Each wave is tier-balanced first (as close
 * to 50/50 as possible), then sector-proportional inside each tier.
 *
 * Backup is everything after the first three balanced waves and is intentionally
 * uncapped (subject to total rows in the pool).
 */
async function listCandidates(sql, { wave = null, backup = false, sector = null, includeEnqueued = false, waveSize = 1111, roleFit = 'fit' }) {
  await ensureCandidatesTable(sql);
  const size = Math.min(Math.max(Number.parseInt(waveSize, 10) || 1111, 1), 5000);
  const isBackup = backup === true || backup === 'true' || backup === 1 || backup === '1';
  const waveNum = Number.parseInt(wave, 10);
  const w = Number.isFinite(waveNum) && waveNum >= 1 ? waveNum : 1;
  const tier1PerWave = Math.floor(size / 2);
  const tier2PerWave = size - tier1PerWave;
  const t1Lo = isBackup ? tier1PerWave * 3 : tier1PerWave * (w - 1);
  const t1Hi = isBackup ? null : tier1PerWave * w;
  const t2Lo = isBackup ? tier2PerWave * 3 : tier2PerWave * (w - 1);
  const t2Hi = isBackup ? null : tier2PerWave * w;
  const hardLimit = isBackup ? 2147483647 : 6000;
  const inc = includeEnqueued === true || includeEnqueued === 'true';
  const fitMode = roleFit === 'excluded' ? 'excluded' : (roleFit === 'all' ? 'all' : 'fit');
  const rows = await sql`
    WITH filtered AS (
      SELECT
        id, apollo_id, first_name, last_name, name, title, company_name, company_domain,
        company_website, company_industry, company_employees, company_revenue,
        linkedin_url, sector, sub_sector, priority, has_email, has_phone, tier,
        role_fit, role_reason, wave, released, released_at, enqueued, created_at, updated_at,
        COALESCE(tier, 2) AS t, COALESCE(sector, 'Unknown') AS sec
      FROM queue_candidates
      WHERE (${inc}::boolean = TRUE OR enqueued = FALSE)
      AND (
        ${fitMode} = 'all'
        OR (${fitMode} = 'fit' AND role_fit IS NOT FALSE)
        OR (${fitMode} = 'excluded' AND role_fit = FALSE)
      )
    ),
    strat AS (
      -- Rank within each (tier, sector) group by priority, then age.
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY t, sec
          ORDER BY CASE priority WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END, created_at ASC, id ASC
        ) AS grp_rn,
        COUNT(*) OVER (PARTITION BY t, sec) AS grp_cnt
      FROM filtered
    ),
    ranked_tiered AS (
      -- Rank inside each tier so each wave can take a balanced split from
      -- tier 1 and tier 2, while still keeping sector-proportional ordering.
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY t
          ORDER BY (grp_rn::float / NULLIF(grp_cnt, 0)) ASC, sec ASC, id ASC
        ) AS tier_rn
      FROM strat
    ),
    sliced AS (
      SELECT *
      FROM ranked_tiered
      WHERE (
        (t = 1 AND tier_rn > ${t1Lo} AND (${t1Hi}::int IS NULL OR tier_rn <= ${t1Hi}))
        OR
        (t <> 1 AND tier_rn > ${t2Lo} AND (${t2Hi}::int IS NULL OR tier_rn <= ${t2Hi}))
      )
    ),
    final_ranked AS (
      SELECT *, ROW_NUMBER() OVER (ORDER BY tier_rn ASC, t ASC, sec ASC, id ASC) AS rn
      FROM sliced
    )
    SELECT
      id, apollo_id, first_name, last_name, name, title, company_name, company_domain,
      company_website, company_industry, company_employees, company_revenue,
      linkedin_url, sector, sub_sector, priority, has_email, has_phone, tier,
      role_fit, role_reason, wave, released, released_at, enqueued, created_at, updated_at, rn
    FROM final_ranked
    WHERE (${sector}::text IS NULL OR sector = ${sector})
    ORDER BY rn ASC
    LIMIT ${hardLimit}
  `;
  return rows;
}

/** Ensure lead columns added after the original schema exist (idempotent). */
async function ensureLeadColumns(sql) {
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS sector TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS sub_sector TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'outbound'`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS qualify_answers JSONB`;
}

/** Simple workspace key/value config (e.g. the 3CX dial URL template). */
async function ensureConfigTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS app_config (
      key         TEXT PRIMARY KEY,
      value       TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

async function getConfigValue(sql, key) {
  await ensureConfigTable(sql);
  const rows = await sql`SELECT value FROM app_config WHERE key = ${key} LIMIT 1`;
  return rows[0]?.value ?? null;
}

async function setConfigValue(sql, key, value) {
  await ensureConfigTable(sql);
  await sql`
    INSERT INTO app_config (key, value, updated_at) VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

/** Ensure no rows remain unassigned on board load. */
async function ensureOwnersAssigned(sql) {  const unassigned = await sql`
    SELECT id FROM queue_leads
    WHERE owner_id IS NULL
    ORDER BY created_at ASC, id ASC
  `;

  for (const row of unassigned) {
    const owner = await pickNextRoundRobinOwner(sql);
    await sql`
      UPDATE queue_leads
      SET owner = ${owner.name}, owner_id = ${owner.id}, updated_at = now()
      WHERE id = ${row.id}
    `;
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const identity = resolveIdentity(req);
  if (!identity) {
    return res.status(401).json({ success: false, error: 'Not signed in' });
  }

  let sql;
  try {
    sql = getSql();
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  if (req.method === 'GET') {
    try {
      await ensureLeadColumns(sql);
      await ensureOwnersAssigned(sql);
      // One-time migration: map the old single 'contacted' status onto 'to_call_back'.
      await sql`UPDATE queue_leads SET status = 'to_call_back' WHERE status = 'contacted'`;

      // Everyone sees the whole board; only managers/admins can act on leads.
      const scope = String(req.query?.source || '').toLowerCase();
      let rows;
      if (scope === 'inbound') {
        rows = await sql`
          SELECT * FROM queue_leads WHERE source = 'inbound'
          ORDER BY created_at DESC
        `;
      } else if (scope === 'outbound') {
        rows = await sql`
          SELECT * FROM queue_leads WHERE source IS DISTINCT FROM 'inbound'
          ORDER BY
            CASE priority WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
            created_at DESC
        `;
      } else {
        rows = await sql`
          SELECT * FROM queue_leads
          ORDER BY
            CASE priority WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
            created_at DESC
        `;
      }
      const contacts = rows.map(rowToClient);
      const grouped = Object.fromEntries(STATUSES.map((s) => [s, []]));
      contacts.forEach((c) => (grouped[c.status] || grouped.to_contact).push(c));

      return res.status(200).json({ success: true, contacts, grouped });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const action = body.action || 'enqueue';

    // Permission gate: every action has a minimum role (see session.js).
    if (!canRunAction(identity, action)) {
      return res.status(403).json({ success: false, error: 'You do not have permission for this action' });
    }

    try {
      await ensureLeadColumns(sql);
      // ── Enqueue MCP-curated contacts into staging (no GHL write) ──────────
      if (action === 'enqueue') {
        const contacts = Array.isArray(body.contacts) ? body.contacts : [];
        let inserted = 0;
        for (const raw of contacts) {
          const lead = normalizeContact(raw);
          inserted += await upsertLead(sql, lead);
          if (lead.apollo_id) {
            await sql`
              UPDATE queue_candidates
              SET enqueued = TRUE, updated_at = now()
              WHERE apollo_id = ${String(lead.apollo_id)}
            `;
          }
          if (lead.email) {
            const row = await sql`SELECT id, owner_id, owner FROM queue_leads WHERE email = ${lead.email} LIMIT 1`;
            if (row[0]?.id) {
              await logQueueEvent(sql, {
                leadId: row[0].id,
                eventType: 'ingest',
                ownerId: row[0].owner_id,
                ownerName: row[0].owner,
                meta: { source: 'enqueue' },
              });
            }
          }
        }
        return res.status(200).json({ success: true, action, inserted });
      }

      // ── Bank pre-enrichment candidates (no credits, no GHL, off-board) ────
      if (action === 'bank-candidates') {
        const inserted = await bankCandidates(sql, body.candidates);
        return res.status(200).json({ success: true, action, inserted });
      }

      // ── Vet every candidate by job role (flag non-buyers, delete nothing) ─
      if (action === 'vet-roles') {
        const summary = await vetRoles(sql);
        return res.status(200).json({ success: true, action, ...summary });
      }

      // ── Rep gamification: per-owner call & outcome stats for achievements ─
      if (action === 'achievements') {
        await ensureEventsTable(sql);
        const callRows = await sql`
          SELECT owner_id, MAX(owner_name) AS owner_name,
            COUNT(*)::int AS calls,
            COUNT(*) FILTER (WHERE meta->>'outcome' ILIKE 'Answered%')::int AS answered,
            COUNT(*) FILTER (WHERE meta->>'outcome' = 'Answered - interested')::int AS interested,
            COUNT(*) FILTER (WHERE meta->>'outcome' ILIKE 'No answer%')::int AS no_answer,
            COUNT(*) FILTER (WHERE meta->>'outcome' ILIKE '%voicemail%')::int AS voicemail,
            COUNT(*) FILTER (WHERE meta->>'outcome' = 'Gatekeeper')::int AS gatekeeper,
            COUNT(*) FILTER (WHERE meta->>'outcome' = 'Wrong number')::int AS wrong_number,
            COUNT(*) FILTER (WHERE meta->>'outcome' = 'Callback booked')::int AS callbacks,
            COUNT(*) FILTER (WHERE meta->>'outcome' ILIKE '%not interested%')::int AS not_interested,
            COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS calls_today
          FROM queue_events
          WHERE event_type = 'call' AND owner_id IS NOT NULL
          GROUP BY owner_id
        `;
        const statusRows = await sql`
          SELECT owner_id, MAX(owner_name) AS owner_name,
            COUNT(*) FILTER (WHERE to_status = 'qualified')::int AS qualified,
            COUNT(*) FILTER (WHERE to_status = 'to_call_back')::int AS warmed,
            COUNT(*) FILTER (WHERE to_status = 'wants_more_info')::int AS heated
          FROM queue_events
          WHERE event_type = 'status_change' AND owner_id IS NOT NULL
          GROUP BY owner_id
        `;
        const map = new Map();
        const blank = () => ({ calls: 0, answered: 0, interested: 0, noAnswer: 0, voicemail: 0, gatekeeper: 0, wrongNumber: 0, callbacks: 0, notInterested: 0, callsToday: 0, qualified: 0, warmed: 0, heated: 0 });
        for (const r of callRows) {
          const s = map.get(r.owner_id) || { ownerId: r.owner_id, ownerName: r.owner_name, ...blank() };
          s.ownerName = s.ownerName || r.owner_name;
          Object.assign(s, {
            calls: r.calls, answered: r.answered, interested: r.interested, noAnswer: r.no_answer,
            voicemail: r.voicemail, gatekeeper: r.gatekeeper, wrongNumber: r.wrong_number,
            callbacks: r.callbacks, notInterested: r.not_interested, callsToday: r.calls_today,
          });
          map.set(r.owner_id, s);
        }
        for (const r of statusRows) {
          const s = map.get(r.owner_id) || { ownerId: r.owner_id, ownerName: r.owner_name, ...blank() };
          s.ownerName = s.ownerName || r.owner_name;
          s.qualified = r.qualified; s.warmed = r.warmed; s.heated = r.heated;
          map.set(r.owner_id, s);
        }
        return res.status(200).json({ success: true, action, reps: Array.from(map.values()) });
      }

      // ── Candidate pool stats (banked / released / by sector / by wave) ────
      if (action === 'candidate-stats') {
        await ensureCandidatesTable(sql);
        const totalRows = await sql`SELECT COUNT(*)::int AS c FROM queue_candidates`;
        const releasedRows = await sql`SELECT COUNT(*)::int AS c FROM queue_candidates WHERE released = TRUE`;
        const enqueuedRows = await sql`SELECT COUNT(*)::int AS c FROM queue_candidates WHERE enqueued = TRUE`;
        const fitRows = await sql`SELECT COUNT(*)::int AS c FROM queue_candidates WHERE role_fit = TRUE`;
        const unfitRows = await sql`SELECT COUNT(*)::int AS c FROM queue_candidates WHERE role_fit = FALSE`;
        const unvettedRows = await sql`SELECT COUNT(*)::int AS c FROM queue_candidates WHERE role_fit IS NULL`;
        const byRole = await sql`
          SELECT COALESCE(role_reason, 'unvetted') AS reason,
                 COUNT(*)::int AS total,
                 BOOL_OR(role_fit) AS fit
          FROM queue_candidates GROUP BY COALESCE(role_reason, 'unvetted') ORDER BY total DESC
        `;
        const bySector = await sql`
          SELECT COALESCE(sector, 'Unknown') AS sector,
                 COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE role_fit IS NOT FALSE)::int AS fit,
                 COUNT(*) FILTER (WHERE released = TRUE)::int AS released
          FROM queue_candidates GROUP BY COALESCE(sector, 'Unknown') ORDER BY total DESC
        `;
        const byWave = await sql`
          SELECT wave, COUNT(*)::int AS c FROM queue_candidates
          WHERE wave IS NOT NULL GROUP BY wave ORDER BY wave
        `;
        const byTier = await sql`
          SELECT COALESCE(tier, 2) AS tier, COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE released = TRUE)::int AS released
          FROM queue_candidates GROUP BY COALESCE(tier, 2) ORDER BY tier
        `;
        const bySubSector = await sql`
          SELECT COALESCE(sector, 'Unknown') AS sector,
                 COALESCE(sub_sector, 'Unknown') AS sub_sector,
                 COUNT(*)::int AS total
          FROM queue_candidates GROUP BY COALESCE(sector, 'Unknown'), COALESCE(sub_sector, 'Unknown')
          ORDER BY sector, total DESC
        `;
        return res.status(200).json({
          success: true,
          action,
          total: totalRows[0]?.c || 0,
          released: releasedRows[0]?.c || 0,
          enqueued: enqueuedRows[0]?.c || 0,
          unreleased: (totalRows[0]?.c || 0) - (releasedRows[0]?.c || 0),
          fit: fitRows[0]?.c || 0,
          unfit: unfitRows[0]?.c || 0,
          unvetted: unvettedRows[0]?.c || 0,
          byRole: byRole.map((r) => ({ reason: r.reason, total: r.total, fit: r.fit === true })),
          bySector,
          bySubSector,
          byTier,
          byWave,
        });
      }

      // ── Candidate list for wave / backup pages ───────────────────────────
      if (action === 'candidate-list') {
        const wave = body.wave ?? req.query?.wave ?? null;
        const backup = body.backup ?? req.query?.backup ?? false;
        const sector = body.sector ?? req.query?.sector ?? null;
        const includeEnqueued = body.includeEnqueued ?? req.query?.includeEnqueued ?? false;
        const waveSize = body.waveSize ?? req.query?.waveSize ?? 1111;
        const roleFit = body.roleFit ?? req.query?.roleFit ?? 'fit';
        const candidates = await listCandidates(sql, { wave, backup, sector, includeEnqueued, waveSize, roleFit });
        return res.status(200).json({ success: true, action, wave, backup, sector, includeEnqueued, waveSize, roleFit, candidates });
      }

      // ── Mark the next N unreleased candidates as a wave, return the list ──
      // Enrichment (credit spend) happens OUTSIDE this endpoint, in a controlled
      // script, then those rows are enqueued to the board.
      if (action === 'release-wave') {
        await ensureCandidatesTable(sql);
        const wave = Number.parseInt(body.wave, 10);
        const limit = Math.min(Math.max(Number.parseInt(body.limit, 10) || 1111, 1), 5000);
        const tier1Take = Math.floor(limit / 2);
        const tier2Take = limit - tier1Take;
        if (!Number.isFinite(wave) || wave < 1) {
          return res.status(400).json({ success: false, error: 'Valid wave number required' });
        }

        const rows = await sql`
          WITH filtered AS (
            SELECT id, COALESCE(tier, 2) AS t, COALESCE(sector, 'Unknown') AS sec, priority, created_at
            FROM queue_candidates
            WHERE released = FALSE
            AND role_fit IS NOT FALSE
          ),
          strat AS (
            SELECT id, t, sec,
              ROW_NUMBER() OVER (
                PARTITION BY t, sec
                ORDER BY CASE priority WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END, created_at ASC, id ASC
              ) AS grp_rn,
              COUNT(*) OVER (PARTITION BY t, sec) AS grp_cnt
            FROM filtered
          ),
          ranked_tiered AS (
            SELECT id, t,
              ROW_NUMBER() OVER (
                PARTITION BY t
                ORDER BY (grp_rn::float / NULLIF(grp_cnt, 0)) ASC, sec ASC, id ASC
              ) AS tier_rn
            FROM strat
          ),
          picked AS (
            SELECT id
            FROM ranked_tiered
            WHERE (t = 1 AND tier_rn <= ${tier1Take})
               OR (t <> 1 AND tier_rn <= ${tier2Take})
          )
          UPDATE queue_candidates c
          SET wave = ${wave}, released = TRUE, released_at = now(), updated_at = now()
          FROM picked
          WHERE c.id = picked.id
          RETURNING c.id, c.apollo_id, c.first_name, c.last_name, c.name, c.title,
                    c.company_name, c.company_domain, c.sector, c.sub_sector, c.priority, c.tier
        `;
        return res.status(200).json({ success: true, action, wave, released: rows.length, candidates: rows });
      }

      // ── Apollo list import (disabled) ─────────────────────────────────────
      if (action === 'sync-list') {
        return res.status(403).json({
          success: false,
          error: 'Apollo list import is disabled on this page. Use managed import workflow only.',
        });
      }

      // ── Delete a lead (admin only; used for cleanup of seeded dummy rows) ─
      if (action === 'delete-lead') {
        const { id } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

        await sql`DELETE FROM queue_leads WHERE id = ${id}`;

        return res.status(200).json({ success: true, action, id, deleted: true, name: lead.name, companyName: lead.company_name });
      }

      // ── Status / notes updates (GHL write ONLY on convert) ─────────────────
      if (action === 'status') {
        const { id, status } = body;
        if (!id || !STATUSES.includes(status)) {
          return res.status(400).json({ success: false, error: 'Valid id and status required' });
        }

        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

        let ghl = null;
        let owner = null;
        const nextPriority = statusPriority(status);
        const answers = status === 'qualified' ? normalizeQualifyAnswers(body.answers) : null;
        const qualificationNotes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
        if (GHL_STATUSES.has(status)) {
          // Preserve the queue owner as the GHL assignee. Fallback should be rare.
          owner = lead.owner_id ? { id: lead.owner_id, name: lead.owner } : await pickRoundRobinOwner(sql);
          const contactFieldMap = await getContactFieldMap();
          const opportunityFieldMap = await getOpportunityFieldMap();
          const qualifyFields = buildQualifyCustomFields(answers, contactFieldMap);
          const reportingFields = buildReportingCustomFields({
            lead,
            owner,
            status,
            qualifiedAt: new Date(),
            callbackAt: body.callbackAt || lead.callback_at,
            qualificationNotes,
          }, contactFieldMap);
          const opportunityFields = buildOpportunityReportingCustomFields({
            lead,
            answers,
            qualificationNotes,
          }, opportunityFieldMap);
          const contactCustomFields = mergeCustomFields(qualifyFields, reportingFields);
          ghl = await pushToGhl(lead, { owner, contactCustomFields, opportunityCustomFields: opportunityFields });
        }

        await sql`
          UPDATE queue_leads SET
            status = ${status},
            priority = ${nextPriority},
            owner = COALESCE(${owner?.name || body.owner || null}, owner),
            owner_id = COALESCE(${owner?.id || null}, owner_id),
            call_notes = COALESCE(${body.notes ?? null}, call_notes),
            qualify_answers = COALESCE(${answers ? JSON.stringify(answers) : null}::jsonb, qualify_answers),
            apollo_synced = COALESCE(${ghl?.apollo?.ok ?? null}, apollo_synced),
            ghl_contact_id = COALESCE(${ghl?.contactId || null}, ghl_contact_id),
            ghl_opportunity_id = COALESCE(${ghl?.opportunityId || null}, ghl_opportunity_id),
            last_touch_at = now(),
            updated_at = now()
          WHERE id = ${id}
        `;

        await logQueueEvent(sql, {
          leadId: id,
          eventType: 'status_change',
          fromStatus: lead.status,
          toStatus: status,
          ownerId: owner?.id || lead.owner_id,
          ownerName: owner?.name || lead.owner,
          meta: { via: 'status-action', priority: nextPriority, qualified: status === 'qualified' ? true : undefined },
        });

        return res.status(200).json({ success: true, action, id, status, priority: nextPriority, ghl });
      }

      // ── Explicit owner reassignment from board detail menu ───────────────
      if (action === 'reassign') {
        const { id, ownerId } = body;
        if (!id || !ownerId) {
          return res.status(400).json({ success: false, error: 'Lead id and ownerId required' });
        }
        const rep = repById(ownerId);
        if (!rep) {
          return res.status(400).json({ success: false, error: 'Owner must be one of the round-robin reps' });
        }

        await sql`
          UPDATE queue_leads
          SET owner = ${rep.name}, owner_id = ${rep.id}, updated_at = now(), last_touch_at = now()
          WHERE id = ${id}
        `;

        await logQueueEvent(sql, {
          leadId: id,
          eventType: 'reassign',
          ownerId: rep.id,
          ownerName: rep.name,
          meta: { via: 'detail-menu' },
        });

        return res.status(200).json({ success: true, action, id, owner: rep.name, ownerId: rep.id });
      }

      // ── Set lead priority from the board detail menu ─────────────────────
      if (action === 'priority') {
        const { id, priority } = body;
        if (!id || !PRIORITIES.includes(priority)) {
          return res.status(400).json({ success: false, error: 'Lead id and valid priority required' });
        }
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

        await sql`
          UPDATE queue_leads
          SET priority = ${priority}, updated_at = now()
          WHERE id = ${id}
        `;

        await logQueueEvent(sql, {
          leadId: id,
          eventType: 'priority',
          ownerId: lead.owner_id,
          ownerName: lead.owner,
          meta: { from: lead.priority, to: priority },
        });

        return res.status(200).json({ success: true, action, id, priority });
      }

      // ── Qualify (gate → GHL contact + opportunity + qualify fields) ───────
      // `convert` kept as an alias so any older callers still hand off cleanly.
      if (action === 'convert' || action === 'qualify') {
        const { id } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });

        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

        const owner = lead.owner_id ? { id: lead.owner_id, name: lead.owner } : await pickRoundRobinOwner(sql);
        const answers = normalizeQualifyAnswers(body.answers);
        const qualificationNotes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
        const contactFieldMap = await getContactFieldMap();
        const opportunityFieldMap = await getOpportunityFieldMap();
        const qualifyFields = buildQualifyCustomFields(answers, contactFieldMap);
        const reportingFields = buildReportingCustomFields({
          lead,
          owner,
          status: 'qualified',
          qualifiedAt: new Date(),
          callbackAt: body.callbackAt || lead.callback_at,
          qualificationNotes,
        }, contactFieldMap);
        const opportunityFields = buildOpportunityReportingCustomFields({
          lead,
          answers,
          qualificationNotes,
        }, opportunityFieldMap);
        const contactCustomFields = mergeCustomFields(qualifyFields, reportingFields);
        const ghl = await pushToGhl(lead, { owner, contactCustomFields, opportunityCustomFields: opportunityFields });

        await sql`
          UPDATE queue_leads SET
            status = 'qualified',
            priority = 'hot',
            owner = COALESCE(${owner?.name || null}, owner),
            owner_id = COALESCE(${owner?.id || null}, owner_id),
            call_notes = COALESCE(${body.notes ?? null}, call_notes),
            qualify_answers = COALESCE(${answers ? JSON.stringify(answers) : null}::jsonb, qualify_answers),
            apollo_synced = COALESCE(${ghl?.apollo?.ok ?? null}, apollo_synced),
            ghl_contact_id = COALESCE(${ghl.contactId || null}, ghl_contact_id),
            ghl_opportunity_id = COALESCE(${ghl.opportunityId || null}, ghl_opportunity_id),
            last_touch_at = now(),
            updated_at = now()
          WHERE id = ${id}
        `;

        await logQueueEvent(sql, {
          leadId: id,
          eventType: 'status_change',
          fromStatus: lead.status,
          toStatus: 'qualified',
          ownerId: owner?.id || lead.owner_id,
          ownerName: owner?.name || lead.owner,
          meta: { via: 'qualify-action', qualified: true, priority: 'hot' },
        });

        return res.status(200).json({ success: true, action, id, status: 'qualified', priority: 'hot', ghl });
      }

      // ── Disposition + callback (DB only) ──────────────────────────────────
      if (action === 'disposition') {
        const { id, disposition, callbackAt } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });
        await sql`
          UPDATE queue_leads SET
            disposition = ${disposition ?? null},
            callback_at = ${callbackAt ?? null},
            last_touch_at = now(),
            updated_at = now()
          WHERE id = ${id}
        `;
        const lead = await loadLead(sql, id);
        if (lead?.ghl_contact_id || lead?.ghl_opportunity_id) {
          const owner = lead.owner_id ? { id: lead.owner_id, name: lead.owner } : null;
          const qualificationNotes = typeof lead.call_notes === 'string' && lead.call_notes.trim() ? lead.call_notes.trim() : null;

          if (lead.ghl_contact_id) {
            const fieldMap = await getContactFieldMap();
            const reportingFields = buildReportingCustomFields({
              lead,
              owner,
              status: lead.status,
              qualifiedAt: null,
              callbackAt: lead.callback_at,
              qualificationNotes,
            }, fieldMap);
            if (reportingFields.length) {
              try { await ensureGhlContact(lead, owner, reportingFields); } catch { /* best effort */ }
            }
          }

          if (lead.ghl_opportunity_id) {
            const opportunityFieldMap = await getOpportunityFieldMap();
            const opportunityFields = buildOpportunityReportingCustomFields({ lead, qualificationNotes }, opportunityFieldMap);
            if (opportunityFields.length) {
              await syncGhlOpportunityCustomFields(lead.ghl_opportunity_id, opportunityFields);
            }
          }
        }
        await logQueueEvent(sql, {
          leadId: id,
          eventType: 'disposition',
          ownerId: lead?.owner_id || null,
          ownerName: lead?.owner || null,
          meta: { disposition: disposition ?? null, callbackAt: callbackAt ?? null },
        });
        return res.status(200).json({ success: true, action, id });
      }

      // ── Correct a lead's sector / sub-sector (keeps reports accurate) ─────
      if (action === 'set-sector') {
        const { id } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });
        const sector = body.sector != null && String(body.sector).trim() !== '' ? String(body.sector).trim() : null;
        const subSector = body.subSector != null && String(body.subSector).trim() !== '' ? String(body.subSector).trim() : null;
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
        await sql`
          UPDATE queue_leads SET sector = ${sector}, sub_sector = ${subSector}, updated_at = now()
          WHERE id = ${id}
        `;
        const updatedLead = await loadLead(sql, id);
        if (updatedLead?.ghl_contact_id || updatedLead?.ghl_opportunity_id) {
          const owner = updatedLead.owner_id ? { id: updatedLead.owner_id, name: updatedLead.owner } : null;
          const qualificationNotes = typeof updatedLead.call_notes === 'string' && updatedLead.call_notes.trim() ? updatedLead.call_notes.trim() : null;

          if (updatedLead.ghl_contact_id) {
            const fieldMap = await getContactFieldMap();
            const reportingFields = buildReportingCustomFields({
              lead: updatedLead,
              owner,
              status: updatedLead.status,
              qualifiedAt: null,
              callbackAt: updatedLead.callback_at,
              qualificationNotes,
            }, fieldMap);
            if (reportingFields.length) {
              try { await ensureGhlContact(updatedLead, owner, reportingFields); } catch { /* best effort */ }
            }
          }

          if (updatedLead.ghl_opportunity_id) {
            const opportunityFieldMap = await getOpportunityFieldMap();
            const opportunityFields = buildOpportunityReportingCustomFields({ lead: updatedLead, qualificationNotes }, opportunityFieldMap);
            if (opportunityFields.length) {
              await syncGhlOpportunityCustomFields(updatedLead.ghl_opportunity_id, opportunityFields);
            }
          }
        }
        await logQueueEvent(sql, {
          leadId: id,
          eventType: 'sector',
          ownerId: lead.owner_id,
          ownerName: lead.owner,
          meta: { from: { sector: lead.sector, subSector: lead.sub_sector }, to: { sector, subSector } },
        });
        return res.status(200).json({ success: true, action, id, sector, subSector });
      }

      // ── Save call notes (DB only) ─────────────────────────────────────────
      if (action === 'note') {
        const { id, notes } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });
        await sql`
          UPDATE queue_leads SET call_notes = ${notes ?? null}, last_touch_at = now(), updated_at = now()
          WHERE id = ${id}
        `;
        const lead = await loadLead(sql, id);
        await logQueueEvent(sql, {
          leadId: id,
          eventType: 'note',
          ownerId: lead?.owner_id || null,
          ownerName: lead?.owner || null,
        });
        return res.status(200).json({ success: true, action, id });
      }

      // ── Workspace config (3CX dial template + server-dial availability) ──
      if (action === 'get-config') {
        const template = await getConfigValue(sql, 'threecx_dial_template');
        const target = await getConfigValue(sql, 'daily_call_target');
        return res.status(200).json({
          success: true,
          action,
          threecxDialTemplate: template || '',
          dailyCallTarget: Number.parseInt(target, 10) || 30,
          threecxServerDial: !!(process.env.THREECX_API_BASE && ((process.env.THREECX_CLIENT_ID && process.env.THREECX_CLIENT_SECRET) || process.env.THREECX_API_TOKEN)),
        });
      }

      if (action === 'set-config') {
        if (typeof body.threecxDialTemplate === 'string') {
          await setConfigValue(sql, 'threecx_dial_template', body.threecxDialTemplate.trim());
        }
        if (body.dailyCallTarget != null) {
          const n = Math.max(1, Math.min(500, Number.parseInt(body.dailyCallTarget, 10) || 30));
          await setConfigValue(sql, 'daily_call_target', String(n));
        }
        const template = await getConfigValue(sql, 'threecx_dial_template');
        const target = await getConfigValue(sql, 'daily_call_target');
        return res.status(200).json({ success: true, action, threecxDialTemplate: template || '', dailyCallTarget: Number.parseInt(target, 10) || 30 });
      }

      // ── Per-rep board themes (avatar + background preset), shared workspace ─
      if (action === 'get-rep-themes') {
        const raw = await getConfigValue(sql, 'rep_themes');
        let themes = {};
        try { themes = raw ? JSON.parse(raw) : {}; } catch { themes = {}; }
        return res.status(200).json({ success: true, action, themes });
      }

      if (action === 'set-rep-theme') {
        const ownerId = String(body.ownerId || '').trim();
        if (!ownerId) return res.status(400).json({ success: false, error: 'ownerId required' });
        const raw = await getConfigValue(sql, 'rep_themes');
        let themes = {};
        try { themes = raw ? JSON.parse(raw) : {}; } catch { themes = {}; }
        const entry = themes[ownerId] || {};
        if (typeof body.avatar === 'string') {
          const a = body.avatar.trim().slice(0, 512);
          // Only allow short text (emoji/initials) or an https image URL — never inline scripts.
          entry.avatar = (/^https?:\/\//i.test(a) || a.length <= 8) ? a : '';
        }
        if (typeof body.bg === 'string') entry.bg = body.bg.trim().slice(0, 32).replace(/[^a-z0-9_-]/gi, '');
        themes[ownerId] = entry;
        await setConfigValue(sql, 'rep_themes', JSON.stringify(themes));
        return res.status(200).json({ success: true, action, themes });
      }

      // ── Call history for a lead (read-only, for the call timeline) ────────
      if (action === 'call-history') {        const { id } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });
        const calls = await loadCallHistory(sql, id);
        return res.status(200).json({ success: true, action, id, calls });
      }

      // ── Manually log a call outcome (fallback when 3CX webhook is off) ────
      if (action === 'log-call') {
        const { id } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
        const result = await recordCall(sql, {
          lead,
          direction: body.direction || 'outbound',
          fromNumber: body.fromNumber || null,
          toNumber: body.toNumber || lead.phone || null,
          agent: body.agent || lead.owner || null,
          durationSec: body.durationSec,
          outcome: body.outcome || null,
          recordingUrl: body.recordingUrl || null,
          callId: body.callId || null,
          provider: body.provider || 'manual',
        });

        // Optional one-click board updates driven by the call outcome.
        // Qualifying is intentionally excluded — it must go through the qualify questionnaire.
        const setStatus = STATUSES.includes(body.setStatus) && body.setStatus !== 'qualified' ? body.setStatus : null;
        const setDisposition = typeof body.setDisposition === 'string' && body.setDisposition !== '' ? body.setDisposition : null;
        const callbackAt = body.callbackAt || null;
        const notes = typeof body.notes === 'string' && body.notes.trim() !== '' ? body.notes.trim() : null;
        const nextPriority = setStatus ? statusPriority(setStatus) : null;
        if (setStatus || setDisposition || callbackAt || notes) {
          await sql`
            UPDATE queue_leads SET
              status = COALESCE(${setStatus}, status),
              priority = COALESCE(${nextPriority}, priority),
              disposition = COALESCE(${setDisposition}, disposition),
              callback_at = COALESCE(${callbackAt}::timestamptz, callback_at),
              call_notes = CASE WHEN ${notes}::text IS NULL THEN call_notes
                ELSE TRIM(BOTH E'\n' FROM COALESCE(call_notes, '') || E'\n' || ${notes}) END,
              last_touch_at = now(), updated_at = now()
            WHERE id = ${id}
          `;
          if (setStatus && setStatus !== lead.status) {
            await logQueueEvent(sql, {
              leadId: id, eventType: 'status_change', fromStatus: lead.status, toStatus: setStatus,
              ownerId: lead.owner_id, ownerName: lead.owner, meta: { via: 'call-outcome', priority: nextPriority },
            });
          }
          if (setDisposition || callbackAt) {
            await logQueueEvent(sql, {
              leadId: id, eventType: 'disposition', ownerId: lead.owner_id, ownerName: lead.owner,
              meta: { disposition: setDisposition, callbackAt },
            });
          }

          const refreshed = await loadLead(sql, id);
          if (refreshed?.ghl_contact_id || refreshed?.ghl_opportunity_id) {
            const owner = refreshed.owner_id ? { id: refreshed.owner_id, name: refreshed.owner } : null;
            const qualificationNotes = typeof refreshed.call_notes === 'string' && refreshed.call_notes.trim() ? refreshed.call_notes.trim() : null;

            if (refreshed.ghl_contact_id) {
              const fieldMap = await getContactFieldMap();
              const reportingFields = buildReportingCustomFields({
                lead: refreshed,
                owner,
                status: refreshed.status,
                qualifiedAt: null,
                callbackAt: refreshed.callback_at,
                qualificationNotes,
              }, fieldMap);
              if (reportingFields.length) {
                try { await ensureGhlContact(refreshed, owner, reportingFields); } catch { /* best effort */ }
              }
            }

            if (refreshed.ghl_opportunity_id) {
              const opportunityFieldMap = await getOpportunityFieldMap();
              const opportunityFields = buildOpportunityReportingCustomFields({ lead: refreshed, qualificationNotes }, opportunityFieldMap);
              if (opportunityFields.length) {
                await syncGhlOpportunityCustomFields(refreshed.ghl_opportunity_id, opportunityFields);
              }
            }
          }
        }
        return res.status(200).json({ success: true, action, id, ...result, applied: { setStatus, setDisposition, callbackAt } });
      }

      return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
