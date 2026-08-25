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
import { getSql, initAuthTables, initQueueTable, initTimeOffTable, writeAudit } from './db.js';
import { apolloFetch } from './apollo-client.js';
import { resolveIdentity, canRunAction, hasMinRole } from './session.js';
import crypto from 'crypto';

const LOCATION_ID = process.env.GHL_LOCATION_ID;
const PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const QUALIFIED_STAGE_ID = process.env.GHL_QUALIFIED_STAGE_ID;
const CONVERTED_STAGE_ID = process.env.GHL_CONVERTED_STAGE_ID;

const STATUSES = ['to_contact', 'to_call_back', 'wants_more_info', 'no_answer', 'qualified', 'not_interested'];
const OPPORTUNITY_STAGES = ['qualified', 'meeting_booked', 'meeting_no_show', 'meeting_attended', 'scoping', 'proposal', 'won', 'lost'];
const MEETING_TYPES = ['discovery', 'demo', 'follow_up', 'proposal_review', 'close', 'other'];
const MEETING_STATUSES = ['scheduled', 'completed', 'no_show', 'cancelled'];
const PRIORITIES = ['hot', 'warm', 'cold'];
const MAX_BULK_ITEMS = 5000;
// Engagement temperature is derived from status: every lead starts cold and warms up as it progresses.
const STATUS_PRIORITY = { to_contact: 'cold', no_answer: 'cold', not_interested: 'cold', to_call_back: 'warm', wants_more_info: 'hot', qualified: 'hot' };
function statusPriority(status) { return STATUS_PRIORITY[status] || 'cold'; }
// Qualification is local-only; external GHL handoff happens when an opportunity reaches Won.
const QUALIFICATION_STATUSES = new Set(['qualified']);

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
  const rows = await sql`SELECT COUNT(*)::int AS c FROM queue_leads WHERE archived_at IS NULL`;
  const idx = (rows?.[0]?.c || 0) % ROUND_ROBIN.length;
  return ROUND_ROBIN[idx];
}

/** Least-loaded round-robin: assign to whichever rep owns the fewest leads. */
async function pickRoundRobinOwner(sql) {
  const rows = await sql`
    SELECT owner_id, COUNT(*)::int AS c FROM queue_leads
    WHERE owner_id IS NOT NULL AND archived_at IS NULL GROUP BY owner_id
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

function pickOwnerByIndex(index) {
  return ROUND_ROBIN[index % ROUND_ROBIN.length];
}

function normalizeMeetingType(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return MEETING_TYPES.includes(value) ? value : 'follow_up';
}

function normalizeMeetingParticipantIds(raw) {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(
    raw.map((value) => String(value || '').trim()).filter(Boolean)
  ));
}

function isRep(identity) {
  return identity?.role === 'rep' && !!identity?.ghlOwnerId;
}

function canAccessLead(identity, lead) {
  if (!lead) return false;
  if (!isRep(identity)) return true;
  return String(lead.owner_id || '') === String(identity.ghlOwnerId);
}

function canViewLead(identity, lead) {
  if (!lead) return false;
  if (!isRep(identity)) return true;
  const source = String(lead.source || 'outbound').toLowerCase();
  if (source === 'inbound') return String(lead.owner_id || '') === String(identity.ghlOwnerId);
  return true;
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

async function upsertLead(sql, lead, ownerOverride = null, skipCompanyMatch = false) {
  if (!lead.email) return 0;
  // Keep company ownership consistent for newly inserted contacts.
  // This only affects owner selection for new records and does not rewrite existing owners.
  const companyOwner = skipCompanyMatch ? null : await findCompanyOwner(sql, lead);
  const owner = companyOwner || ownerOverride || await pickNextRoundRobinOwner(sql);
  const priority = lead.priority || 'warm';
  const rows = await sql`
    INSERT INTO queue_leads (
      apollo_id, first_name, last_name, name, title, email, phone, direct_phone,
      company_name, company_website, company_industry, sector, sub_sector, company_employees,
      company_revenue, linkedin_url, priority, owner, owner_id, raw, last_touch_at
    ) VALUES (
      ${lead.apollo_id}, ${lead.first_name}, ${lead.last_name}, ${lead.name},
      ${lead.title}, ${lead.email}, ${lead.phone}, ${lead.direct_phone || null}, ${lead.company_name},
      ${lead.company_website}, ${lead.company_industry}, ${lead.sector}, ${lead.sub_sector}, ${lead.company_employees},
      ${lead.company_revenue}, ${lead.linkedin_url}, ${priority}, ${owner.name}, ${owner.id},
      ${JSON.stringify(lead.raw)}, now()
    )
    ON CONFLICT (email) DO UPDATE SET
      apollo_id         = COALESCE(EXCLUDED.apollo_id, queue_leads.apollo_id),
      first_name        = CASE WHEN EXCLUDED.first_name IS NOT NULL AND POSITION('*' IN EXCLUDED.first_name) = 0 THEN EXCLUDED.first_name ELSE queue_leads.first_name END,
      last_name         = CASE WHEN EXCLUDED.last_name IS NOT NULL AND POSITION('*' IN EXCLUDED.last_name) = 0 THEN EXCLUDED.last_name ELSE queue_leads.last_name END,
      name              = CASE WHEN EXCLUDED.name IS NOT NULL AND POSITION('*' IN EXCLUDED.name) = 0 THEN EXCLUDED.name ELSE queue_leads.name END,
      title             = COALESCE(EXCLUDED.title, queue_leads.title),
      phone             = COALESCE(EXCLUDED.phone, queue_leads.phone),
      direct_phone      = COALESCE(EXCLUDED.direct_phone, queue_leads.direct_phone),
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
      archived_at       = NULL,
      archived_reason   = NULL,
      raw               = CASE WHEN EXCLUDED.name IS NOT NULL AND POSITION('*' IN EXCLUDED.name) > 0 THEN queue_leads.raw ELSE EXCLUDED.raw END,
      updated_at        = now()
    RETURNING id
  `;
  return rows.length;
}

async function findCompanyOwner(sql, lead) {
  const matcher = companyMatcherFromLead(lead);
  if (!matcher) return null;

  let rows = [];
  if (matcher.type === 'phone') {
    rows = await sql`
      SELECT owner_id, owner, COUNT(*)::int AS c
      FROM queue_leads
      WHERE owner_id IS NOT NULL
        AND archived_at IS NULL
        AND source IS DISTINCT FROM 'inbound'
        AND RIGHT(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9) = ${matcher.value}
      GROUP BY owner_id, owner
      ORDER BY c DESC, MAX(updated_at) DESC
      LIMIT 1
    `;
  } else if (matcher.type === 'domain') {
    const like = `${matcher.value}%`;
    rows = await sql`
      SELECT owner_id, owner, COUNT(*)::int AS c
      FROM queue_leads
      WHERE owner_id IS NOT NULL
        AND archived_at IS NULL
        AND source IS DISTINCT FROM 'inbound'
        AND LOWER(regexp_replace(COALESCE(company_website, ''), '^https?://', '')) LIKE ${like}
      GROUP BY owner_id, owner
      ORDER BY c DESC, MAX(updated_at) DESC
      LIMIT 1
    `;
  } else {
    rows = await sql`
      SELECT owner_id, owner, COUNT(*)::int AS c
      FROM queue_leads
      WHERE owner_id IS NOT NULL
        AND archived_at IS NULL
        AND source IS DISTINCT FROM 'inbound'
        AND LOWER(regexp_replace(TRIM(COALESCE(company_name, '')), '\\s+', ' ', 'g')) = ${matcher.value}
      GROUP BY owner_id, owner
      ORDER BY c DESC, MAX(updated_at) DESC
      LIMIT 1
    `;
  }

  const row = rows[0];
  if (!row?.owner_id) return null;
  const rep = repById(row.owner_id);
  return { id: row.owner_id, name: row.owner || rep?.name || null };
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
    directPhone: row.direct_phone || null,
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
    opportunityStage: row.opportunity_stage || (row.status === 'qualified' ? 'qualified' : null),
    mrrValue: row.mrr_value == null ? null : Number(row.mrr_value),
    oneOffValue: row.one_off_value == null ? null : Number(row.one_off_value),
    dealType: row.deal_type || null,
    nextStepSummary: row.next_step_summary || null,
    lossReason: row.loss_reason || null,
    qualifiedAt: row.qualified_at || null,
    meetingBookedAt: row.meeting_booked_at || null,
    meetingScheduledAt: row.meeting_scheduled_at || null,
    meetingAttendedAt: row.meeting_attended_at || null,
    meetingNoShowAt: row.meeting_no_show_at || null,
    meetingNoShowCount: row.meeting_no_show_count == null ? 0 : Number(row.meeting_no_show_count),
    scopingAt: row.scoping_at || null,
    proposalAt: row.proposal_at || null,
    wonAt: row.won_at || null,
    lostAt: row.lost_at || null,
    proposalSentAt: row.proposal_sent_at || null,
    decisionDeadlineAt: row.decision_deadline_at || null,
    opportunityOrigin: row.opportunity_origin || null,
    source: row.source || 'outbound',
    companyTarget: !!row.company_target,
    noteCount: row.note_count == null ? 0 : Number(row.note_count),
  };
}

function websiteHost(url) {
  if (!url) return '';
  try {
    const u = new URL(String(url));
    return String(u.hostname || '').toLowerCase().replace(/^www\./, '').trim();
  } catch {
    return String(url).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
  }
}

function splitLeadName(fullName) {
  const cleaned = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return { name: '', firstName: null, lastName: null };
  const parts = cleaned.split(' ');
  return {
    name: cleaned,
    firstName: parts[0] || null,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

function normalizedCompanyName(value) {
  return String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function companyMatcherFromLead(lead) {
  const phone = phoneMatchKey(lead?.phone || lead?.direct_phone || lead?.directPhone);
  if (phone) return { type: 'phone', value: phone, groupKey: `phone:${phone}` };
  const domain = websiteHost(lead?.company_website || lead?.companyWebsite);
  if (domain) return { type: 'domain', value: domain, groupKey: `domain:${domain}` };
  const name = normalizedCompanyName(lead?.company_name || lead?.companyName);
  if (name) return { type: 'name', value: name, groupKey: `name:${name}` };
  return null;
}

function companyGroupKeyFromRow(row) {
  const matcher = companyMatcherFromLead(row);
  return matcher?.groupKey || `lead:${row.id}`;
}

async function loadCompanyPeers(sql, lead) {
  const matcher = companyMatcherFromLead(lead);
  if (!matcher) return [];
  if (matcher.type === 'phone') {
    return sql`
      SELECT * FROM queue_leads
      WHERE archived_at IS NULL
        AND RIGHT(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9) = ${matcher.value}
    `;
  }
  if (matcher.type === 'domain') {
    const like = `${matcher.value}%`;
    return sql`
      SELECT * FROM queue_leads
      WHERE archived_at IS NULL
        AND LOWER(regexp_replace(COALESCE(company_website, ''), '^https?://', '')) LIKE ${like}
    `;
  }
  return sql`
    SELECT * FROM queue_leads
    WHERE archived_at IS NULL
      AND LOWER(regexp_replace(TRIM(COALESCE(company_name, '')), '\\s+', ' ', 'g')) = ${matcher.value}
  `;
}

function isCoveredDisposition(value) {
  const s = String(value || '').toLowerCase();
  return s.includes('covered by colleague') || s.includes('already worked this company');
}

function isWorkedContact(lead) {
  if (!lead) return false;
  const status = String(lead.status || '').toLowerCase();
  const disposition = String(lead.disposition || '').trim();
  return status !== '' && status !== 'to_contact'
    || disposition !== ''
    || !!lead.callback_at;
}

function timeOffHoursForPart(dayPart, hoursOff) {
  const part = String(dayPart || '').toLowerCase();
  if (part === 'full') return 8;
  if (part === 'am' || part === 'pm') return 4;
  if (part === 'hours') {
    const n = Number(hoursOff || 0);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(8, n));
  }
  return 0;
}

function toMs(value) {
  const t = value ? new Date(value).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

function computeCompanyScore(lead) {
  const priorityRank = { hot: 30, warm: 20, cold: 10 };
  const statusRank = { wants_more_info: 24, to_call_back: 20, no_answer: 12, to_contact: 10, qualified: 0, not_interested: 0 };
  return (lead.companyTarget ? 1000 : 0)
    + (statusRank[lead.status] || 0)
    + (priorityRank[lead.priority] || 0)
    + (isCoveredDisposition(lead.disposition) ? -200 : 0)
    + Math.floor(toMs(lead.lastTouchAt) / 1000000000);
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
let _contactFieldMapAt = 0;
let _opportunityFieldMap = null;
let _opportunityFieldMapAt = 0;
const FIELD_MAP_TTL_MS = 60 * 60 * 1000; // refresh hourly so new GHL fields appear without a redeploy
async function getContactFieldMap() {
  if (_contactFieldMap && (Date.now() - _contactFieldMapAt) < FIELD_MAP_TTL_MS) return _contactFieldMap;
  if (!LOCATION_ID || !process.env.GHL_TOKEN) return {};
  try {
    const res = await fetch(`https://services.leadconnectorhq.com/locations/${LOCATION_ID}/customFields?model=contact`, {
      headers: { Authorization: `Bearer ${process.env.GHL_TOKEN}`, Version: '2021-07-28', Accept: 'application/json' },
    });
    const data = await res.json().catch(() => null);
    const map = {};
    for (const f of (data?.customFields || [])) map[String(f.name).toLowerCase()] = { id: f.id, dataType: f.dataType };
    _contactFieldMap = map;
    _contactFieldMapAt = Date.now();
    return map;
  } catch { return _contactFieldMap || {}; }
}

async function getOpportunityFieldMap() {
  if (_opportunityFieldMap && (Date.now() - _opportunityFieldMapAt) < FIELD_MAP_TTL_MS) return _opportunityFieldMap;
  if (!LOCATION_ID || !process.env.GHL_TOKEN) return {};
  try {
    const res = await fetch(`https://services.leadconnectorhq.com/locations/${LOCATION_ID}/customFields?model=opportunity`, {
      headers: { Authorization: `Bearer ${process.env.GHL_TOKEN}`, Version: '2021-07-28', Accept: 'application/json' },
    });
    const data = await res.json().catch(() => null);
    const map = {};
    for (const f of (data?.customFields || [])) map[String(f.name).toLowerCase()] = { id: f.id, dataType: f.dataType };
    _opportunityFieldMap = map;
    _opportunityFieldMapAt = Date.now();
    return map;
  } catch { return _opportunityFieldMap || {}; }
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

  try {
    const existing = await get('/opportunities/search', {
      location_id: LOCATION_ID,
      contact_id: contactId,
      pipeline_id: PIPELINE_ID,
      limit: 20,
    });
    const match = (existing?.opportunities || []).find((opportunity) =>
      String(opportunity.contactId || opportunity.contact_id) === String(contactId)
      && String(opportunity.pipelineId || opportunity.pipeline_id) === String(PIPELINE_ID)
    );
    if (match?.id) {
      await put(`/opportunities/${match.id}`, {
        pipelineId: PIPELINE_ID,
        pipelineStageId: stageId,
        status: 'open',
        ...(owner?.id ? { assignedTo: owner.id } : {}),
        ...(customFields.length ? { customFields } : {}),
      });
      return { id: match.id, skipped: false, reused: true };
    }
  } catch {
    // Search is a retry guard; creation below remains the source of truth.
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

async function pushToGhl(sql, lead, { owner, contactCustomFields = [], opportunityCustomFields = [], qualificationToken = null, stageId = QUALIFIED_STAGE_ID, stageLabel = 'Qualified' }) {
  const contactId = await ensureGhlContact(lead, owner, contactCustomFields);
  if (qualificationToken && contactId) {
    await sql`
      UPDATE queue_leads
      SET ghl_contact_id = COALESCE(ghl_contact_id, ${contactId}), updated_at = now()
      WHERE id = ${lead.id} AND qualification_token = ${qualificationToken}
    `;
    lead.ghl_contact_id = contactId;
  }
  const opportunity = await ensureGhlOpportunity(lead, contactId, { stageId, owner, customFields: opportunityCustomFields });
  const apollo = await apolloWriteback(lead, stageLabel);
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
  const rows = await sql`SELECT * FROM queue_leads WHERE id = ${id} AND archived_at IS NULL LIMIT 1`;
  return rows[0] || null;
}

function meetingParticipantToClient(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name || repById(row.owner_id)?.name || null,
    role: row.role,
    createdAt: row.created_at,
  };
}

function meetingRowToClient(row, participants = []) {
  return {
    id: row.id,
    leadId: row.lead_id,
    sequenceNo: Number(row.sequence_no || 0),
    meetingType: row.meeting_type || 'follow_up',
    status: row.status || 'scheduled',
    bookedAt: row.booked_at || null,
    scheduledFor: row.scheduled_for || null,
    occurredAt: row.occurred_at || null,
    canceledAt: row.canceled_at || null,
    bookingChannel: row.booking_channel || 'manual',
    primaryOwnerId: row.primary_owner_id || null,
    primaryOwnerName: row.primary_owner_name || repById(row.primary_owner_id)?.name || null,
    notes: row.notes || null,
    outcomeNotes: row.outcome_notes || null,
    calendarProvider: row.calendar_provider || null,
    calendarEventId: row.calendar_event_id || null,
    participants,
    meta: row.meta || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadOpportunityMeetings(sql, leadId) {
  const meetings = await sql`
    SELECT *
    FROM opportunity_meetings
    WHERE lead_id = ${leadId}
    ORDER BY sequence_no ASC, scheduled_for ASC, id ASC
  `;
  if (!meetings.length) return [];
  const meetingIds = meetings.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  const participants = meetingIds.length
    ? await sql`
        SELECT *
        FROM opportunity_meeting_participants
        WHERE meeting_id = ANY(${meetingIds})
        ORDER BY CASE role WHEN 'primary' THEN 0 WHEN 'accompanying' THEN 1 ELSE 2 END, created_at ASC, id ASC
      `
    : [];
  const byMeeting = new Map();
  for (const row of participants) {
    const list = byMeeting.get(Number(row.meeting_id)) || [];
    list.push(meetingParticipantToClient(row));
    byMeeting.set(Number(row.meeting_id), list);
  }
  return meetings.map((row) => meetingRowToClient(row, byMeeting.get(Number(row.id)) || []));
}

async function loadOpportunityMeetingsBulk(sql, leadIds) {
  const ids = Array.isArray(leadIds)
    ? leadIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];
  if (!ids.length) return {};

  const meetings = await sql`
    SELECT *
    FROM opportunity_meetings
    WHERE lead_id = ANY(${ids})
    ORDER BY lead_id ASC, sequence_no ASC, scheduled_for ASC, id ASC
  `;
  if (!meetings.length) return {};

  const meetingIds = meetings.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  const participants = meetingIds.length
    ? await sql`
        SELECT *
        FROM opportunity_meeting_participants
        WHERE meeting_id = ANY(${meetingIds})
        ORDER BY CASE role WHEN 'primary' THEN 0 WHEN 'accompanying' THEN 1 ELSE 2 END, created_at ASC, id ASC
      `
    : [];

  const byMeeting = new Map();
  for (const row of participants) {
    const key = Number(row.meeting_id);
    const list = byMeeting.get(key) || [];
    list.push(meetingParticipantToClient(row));
    byMeeting.set(key, list);
  }

  const meetingsByLead = {};
  for (const row of meetings) {
    const leadKey = String(row.lead_id);
    if (!Array.isArray(meetingsByLead[leadKey])) meetingsByLead[leadKey] = [];
    meetingsByLead[leadKey].push(meetingRowToClient(row, byMeeting.get(Number(row.id)) || []));
  }
  return meetingsByLead;
}

async function nextOpportunityMeetingSequence(sql, leadId) {
  const rows = await sql`
    SELECT COALESCE(MAX(sequence_no), 0)::int AS seq
    FROM opportunity_meetings
    WHERE lead_id = ${leadId}
  `;
  return Number(rows?.[0]?.seq || 0) + 1;
}

async function createMeetingParticipants(sql, { meetingId, primaryOwnerId, primaryOwnerName, accompanyingOwnerIds = [] }) {
  if (primaryOwnerId) {
    await sql`
      INSERT INTO opportunity_meeting_participants (meeting_id, owner_id, owner_name, role)
      VALUES (${meetingId}, ${primaryOwnerId}, ${primaryOwnerName || repById(primaryOwnerId)?.name || null}, 'primary')
      ON CONFLICT (meeting_id, owner_id) DO UPDATE SET owner_name = EXCLUDED.owner_name, role = EXCLUDED.role
    `;
  }
  for (const ownerId of accompanyingOwnerIds) {
    if (!ownerId || ownerId === primaryOwnerId) continue;
    const rep = repById(ownerId);
    await sql`
      INSERT INTO opportunity_meeting_participants (meeting_id, owner_id, owner_name, role)
      VALUES (${meetingId}, ${ownerId}, ${rep?.name || null}, 'accompanying')
      ON CONFLICT (meeting_id, owner_id) DO UPDATE SET owner_name = EXCLUDED.owner_name, role = EXCLUDED.role
    `;
  }
}

async function syncLeadMeetingSummary(sql, leadId) {
  const rows = await sql`
    SELECT status, booked_at, scheduled_for, occurred_at
    FROM opportunity_meetings
    WHERE lead_id = ${leadId}
    ORDER BY sequence_no ASC, scheduled_for ASC, id ASC
  `;

  let earliestBookedAt = null;
  let latestScheduledFor = null;
  let latestAttendedAt = null;
  let latestNoShowAt = null;
  let noShowCount = 0;

  for (const row of rows) {
    if (row.booked_at && (!earliestBookedAt || new Date(row.booked_at) < new Date(earliestBookedAt))) {
      earliestBookedAt = row.booked_at;
    }
    if (row.status === 'scheduled' && row.scheduled_for && (!latestScheduledFor || new Date(row.scheduled_for) > new Date(latestScheduledFor))) {
      latestScheduledFor = row.scheduled_for;
    }
    if (row.status === 'completed') {
      const ts = row.occurred_at || row.scheduled_for || row.booked_at;
      if (ts && (!latestAttendedAt || new Date(ts) > new Date(latestAttendedAt))) latestAttendedAt = ts;
    }
    if (row.status === 'no_show') {
      noShowCount += 1;
      const ts = row.occurred_at || row.scheduled_for || row.booked_at;
      if (ts && (!latestNoShowAt || new Date(ts) > new Date(latestNoShowAt))) latestNoShowAt = ts;
    }
  }

  await sql`
    UPDATE queue_leads
    SET meeting_booked_at = ${earliestBookedAt}::timestamptz,
        meeting_scheduled_at = ${latestScheduledFor}::timestamptz,
        meeting_attended_at = ${latestAttendedAt}::timestamptz,
        meeting_no_show_at = ${latestNoShowAt}::timestamptz,
        meeting_no_show_count = ${noShowCount},
        updated_at = now()
    WHERE id = ${leadId}
  `;
}

async function createOpportunityMeeting(sql, {
  lead,
  scheduledFor,
  meetingType,
  bookingChannel = 'manual',
  notes = null,
  nextStepSummary = null,
  primaryOwnerId = null,
  primaryOwnerName = null,
  accompanyingOwnerIds = [],
  actorEmail = null,
  actorRole = null,
}) {
  const sequenceNo = await nextOpportunityMeetingSequence(sql, lead.id);
  const type = normalizeMeetingType(meetingType);
  const rep = primaryOwnerId ? repById(primaryOwnerId) : null;
  const ownerName = primaryOwnerName || rep?.name || lead.owner || null;
  const inserted = await sql`
    INSERT INTO opportunity_meetings (
      lead_id, sequence_no, meeting_type, status, booked_at, scheduled_for,
      booking_channel, primary_owner_id, primary_owner_name, notes, outcome_notes, meta
    ) VALUES (
      ${lead.id}, ${sequenceNo}, ${type}, 'scheduled', now(), ${scheduledFor}::timestamptz,
      ${bookingChannel}, ${primaryOwnerId || lead.owner_id || null}, ${ownerName}, ${notes}, NULL,
      ${JSON.stringify({ bookedBy: actorEmail || null })}::jsonb
    )
    RETURNING *
  `;
  const meeting = inserted[0];

  await createMeetingParticipants(sql, {
    meetingId: meeting.id,
    primaryOwnerId: primaryOwnerId || lead.owner_id || null,
    primaryOwnerName: ownerName,
    accompanyingOwnerIds,
  });

  if (nextStepSummary !== null) {
    await sql`
      UPDATE queue_leads
      SET next_step_summary = ${nextStepSummary}, last_touch_at = now(), updated_at = now()
      WHERE id = ${lead.id}
    `;
  }

  await syncLeadMeetingSummary(sql, lead.id);
  await logQueueEvent(sql, {
    leadId: lead.id,
    eventType: 'meeting_booked',
    fromStatus: lead.opportunity_stage || lead.status || null,
    toStatus: 'meeting_booked',
    ownerId: primaryOwnerId || lead.owner_id,
    ownerName,
    actorEmail,
    actorRole,
    meta: {
      meetingId: meeting.id,
      sequenceNo,
      meetingType: type,
      bookingChannel,
      scheduledFor,
      accompanyingOwnerIds,
      nextStepSummary: nextStepSummary || undefined,
    },
  });

  const meetings = await loadOpportunityMeetings(sql, lead.id);
  return meetings.find((row) => String(row.id) === String(meeting.id)) || meetingRowToClient(meeting, []);
}

async function markOpportunityMeetingOutcome(sql, {
  lead,
  meetingId = null,
  outcome,
  occurredAt = null,
  outcomeNotes = null,
  actorEmail = null,
  actorRole = null,
}) {
  const normalizedOutcome = outcome === 'attended' ? 'completed' : outcome;
  if (!MEETING_STATUSES.includes(normalizedOutcome)) return null;

  let target = null;
  if (meetingId) {
    const rows = await sql`
      SELECT *
      FROM opportunity_meetings
      WHERE id = ${meetingId} AND lead_id = ${lead.id}
      LIMIT 1
    `;
    target = rows[0] || null;
  }
  if (!target) {
    const rows = await sql`
      SELECT *
      FROM opportunity_meetings
      WHERE lead_id = ${lead.id}
        AND status = 'scheduled'
      ORDER BY scheduled_for DESC, id DESC
      LIMIT 1
    `;
    target = rows[0] || null;
  }
  if (!target) return null;

  const occurredValue = occurredAt || target.scheduled_for || new Date().toISOString();
  const canceledAt = normalizedOutcome === 'cancelled' ? occurredValue : null;
  await sql`
    UPDATE opportunity_meetings
    SET status = ${normalizedOutcome},
        occurred_at = CASE WHEN ${normalizedOutcome} IN ('completed', 'no_show') THEN ${occurredValue}::timestamptz ELSE occurred_at END,
        canceled_at = CASE WHEN ${normalizedOutcome} = 'cancelled' THEN ${canceledAt}::timestamptz ELSE canceled_at END,
        outcome_notes = COALESCE(${outcomeNotes}, outcome_notes),
        updated_at = now()
    WHERE id = ${target.id}
  `;

  await syncLeadMeetingSummary(sql, lead.id);
  await logQueueEvent(sql, {
    leadId: lead.id,
    eventType: normalizedOutcome === 'completed' ? 'meeting_attended' : (normalizedOutcome === 'no_show' ? 'meeting_no_show' : 'meeting_cancelled'),
    fromStatus: lead.opportunity_stage || null,
    toStatus: normalizedOutcome,
    ownerId: lead.owner_id,
    ownerName: lead.owner,
    actorEmail,
    actorRole,
    meta: {
      meetingId: target.id,
      sequenceNo: target.sequence_no,
      meetingType: target.meeting_type,
      occurredAt: occurredValue,
      outcomeNotes: outcomeNotes || undefined,
    },
  });

  const meetings = await loadOpportunityMeetings(sql, lead.id);
  return meetings.find((row) => String(row.id) === String(target.id)) || null;
}

export async function claimQualification(sql, id) {
  const token = crypto.randomUUID();
  const claimed = await sql`
    UPDATE queue_leads
    SET qualification_state = 'processing', qualification_token = ${token},
        qualification_started_at = now(), qualification_error = NULL, updated_at = now()
    WHERE id = ${id}
      AND archived_at IS NULL
      AND status <> 'qualified'
      AND (
        qualification_state IS NULL
        OR qualification_state = 'failed'
        OR qualification_started_at < now() - interval '15 minutes'
      )
    RETURNING *
  `;
  if (claimed[0]) return { lead: claimed[0], token, completed: false };

  const lead = await loadLead(sql, id);
  if (!lead) return { missing: true };
  if (lead.status === 'qualified' || lead.qualification_state === 'completed') {
    return { lead, completed: true };
  }
  return { lead, conflict: true };
}

async function failQualification(sql, id, token, error) {
  await sql`
    UPDATE queue_leads
    SET qualification_state = 'failed', qualification_error = ${String(error?.message || error).slice(0, 500)}, updated_at = now()
    WHERE id = ${id} AND qualification_token = ${token}
  `;
}

async function ensureEventsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS queue_events (
      id              BIGSERIAL PRIMARY KEY,
      lead_id         BIGINT NOT NULL REFERENCES queue_leads(id) ON DELETE NO ACTION,
      event_type      TEXT NOT NULL,
      from_status     TEXT,
      to_status       TEXT,
      owner_id        TEXT,
      owner_name      TEXT,
      meta            JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Harden legacy schemas: replace cascade FK so lead deletion never erases event history.
  await sql`
    DO $$
    DECLARE
      fk_name text;
      is_cascade boolean;
      lead_attnum smallint;
    BEGIN
      SELECT attnum INTO lead_attnum
      FROM pg_attribute
      WHERE attrelid = 'queue_events'::regclass
        AND attname = 'lead_id'
        AND NOT attisdropped
      LIMIT 1;

      SELECT c.conname, (c.confdeltype = 'c')
      INTO fk_name, is_cascade
      FROM pg_constraint c
      WHERE c.conrelid = 'queue_events'::regclass
        AND c.contype = 'f'
        AND lead_attnum IS NOT NULL
        AND c.conkey = ARRAY[lead_attnum]
      LIMIT 1;

      IF fk_name IS NOT NULL AND is_cascade THEN
        EXECUTE format('ALTER TABLE queue_events DROP CONSTRAINT %I', fk_name);
        ALTER TABLE queue_events
          ADD CONSTRAINT queue_events_lead_id_fkey
          FOREIGN KEY (lead_id) REFERENCES queue_leads(id) ON DELETE NO ACTION;
      ELSIF fk_name IS NULL THEN
        ALTER TABLE queue_events
          ADD CONSTRAINT queue_events_lead_id_fkey
          FOREIGN KEY (lead_id) REFERENCES queue_leads(id) ON DELETE NO ACTION;
      END IF;
    END $$;
  `;
  await sql`CREATE INDEX IF NOT EXISTS queue_events_created_idx ON queue_events (created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_events_lead_idx ON queue_events (lead_id)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_events_type_idx ON queue_events (event_type)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_events_call_owner_idx ON queue_events (created_at, owner_id) WHERE event_type = 'call'`;
}

async function ensureManualCallLogsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS manual_call_logs (
      id          BIGSERIAL PRIMARY KEY,
      owner_id    TEXT NOT NULL,
      owner_name  TEXT,
      lead_name   TEXT NOT NULL,
      lead_type   TEXT,
      notes       TEXT,
      source      TEXT NOT NULL DEFAULT 'outbound',
      meta        JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS manual_call_logs_created_idx ON manual_call_logs (created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS manual_call_logs_owner_idx ON manual_call_logs (owner_id)`;
  await sql`CREATE INDEX IF NOT EXISTS manual_call_logs_source_idx ON manual_call_logs (source)`;
}

async function ensureManualMeetingLogsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS manual_meeting_logs (
      id            BIGSERIAL PRIMARY KEY,
      owner_id      TEXT NOT NULL,
      owner_name    TEXT,
      lead_name     TEXT NOT NULL,
      lead_type     TEXT,
      notes         TEXT,
      source        TEXT NOT NULL DEFAULT 'outbound',
      meeting_date  TIMESTAMPTZ,
      meta          JSONB,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS manual_meeting_logs_created_idx ON manual_meeting_logs (created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS manual_meeting_logs_owner_idx ON manual_meeting_logs (owner_id)`;
  await sql`CREATE INDEX IF NOT EXISTS manual_meeting_logs_source_idx ON manual_meeting_logs (source)`;
}

async function ensureManualActivityBlocksTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS manual_activity_blocks (
      id            BIGSERIAL PRIMARY KEY,
      owner_id      TEXT NOT NULL,
      owner_name    TEXT,
      title         TEXT NOT NULL,
      notes         TEXT,
      source        TEXT NOT NULL DEFAULT 'outbound',
      starts_at     TIMESTAMPTZ NOT NULL,
      ends_at       TIMESTAMPTZ NOT NULL,
      meta          JSONB,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS manual_activity_blocks_owner_idx ON manual_activity_blocks (owner_id)`;
  await sql`CREATE INDEX IF NOT EXISTS manual_activity_blocks_starts_idx ON manual_activity_blocks (starts_at)`;
  await sql`CREATE INDEX IF NOT EXISTS manual_activity_blocks_ends_idx ON manual_activity_blocks (ends_at)`;
  await sql`CREATE INDEX IF NOT EXISTS manual_activity_blocks_source_idx ON manual_activity_blocks (source)`;
}

async function ensureLeadNotesTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS lead_notes (
      id          BIGSERIAL PRIMARY KEY,
      lead_id     BIGINT NOT NULL REFERENCES queue_leads(id) ON DELETE CASCADE,
      note        TEXT NOT NULL,
      owner_id    TEXT,
      owner_name  TEXT,
      source      TEXT NOT NULL DEFAULT 'manual',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS lead_notes_lead_idx ON lead_notes (lead_id, created_at)`;
}

function normalizeTimelineNoteText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function deriveLeadDetailsNoteDelta(previousValue, nextValue) {
  const previous = normalizeTimelineNoteText(previousValue);
  const next = normalizeTimelineNoteText(nextValue);
  if (!next || next === previous) return null;
  if (!previous) return next;
  if (next.startsWith(`${previous}\n`)) {
    const delta = next.slice(previous.length).trim();
    return delta || null;
  }
  return next;
}

async function createLeadTimelineNote(sql, {
  leadId,
  note,
  source = 'manual',
  ownerId = null,
  ownerName = null,
  actorEmail = null,
  actorRole = null,
  appendToCallNotes = true,
}) {
  const cleanNote = String(note || '').trim();
  if (!leadId || !cleanNote) return null;
  const cleanSource = String(source || 'manual').trim().slice(0, 64) || 'manual';

  await ensureLeadNotesTable(sql);
  const inserted = await sql`
    INSERT INTO lead_notes (lead_id, note, owner_id, owner_name, source)
    VALUES (${leadId}, ${cleanNote}, ${ownerId}, ${ownerName}, ${cleanSource})
    RETURNING id, note, owner_id, owner_name, source, created_at
  `;

  if (appendToCallNotes) {
    await sql`
      UPDATE queue_leads
      SET call_notes = CASE
            WHEN COALESCE(TRIM(call_notes), '') = '' THEN ${cleanNote}
            ELSE TRIM(BOTH E'\n' FROM call_notes || E'\n' || ${cleanNote})
          END,
          last_touch_at = now(),
          updated_at = now()
      WHERE id = ${leadId}
    `;
  }

  await logQueueEvent(sql, {
    leadId,
    eventType: 'note',
    ownerId,
    ownerName,
    actorEmail,
    actorRole,
    meta: { text: cleanNote, source: cleanSource },
  });

  const row = inserted[0] || null;
  return row ? {
    id: row.id,
    note: row.note,
    ownerId: row.owner_id || null,
    ownerName: row.owner_name || null,
    source: row.source || cleanSource,
    createdAt: row.created_at,
  } : null;
}

async function logQueueEvent(sql, {
  leadId,
  eventType,
  fromStatus = null,
  toStatus = null,
  ownerId = null,
  ownerName = null,
  actorEmail = null,
  actorRole = null,
  meta = null,
}) {
  if (!leadId || !eventType) return;
  await ensureEventsTable(sql);
  const finalMeta = (actorEmail || actorRole)
    ? { ...(meta || {}), actorEmail: actorEmail || null, actorRole: actorRole || null }
    : meta;
  await sql`
    INSERT INTO queue_events (lead_id, event_type, from_status, to_status, owner_id, owner_name, meta)
    VALUES (${leadId}, ${eventType}, ${fromStatus}, ${toStatus}, ${ownerId}, ${ownerName}, ${finalMeta ? JSON.stringify(finalMeta) : null})
  `;
}

/** Keep only the significant national digits so +44 / 0-prefixed numbers match. */
export function phoneMatchKey(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.slice(-9);
}

function normalizeOutcome(raw) {
  const original = String(raw || '').trim();
  if (!original) return null;
  const s = original.toLowerCase();

  if (s.includes('callback booked') || s === 'callback') return 'Callback booked';
  if (s.includes('wrong number') || s.includes('invalid number')) return 'Wrong number';
  if (s.includes('gatekeeper')) return 'Gatekeeper';
  if (s.includes('voicemail') || s.includes('left vm') || s.includes('left voice mail')) return 'Left voicemail';
  if (s.includes('no answer') || s.includes('unanswered') || s.includes('missed call')) return 'No answer';
  if (s.includes('answered - wants info') || s.includes('wants more info') || s.includes('asked for info')) return 'Answered - wants info';
  if (s.includes('answered - not interested') || (s.includes('not interested') && s.includes('answered'))) return 'Answered - not interested';
  if (s.includes('answered - interested') || (s.includes('interested') && s.includes('answered'))) return 'Answered - interested';
  if (s.startsWith('answered')) return 'Answered - other';
  return original;
}

/** Find the queue lead whose phone matches an inbound/outbound call number. */
export async function findLeadByPhone(sql, phone) {
  const key = phoneMatchKey(phone);
  if (!key) return null;
  const rows = await sql`
    SELECT id, name, owner, owner_id, status, phone
    FROM queue_leads
    WHERE archived_at IS NULL
      AND RIGHT(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9) = ${key}
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Record a telephony call against a lead as a `call` event and refresh the
 * lead's last-touch timestamp. Shared by the 3CX webhook and manual logging.
 */
export async function recordCall(sql, { lead, direction, fromNumber, toNumber, agent, durationSec, outcome, actionKey = null, actionLabel = null, recordingUrl, callId, provider = '3cx', startedAt = null, raw = null }) {
  if (!lead?.id) return { success: false, error: 'No matching lead' };
  await ensureEventsTable(sql);
  const canonicalOutcome = normalizeOutcome(outcome);
  const meta = {
    provider,
    direction: direction || null,
    from: fromNumber || null,
    to: toNumber || null,
    agent: agent || null,
    durationSec: Number.isFinite(Number(durationSec)) ? Number(durationSec) : null,
    outcome: canonicalOutcome,
    actionKey: actionKey || null,
    actionLabel: actionLabel || null,
    rawOutcome: outcome || null,
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
      email             TEXT,
      phone             TEXT,
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
      owner_id          TEXT,
      owner_name        TEXT,
      wave              INTEGER,
      released          BOOLEAN DEFAULT FALSE,
      released_at       TIMESTAMPTZ,
      enqueued          BOOLEAN DEFAULT FALSE,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE queue_candidates ADD COLUMN IF NOT EXISTS tier INTEGER DEFAULT 2`;
  await sql`ALTER TABLE queue_candidates ADD COLUMN IF NOT EXISTS owner_id TEXT`;
  await sql`ALTER TABLE queue_candidates ADD COLUMN IF NOT EXISTS owner_name TEXT`;
  await sql`ALTER TABLE queue_candidates ADD COLUMN IF NOT EXISTS role_fit BOOLEAN`;
  await sql`ALTER TABLE queue_candidates ADD COLUMN IF NOT EXISTS role_reason TEXT`;
  await sql`ALTER TABLE queue_candidates ADD COLUMN IF NOT EXISTS email TEXT`;
  await sql`ALTER TABLE queue_candidates ADD COLUMN IF NOT EXISTS phone TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS queue_candidates_wave_idx ON queue_candidates (wave)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_candidates_released_idx ON queue_candidates (released)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_candidates_sector_idx ON queue_candidates (sector)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_candidates_owner_idx ON queue_candidates (owner_id)`;
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
    .filter((c) => c && c.apollo_id && String(c.email || '').trim() && String(c.phone || '').trim())
    .map((c) => ({
      apollo_id: String(c.apollo_id),
      first_name: c.first_name ?? null,
      last_name: c.last_name ?? null,
      name: c.name ?? null,
      title: c.title ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
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

  if (!clean.length) return { inserted: 0, skippedWorked: 0 };

  // Dedupe within the batch: ON CONFLICT cannot affect the same row twice.
  const deduped = Array.from(new Map(clean.map((c) => [c.apollo_id, c])).values());

  // Skip companies we already have a live lead for, so waves never re-pull worked accounts.
  const filtered = await excludeAlreadyWorkedCompanies(sql, deduped);
  const skippedWorked = deduped.length - filtered.length;
  if (!filtered.length) return { inserted: 0, skippedWorked };

  const rows = await sql`
    INSERT INTO queue_candidates (
      apollo_id, first_name, last_name, name, title, email, phone, company_name, company_domain,
      company_website, company_industry, company_employees, company_revenue,
      linkedin_url, sector, sub_sector, priority, has_email, has_phone, tier
    )
    SELECT
      apollo_id, first_name, last_name, name, title, email, phone, company_name, company_domain,
      company_website, company_industry, company_employees, company_revenue,
      linkedin_url, sector, sub_sector, priority, has_email, has_phone, tier
    FROM json_to_recordset(${JSON.stringify(filtered)}::json) AS x(
      apollo_id text, first_name text, last_name text, name text, title text,
      email text, phone text, company_name text, company_domain text, company_website text, company_industry text,
      company_employees integer, company_revenue text, linkedin_url text,
      sector text, sub_sector text, priority text, has_email boolean, has_phone boolean, tier integer
    )
    ON CONFLICT (apollo_id) DO UPDATE SET
      first_name        = CASE
                            WHEN EXCLUDED.first_name IS NOT NULL AND POSITION('*' IN EXCLUDED.first_name) = 0
                              THEN EXCLUDED.first_name
                            ELSE queue_candidates.first_name
                          END,
      last_name         = CASE
                            WHEN EXCLUDED.last_name IS NOT NULL AND POSITION('*' IN EXCLUDED.last_name) = 0
                              THEN EXCLUDED.last_name
                            ELSE queue_candidates.last_name
                          END,
      name              = CASE
                            WHEN EXCLUDED.name IS NOT NULL AND POSITION('*' IN EXCLUDED.name) = 0
                              THEN EXCLUDED.name
                            ELSE queue_candidates.name
                          END,
      title             = COALESCE(EXCLUDED.title, queue_candidates.title),
      company_name      = COALESCE(EXCLUDED.company_name, queue_candidates.company_name),
      company_domain    = COALESCE(EXCLUDED.company_domain, queue_candidates.company_domain),
      sector            = COALESCE(queue_candidates.sector, EXCLUDED.sector),
      sub_sector        = COALESCE(queue_candidates.sub_sector, EXCLUDED.sub_sector),
      priority          = COALESCE(EXCLUDED.priority, queue_candidates.priority),
      has_email         = EXCLUDED.has_email,
      has_phone         = EXCLUDED.has_phone,
      tier              = LEAST(queue_candidates.tier, EXCLUDED.tier),
      email             = COALESCE(EXCLUDED.email, queue_candidates.email),
      phone             = COALESCE(EXCLUDED.phone, queue_candidates.phone),
      updated_at        = now()
    RETURNING id
  `;
  return { inserted: rows.length, skippedWorked };
}

/**
 * Drop candidates whose company already has a live (non-archived) lead in
 * queue_leads, matched by normalized company name and/or domain. Prevents
 * banking companies we've already reached out to before any credits are spent.
 */
async function excludeAlreadyWorkedCompanies(sql, candidates) {
  const names = Array.from(new Set(
    candidates.map((c) => normalizedCompanyName(c.company_name)).filter(Boolean)
  ));
  const domains = Array.from(new Set(
    candidates.map((c) => websiteHost(c.company_website) || String(c.company_domain || '').toLowerCase().replace(/^www\./, '').trim())
      .filter(Boolean)
  ));
  if (!names.length && !domains.length) return candidates;

  const rows = await sql`
    SELECT DISTINCT
      LOWER(regexp_replace(TRIM(COALESCE(company_name, '')), '\\s+', ' ', 'g')) AS name,
      LOWER(regexp_replace(COALESCE(company_website, ''), '^https?://(www\\.)?', '')) AS domain
    FROM queue_leads
    WHERE archived_at IS NULL
      AND (
        LOWER(regexp_replace(TRIM(COALESCE(company_name, '')), '\\s+', ' ', 'g')) = ANY(${names})
        OR LOWER(regexp_replace(COALESCE(company_website, ''), '^https?://(www\\.)?', '')) = ANY(${domains})
      )
    UNION
    SELECT DISTINCT
      LOWER(regexp_replace(TRIM(COALESCE(company_name, '')), '\\s+', ' ', 'g')) AS name,
      LOWER(regexp_replace(COALESCE(company_domain, ''), '^https?://(www\\.)?', '')) AS domain
    FROM queue_candidates
    WHERE LOWER(regexp_replace(TRIM(COALESCE(company_name, '')), '\\s+', ' ', 'g')) = ANY(${names})
       OR LOWER(regexp_replace(COALESCE(company_domain, ''), '^https?://(www\\.)?', '')) = ANY(${domains})
  `;
  const workedNames = new Set(rows.map((r) => r.name).filter(Boolean));
  const workedDomains = new Set(rows.map((r) => (r.domain || '').split('/')[0]).filter(Boolean));
  const seenCompanies = new Set();

  return candidates.filter((c) => {
    const name = normalizedCompanyName(c.company_name);
    const domain = websiteHost(c.company_website) || String(c.company_domain || '').toLowerCase().replace(/^www\./, '').trim();
    if (name && workedNames.has(name)) return false;
    if (domain && workedDomains.has(domain)) return false;
    const companyKey = domain ? `domain:${domain}` : (name ? `name:${name}` : `apollo:${c.apollo_id}`);
    if (seenCompanies.has(companyKey)) return false;
    seenCompanies.add(companyKey);
    return true;
  });
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
async function listCandidates(sql, { wave = null, exactWave = false, backup = false, sector = null, subSector = null, includeEnqueued = false, waveSize = 1111, roleFit = 'fit' }) {
  await ensureCandidatesTable(sql);
  const size = Math.min(Math.max(Number.parseInt(waveSize, 10) || 1111, 1), 5000);
  const isBackup = backup === true || backup === 'true' || backup === 1 || backup === '1';
  const waveNum = Number.parseInt(wave, 10);
  const w = Number.isFinite(waveNum) && waveNum >= 1 ? waveNum : 1;
  const tier1PerWave = Math.floor(size / 2);
  const tier2PerWave = size - tier1PerWave;
  const t1Lo = exactWave ? 0 : (isBackup ? tier1PerWave * 3 : tier1PerWave * (w - 1));
  const t1Hi = exactWave || isBackup ? null : tier1PerWave * w;
  const t2Lo = exactWave ? 0 : (isBackup ? tier2PerWave * 3 : tier2PerWave * (w - 1));
  const t2Hi = exactWave || isBackup ? null : tier2PerWave * w;
  const hardLimit = isBackup ? 2147483647 : 6000;
  const inc = includeEnqueued === true || includeEnqueued === 'true';
  const fitMode = roleFit === 'excluded' ? 'excluded' : (roleFit === 'all' ? 'all' : 'fit');
  const rows = await sql`
    WITH filtered AS (
      SELECT
        id, apollo_id, first_name, last_name, name, title, company_name, company_domain,
        company_website, company_industry, company_employees, company_revenue,
        linkedin_url, sector, sub_sector, priority, has_email, has_phone, tier,
        owner_id, owner_name,
        role_fit, role_reason, wave, released, released_at, enqueued, created_at, updated_at,
        COALESCE(tier, 2) AS t, COALESCE(sector, 'Unknown') AS sec
      FROM queue_candidates
      WHERE (${inc}::boolean = TRUE OR enqueued = FALSE)
      AND (${exactWave}::boolean = FALSE OR wave = ${waveNum})
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
      owner_id, owner_name,
      role_fit, role_reason, wave, released, released_at, enqueued, created_at, updated_at, rn
    FROM final_ranked
    WHERE (${sector}::text IS NULL OR sector = ${sector})
      AND (${subSector}::text IS NULL OR sub_sector = ${subSector})
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
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS direct_phone TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS company_target BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS archived_reason TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS qualification_state TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS qualification_token TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS qualification_started_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS qualification_error TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS opportunity_stage TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS mrr_value NUMERIC(12,2)`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS one_off_value NUMERIC(12,2)`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS deal_type TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS next_step_summary TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS loss_reason TEXT`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS meeting_booked_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS meeting_scheduled_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS meeting_attended_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS meeting_no_show_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS meeting_no_show_count INTEGER DEFAULT 0`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS scoping_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS proposal_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS won_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS proposal_sent_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS decision_deadline_at TIMESTAMPTZ`;
  await sql`ALTER TABLE queue_leads ADD COLUMN IF NOT EXISTS opportunity_origin TEXT`;
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
      AND archived_at IS NULL
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
      await initQueueTable();
      await initAuthTables();
      await ensureLeadColumns(sql);
      await ensureOwnersAssigned(sql);
      await initTimeOffTable();
      // One-time migration: map the old single 'contacted' status onto 'to_call_back'.
      await sql`UPDATE queue_leads SET status = 'to_call_back' WHERE status = 'contacted' AND archived_at IS NULL`;

      // Outbound visibility is shared across reps; mutations remain role/owner-gated.
      const scope = String(req.query?.source || '').toLowerCase();
      let rows;
      const repScope = isRep(identity);
      if (scope === 'inbound') {
        rows = repScope ? await sql`
          SELECT q.*, COALESCE(n.cnt, 0) AS note_count FROM queue_leads q
          LEFT JOIN (SELECT lead_id, COUNT(*)::int AS cnt FROM lead_notes GROUP BY lead_id) n ON n.lead_id = q.id
          WHERE q.source = 'inbound' AND q.owner_id = ${identity.ghlOwnerId} AND q.archived_at IS NULL
          ORDER BY q.created_at DESC
        ` : await sql`
          SELECT q.*, COALESCE(n.cnt, 0) AS note_count FROM queue_leads q
          LEFT JOIN (SELECT lead_id, COUNT(*)::int AS cnt FROM lead_notes GROUP BY lead_id) n ON n.lead_id = q.id
          WHERE q.source = 'inbound' AND q.archived_at IS NULL
          ORDER BY q.created_at DESC
        `;
      } else if (scope === 'outbound') {
        rows = await sql`
          SELECT q.*, COALESCE(n.cnt, 0) AS note_count FROM queue_leads q
          LEFT JOIN (SELECT lead_id, COUNT(*)::int AS cnt FROM lead_notes GROUP BY lead_id) n ON n.lead_id = q.id
          WHERE q.source IS DISTINCT FROM 'inbound' AND q.archived_at IS NULL
          ORDER BY
            CASE q.priority WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
            q.created_at DESC
        `;
      } else {
        rows = repScope ? await sql`
          SELECT q.*, COALESCE(n.cnt, 0) AS note_count FROM queue_leads q
          LEFT JOIN (SELECT lead_id, COUNT(*)::int AS cnt FROM lead_notes GROUP BY lead_id) n ON n.lead_id = q.id
          WHERE q.owner_id = ${identity.ghlOwnerId}
            AND q.archived_at IS NULL
          ORDER BY
            CASE q.priority WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
            q.created_at DESC
        ` : await sql`
          SELECT q.*, COALESCE(n.cnt, 0) AS note_count FROM queue_leads q
          LEFT JOIN (SELECT lead_id, COUNT(*)::int AS cnt FROM lead_notes GROUP BY lead_id) n ON n.lead_id = q.id
          WHERE q.archived_at IS NULL
          ORDER BY
            CASE q.priority WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
            q.created_at DESC
        `;
      }
      const contacts = rows.map(rowToClient);
      const groups = new Map();
      for (const contact of contacts) {
        const key = companyGroupKeyFromRow(contact);
        contact.companyKey = key;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(contact);
      }
      for (const members of groups.values()) {
        let target = members
          .filter((m) => m.companyTarget)
          .sort((a, b) => computeCompanyScore(b) - computeCompanyScore(a))[0];
        if (!target) {
          target = members
            .filter((m) => isWorkedContact(m))
            .sort((a, b) => computeCompanyScore(b) - computeCompanyScore(a))[0];
        }
        if (!target) {
          target = members
            .filter((m) => !isCoveredDisposition(m.disposition))
            .sort((a, b) => computeCompanyScore(b) - computeCompanyScore(a))[0];
        }
        if (!target) target = members.sort((a, b) => computeCompanyScore(b) - computeCompanyScore(a))[0] || null;
        const targetId = target ? String(target.id) : null;
        const peers = targetId
          ? members
            .filter((m) => String(m.id) !== targetId)
            .sort((a, b) => computeCompanyScore(b) - computeCompanyScore(a))
          : [];
        const peerNames = peers.map((p) => p.name).filter(Boolean);
        const peerPeople = peers
          .map((p) => ({
            id: p.id,
            name: p.name || null,
            title: p.title || null,
            status: p.status || null,
            owner: p.owner || null,
          }))
          .filter((p) => p.name);
        for (const member of members) {
          member.companyPeerCount = members.length;
          member.companyTargetLeadId = targetId;
          member.companyIsTarget = !!targetId && String(member.id) === targetId;
          member.companyLocked = !!targetId && String(member.id) !== targetId;
          member.companyPeerNames = peerNames;
          member.companyPeerNamesText = peerNames.join(', ');
          member.companyPeerPeople = peerPeople;
        }
      }

      // Keep call-list dedupe (one active target per company), but never hide
      // qualified/opportunity records or they disappear from opportunities.html.
      const visibleContacts = contacts.filter((contact) => {
        if (!contact.companyLocked) return true;
        return contact.status === 'qualified' || !!contact.opportunityStage;
      });
      const grouped = Object.fromEntries(STATUSES.map((s) => [s, []]));
      visibleContacts.forEach((c) => (grouped[c.status] || grouped.to_contact).push(c));

      const timeOffRows = await sql`
        SELECT owner_id, day_part, hours_off
        FROM rep_time_off
        WHERE canceled_at IS NULL
          AND start_date <= (now() AT TIME ZONE 'Europe/London')::date
          AND end_date >= (now() AT TIME ZONE 'Europe/London')::date
      `;
      const timeOffTodayByOwner = {};
      for (const row of timeOffRows) {
        const ownerId = String(row.owner_id || '').trim();
        if (!ownerId) continue;
        const hours = timeOffHoursForPart(row.day_part, row.hours_off);
        if (!timeOffTodayByOwner[ownerId]) {
          timeOffTodayByOwner[ownerId] = { hoursOff: 0, entryCount: 0, isOff: false };
        }
        timeOffTodayByOwner[ownerId].hoursOff = Math.min(8, Number(timeOffTodayByOwner[ownerId].hoursOff || 0) + hours);
        timeOffTodayByOwner[ownerId].entryCount += 1;
        timeOffTodayByOwner[ownerId].isOff = timeOffTodayByOwner[ownerId].hoursOff > 0;
      }

      return res.status(200).json({ success: true, contacts: visibleContacts, grouped, timeOffTodayByOwner });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const declaredBytes = Number.parseInt(req.headers?.['content-length'] || '0', 10);
    const bodyBytes = Number.isFinite(declaredBytes) && declaredBytes > 0
      ? declaredBytes
      : Buffer.byteLength(JSON.stringify(body), 'utf8');
    if (bodyBytes > 2 * 1024 * 1024) {
      return res.status(413).json({ success: false, error: 'Request body too large' });
    }
    const action = body.action || 'enqueue';
    const bulkField = ['enqueue', 'enrich-wave'].includes(action)
      ? 'contacts'
      : action === 'bank-candidates'
        ? 'candidates'
        : ['patch-phones', 'patch-lead-fields', 'patch-phones-force', 'set-phones'].includes(action)
          ? 'updates'
          : null;
    if (bulkField && !Array.isArray(body[bulkField])) {
      return res.status(400).json({ success: false, error: `${bulkField} array required` });
    }
    if (bulkField && body[bulkField].length > MAX_BULK_ITEMS) {
      return res.status(413).json({ success: false, error: `${bulkField} exceeds ${MAX_BULK_ITEMS} items` });
    }

    // Permission gate: every action has a minimum role (see session.js).
    if (!canRunAction(identity, action)) {
      return res.status(403).json({ success: false, error: 'You do not have permission for this action' });
    }

    const retiredManualLogActions = new Set([
      'log-manual-call',
      'log-manual-meeting',
      'manual-calls-recent',
      'manual-call-update',
      'manual-meetings-recent',
      'manual-meeting-update',
    ]);
    if (retiredManualLogActions.has(action)) {
      return res.status(410).json({
        success: false,
        error: 'Manual call/meeting logging has been retired. Use activity blocks instead.',
      });
    }

    try {
      await initQueueTable();
      await initAuthTables();
      await ensureLeadColumns(sql);
      // ── Enqueue MCP-curated contacts into staging (no GHL write) ──────────
      if (action === 'enqueue') {
        const contacts = Array.isArray(body.contacts) ? body.contacts : [];
        const normalized = contacts.map((raw) => normalizeContact(raw));

        // forced_owner_id pins every contact in this batch to a specific rep (used for per-rep list imports).
        const forcedRep = body.forced_owner_id ? repById(String(body.forced_owner_id)) : null;
        if (body.forced_owner_id && !forcedRep) {
          return res.status(400).json({ success: false, error: `Unknown forced_owner_id: ${body.forced_owner_id}` });
        }

        const apolloIds = Array.from(new Set(normalized.map((lead) => lead.apollo_id).filter(Boolean)));
        const candidateOwners = (!forcedRep && apolloIds.length) ? await sql`
          SELECT apollo_id, owner_id, owner_name
          FROM queue_candidates
          WHERE apollo_id = ANY(${apolloIds}::text[])
        ` : [];
        const ownerMap = new Map(candidateOwners.map((row) => [String(row.apollo_id), {
          id: row.owner_id,
          name: row.owner_name || repById(row.owner_id)?.name || null,
        }]));
        let inserted = 0;
        for (const lead of normalized) {
          // When a rep is forced, skip candidate-map and company-match lookups entirely.
          const owner = forcedRep ? null : (lead.apollo_id ? ownerMap.get(String(lead.apollo_id)) || null : null);
          inserted += await upsertLead(sql, lead, forcedRep || owner, !!forcedRep);
          if (lead.apollo_id) {
            await sql`
              UPDATE queue_candidates
              SET enqueued = TRUE, updated_at = now()
              WHERE apollo_id = ${String(lead.apollo_id)}
            `;
          }
          if (lead.email) {
            const row = await sql`SELECT id, owner_id, owner FROM queue_leads WHERE email = ${lead.email} AND archived_at IS NULL LIMIT 1`;
            if (row[0]?.id) {
              await logQueueEvent(sql, {
                leadId: row[0].id,
                eventType: 'ingest',
                ownerId: row[0].owner_id,
                ownerName: row[0].owner,
                meta: { source: forcedRep ? 'apollo-list' : 'enqueue', forcedOwner: forcedRep?.id || null },
              });
            }
          }
        }
        return res.status(200).json({ success: true, action, inserted });
      }

      // ── Bank pre-enrichment candidates (no credits, no GHL, off-board) ────
      if (action === 'bank-candidates') {
        const result = await bankCandidates(sql, body.candidates);
        return res.status(200).json({ success: true, action, inserted: result.inserted, skippedWorked: result.skippedWorked });
      }

      // ── Enrich + promote: takes Apollo-enriched contacts, updates candidate
      //    email/phone, then upserts them into queue_leads respecting owner assignments.
      if (action === 'enrich-wave') {
        const contacts = Array.isArray(body.contacts) ? body.contacts : [];
        if (!contacts.length) return res.status(400).json({ success: false, error: 'contacts array required' });
        await ensureCandidatesTable(sql);
        await ensureLeadColumns(sql);

        const apolloIds = contacts.map((c) => c.apollo_id).filter(Boolean);
        const ownerRows = apolloIds.length ? await sql`
          SELECT apollo_id, owner_id, owner_name FROM queue_candidates WHERE apollo_id = ANY(${apolloIds}::text[])
        ` : [];
        const ownerMap = new Map(ownerRows.map((r) => [String(r.apollo_id), { id: r.owner_id, name: r.owner_name }]));

        let promoted = 0;
        for (const c of contacts) {
          if (!c.email) continue;
          if (c.apollo_id) {
            await sql`
              UPDATE queue_candidates
              SET
                email = ${c.email},
                phone = ${c.phone || null},
                first_name = CASE
                  WHEN ${c.first_name || null} IS NOT NULL AND POSITION('*' IN ${c.first_name || null}) = 0
                    THEN ${c.first_name || null}
                  ELSE first_name
                END,
                last_name = CASE
                  WHEN ${c.last_name || null} IS NOT NULL AND POSITION('*' IN ${c.last_name || null}) = 0
                    THEN ${c.last_name || null}
                  ELSE last_name
                END,
                name = CASE
                  WHEN ${c.name || null} IS NOT NULL AND POSITION('*' IN ${c.name || null}) = 0
                    THEN ${c.name || null}
                  ELSE name
                END,
                has_email = TRUE,
                has_phone = COALESCE(${Boolean(c.phone)}, has_phone),
                updated_at = now()
              WHERE apollo_id = ${String(c.apollo_id)}
            `;
          }
          const owner = c.apollo_id ? ownerMap.get(String(c.apollo_id)) || null : null;
          const firstName = c.first_name || null;
          const lastName = c.last_name || null;
          const fullName = c.name || [firstName, lastName].filter(Boolean).join(' ') || null;
          // Use the flat contact object directly — normalizeContact expects a nested Apollo shape.
          const lead = {
            apollo_id: c.apollo_id || null,
            first_name: firstName,
            last_name: lastName,
            name: fullName,
            title: c.title || null,
            email: c.email,
            phone: c.phone || null,
            company_name: c.company_name || null,
            company_website: c.company_website || null,
            company_industry: c.company_industry || null,
            sector: c.sector || null,
            sub_sector: c.sub_sector || null,
            company_employees: c.company_employees || null,
            company_revenue: c.company_revenue || null,
            linkedin_url: c.linkedin_url || null,
            priority: c.priority || 'warm',
            raw: c,
          };
          promoted += await upsertLead(sql, lead, owner);
          if (c.apollo_id) {
            await sql`UPDATE queue_candidates SET enqueued = TRUE, updated_at = now() WHERE apollo_id = ${String(c.apollo_id)}`;
          }
        }
        return res.status(200).json({ success: true, action, received: contacts.length, promoted });
      }

      // ── Backfill company/sector on leads that were inserted before the fix ─
      if (action === 'repair-lead-data') {
        await ensureCandidatesTable(sql);
        // Join by email since leads may have null apollo_id from the pre-fix path.
        const result = await sql`
          UPDATE queue_leads ql
          SET
            apollo_id         = COALESCE(ql.apollo_id, qc.apollo_id),
            company_name      = COALESCE(ql.company_name, qc.company_name),
            company_website   = COALESCE(ql.company_website, qc.company_website),
            company_industry  = COALESCE(ql.company_industry, qc.company_industry),
            company_employees = COALESCE(ql.company_employees, qc.company_employees),
            company_revenue   = COALESCE(ql.company_revenue, qc.company_revenue),
            linkedin_url      = COALESCE(ql.linkedin_url, qc.linkedin_url),
            sector            = COALESCE(ql.sector, qc.sector),
            sub_sector        = COALESCE(ql.sub_sector, qc.sub_sector),
            updated_at        = now()
          FROM queue_candidates qc
          WHERE ql.email = qc.email
            AND qc.email IS NOT NULL
            AND (
              ql.company_name IS NULL OR ql.sector IS NULL OR
              ql.company_employees IS NULL OR ql.apollo_id IS NULL
            )
          RETURNING ql.id
        `;
        return res.status(200).json({ success: true, action, repaired: result.length });
      }

      // ── Bulk-patch phone numbers (called by the repair-phones script) ─────
      if (action === 'patch-phones') {
        const updates = Array.isArray(body.updates) ? body.updates : [];
        if (!updates.length) return res.status(400).json({ success: false, error: 'updates array required' });
        let patched = 0;
        for (const u of updates) {
          if (!u.id || !u.phone) continue;
          await sql`UPDATE queue_leads SET phone = ${u.phone}, updated_at = now() WHERE id = ${u.id} AND phone IS NULL`;
          patched++;
        }
        return res.status(200).json({ success: true, action, patched });
      }

      // ── Bulk-patch org fields missing from the original enrichment run ────
      if (action === 'patch-lead-fields') {
        const updates = Array.isArray(body.updates) ? body.updates : [];
        if (!updates.length) return res.status(400).json({ success: false, error: 'updates array required' });
        let patched = 0;
        for (const u of updates) {
          if (!u.id) continue;
          await sql`
            UPDATE queue_leads SET
              phone             = COALESCE(phone, ${u.phone || null}),
              direct_phone      = COALESCE(direct_phone, ${u.direct_phone || null}),
              company_website   = COALESCE(company_website, ${u.company_website || null}),
              company_employees = COALESCE(company_employees, ${u.company_employees != null ? u.company_employees : null}),
              company_revenue   = COALESCE(company_revenue, ${u.company_revenue || null}),
              linkedin_url      = COALESCE(linkedin_url, ${u.linkedin_url || null}),
              updated_at        = now()
            WHERE id = ${u.id}
          `;
          patched++;
        }
        return res.status(200).json({ success: true, action, patched });
      }

      // ── Move misplaced mobile numbers from phone → direct_phone ───────────
      if (action === 'fix-mobile-phones') {
        const moved = await sql`
          UPDATE queue_leads
          SET direct_phone = phone, phone = NULL, updated_at = now()
          WHERE phone ~ '^\\+44 ?7' AND direct_phone IS NULL
          RETURNING id, name, phone AS was_phone, direct_phone
        `;
        return res.status(200).json({ success: true, action, moved: moved.length, leads: moved.map((r) => r.name) });
      }

      // ── Force-update both phone fields (used when re-enriching already-set rows) ─
      if (action === 'patch-phones-force') {
        const updates = Array.isArray(body.updates) ? body.updates : [];
        let patched = 0;
        for (const u of updates) {
          if (!u.id) continue;
          await sql`
            UPDATE queue_leads SET
              phone        = COALESCE(${u.phone || null}, phone),
              direct_phone = COALESCE(${u.direct_phone || null}, direct_phone),
              updated_at   = now()
            WHERE id = ${u.id}
          `;
          patched++;
        }
        return res.status(200).json({ success: true, action, patched });
      }

      // ── Set both phone fields explicitly (null allowed — full overwrite) ──
      if (action === 'set-phones') {
        const updates = Array.isArray(body.updates) ? body.updates : [];
        let patched = 0;
        for (const u of updates) {
          if (!u.id) continue;
          await sql`
            UPDATE queue_leads SET
              phone        = ${u.phone ?? null},
              direct_phone = ${u.direct_phone ?? null},
              updated_at   = now()
            WHERE id = ${u.id}
          `;
          patched++;
        }
        return res.status(200).json({ success: true, action, patched });
      }

      // ── Null out office phone where it duplicates the direct dial ─────────
      if (action === 'dedupe-phones') {
        const fixed = await sql`
          UPDATE queue_leads
          SET phone = NULL, updated_at = now()
          WHERE direct_phone IS NOT NULL
            AND regexp_replace(COALESCE(phone,''), '\\D', '', 'g') = regexp_replace(direct_phone, '\\D', '', 'g')
          RETURNING id
        `;
        return res.status(200).json({ success: true, action, deduped: fixed.length });
      }

      // ── Vet every candidate by job role (flag non-buyers, delete nothing) ─
      if (action === 'vet-roles') {
        const summary = await vetRoles(sql);
        return res.status(200).json({ success: true, action, ...summary });
      }

      // ── Rep gamification: per-owner call & outcome stats for achievements ─
      if (action === 'achievements') {
        await ensureEventsTable(sql);
        await ensureManualCallLogsTable(sql);
        await initTimeOffTable();
        const callRows = await sql`
          WITH call_activity AS (
            SELECT
              COALESCE(qe.owner_id, ql.owner_id) AS owner_id,
              COALESCE(qe.owner_name, ql.owner) AS owner_name,
              COALESCE(qe.meta->>'outcome', '') AS outcome,
              COALESCE(qe.meta->>'actionKey', '') AS action_key,
              qe.created_at AS created_at
            FROM queue_events qe
            JOIN queue_leads ql ON ql.id = qe.lead_id
            WHERE qe.event_type = 'call'
              AND COALESCE(qe.owner_id, ql.owner_id) IS NOT NULL

            UNION ALL

            SELECT
              m.owner_id,
              COALESCE(m.owner_name, '') AS owner_name,
              '' AS outcome,
              'manual_old_lead' AS action_key,
              m.created_at AS created_at
            FROM manual_call_logs m
            WHERE m.owner_id IS NOT NULL
          )
          SELECT owner_id,
            MAX(owner_name) AS owner_name,
            COUNT(*)::int AS calls,
            COUNT(*) FILTER (WHERE outcome ILIKE 'Answered%')::int AS answered,
            COUNT(*) FILTER (WHERE outcome = 'Answered - interested')::int AS interested,
            COUNT(*) FILTER (WHERE outcome ILIKE 'No answer%')::int AS no_answer,
            COUNT(*) FILTER (WHERE outcome ILIKE '%voicemail%')::int AS voicemail,
            COUNT(*) FILTER (WHERE outcome = 'Gatekeeper')::int AS gatekeeper,
            COUNT(*) FILTER (WHERE outcome = 'Wrong number')::int AS wrong_number,
            COUNT(*) FILTER (WHERE outcome ILIKE '%not interested%')::int AS not_interested,
            COUNT(*) FILTER (
              WHERE DATE(created_at AT TIME ZONE 'Europe/London') = (now() AT TIME ZONE 'Europe/London')::date
                AND action_key NOT IN ('answered_interested', 'wants_info_callback', 'gatekeeper_callback')
            )::int AS non_callback_calls_today,
            COUNT(*) FILTER (
              WHERE DATE(created_at AT TIME ZONE 'Europe/London') = (now() AT TIME ZONE 'Europe/London')::date
            )::int AS calls_today
          FROM call_activity
          GROUP BY owner_id
        `;
        const callbackRows = await sql`
          WITH candidates AS (
            SELECT ql.*,
              CASE
                WHEN regexp_replace(COALESCE(ql.phone, ''), '\\D', '', 'g') <> ''
                  THEN 'phone:' || right(regexp_replace(ql.phone, '\\D', '', 'g'), 9)
                WHEN COALESCE(ql.company_website, '') <> ''
                  THEN 'domain:' || lower(regexp_replace(regexp_replace(ql.company_website, '^https?://(www\\.)?', ''), '/.*$', ''))
                WHEN COALESCE(ql.company_name, '') <> '' THEN 'name:' || lower(trim(ql.company_name))
                ELSE 'lead:' || ql.id::text
              END AS company_key,
              right(regexp_replace(COALESCE(ql.phone, ql.direct_phone, ''), '\\D', '', 'g'), 9) AS callable_key
            FROM queue_leads ql
            WHERE ql.callback_at IS NOT NULL
              AND ql.archived_at IS NULL
              AND ql.owner_id IS NOT NULL
              AND COALESCE(ql.disposition, '') NOT ILIKE '%covered by colleague%'
              AND COALESCE(ql.disposition, '') NOT ILIKE '%already worked this company%'
          ), ranked AS (
            SELECT *, ROW_NUMBER() OVER (
              PARTITION BY company_key
              ORDER BY company_target DESC NULLS LAST,
                CASE priority WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
                created_at, id
            ) AS company_rank
            FROM candidates
          ), deduped AS (
            SELECT DISTINCT ON (company_key, callable_key) *
            FROM ranked
            WHERE company_rank = 1
            ORDER BY company_key, callable_key, id
          )
          SELECT owner_id, MAX(owner) AS owner_name, COUNT(*)::int AS callbacks
          FROM deduped
          GROUP BY owner_id
        `;
        const statusRows = await sql`
          SELECT COALESCE(qe.owner_id, ql.owner_id) AS owner_id,
            MAX(COALESCE(qe.owner_name, ql.owner)) AS owner_name,
            COUNT(*) FILTER (WHERE to_status = 'qualified')::int AS qualified,
            COUNT(*) FILTER (WHERE to_status = 'to_call_back')::int AS warmed,
            COUNT(*) FILTER (WHERE to_status = 'wants_more_info')::int AS heated
          FROM queue_events qe
          JOIN queue_leads ql ON ql.id = qe.lead_id
          WHERE qe.event_type = 'status_change' AND COALESCE(qe.owner_id, ql.owner_id) IS NOT NULL
          GROUP BY COALESCE(qe.owner_id, ql.owner_id)
        `;
        const callbacksTodayRows = await sql`
          WITH candidates AS (
            SELECT ql.*,
              CASE
                WHEN regexp_replace(COALESCE(ql.phone, ''), '\\D', '', 'g') <> ''
                  THEN 'phone:' || right(regexp_replace(ql.phone, '\\D', '', 'g'), 9)
                WHEN COALESCE(ql.company_website, '') <> ''
                  THEN 'domain:' || lower(regexp_replace(regexp_replace(ql.company_website, '^https?://(www\\.)?', ''), '/.*$', ''))
                WHEN COALESCE(ql.company_name, '') <> '' THEN 'name:' || lower(trim(ql.company_name))
                ELSE 'lead:' || ql.id::text
              END AS company_key,
              right(regexp_replace(COALESCE(ql.phone, ql.direct_phone, ''), '\\D', '', 'g'), 9) AS callable_key
            FROM queue_leads ql
            WHERE ql.callback_at IS NOT NULL
              AND ql.archived_at IS NULL
              AND ql.owner_id IS NOT NULL
              AND ql.status IN ('to_call_back', 'wants_more_info')
              AND DATE(ql.callback_at AT TIME ZONE 'Europe/London') = (now() AT TIME ZONE 'Europe/London')::date
              AND COALESCE(ql.disposition, '') NOT ILIKE 'no answer%'
              AND COALESCE(ql.disposition, '') NOT ILIKE '%covered by colleague%'
              AND COALESCE(ql.disposition, '') NOT ILIKE '%already worked this company%'
          ), ranked AS (
            SELECT *, ROW_NUMBER() OVER (
              PARTITION BY company_key
              ORDER BY company_target DESC NULLS LAST,
                CASE priority WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
                created_at, id
            ) AS company_rank
            FROM candidates
          ), deduped AS (
            SELECT DISTINCT ON (company_key, callable_key) *
            FROM ranked
            WHERE company_rank = 1
            ORDER BY company_key, callable_key, id
          )
          SELECT owner_id, MAX(owner) AS owner_name, COUNT(*)::int AS callbacks_today
          FROM deduped
          GROUP BY owner_id
        `;
        const avgNonCallbackRows = await sql`
          WITH owners AS (
            SELECT DISTINCT owner_id
            FROM queue_leads
            WHERE owner_id IS NOT NULL
          ), window_days AS (
            SELECT generate_series(
              ((now() AT TIME ZONE 'Europe/London')::date - 30)::timestamp,
              ((now() AT TIME ZONE 'Europe/London')::date - 1)::timestamp,
              interval '1 day'
            )::date AS day_key
          ), owner_days AS (
            SELECT o.owner_id, d.day_key
            FROM owners o
            CROSS JOIN window_days d
            WHERE EXTRACT(ISODOW FROM d.day_key) BETWEEN 1 AND 5
          ), time_off_daily AS (
            SELECT
              r.owner_id,
              day_key,
              LEAST(8, SUM(
                CASE
                  WHEN lower(COALESCE(r.day_part, '')) = 'full' THEN 8
                  WHEN lower(COALESCE(r.day_part, '')) IN ('am', 'pm') THEN 4
                  WHEN lower(COALESCE(r.day_part, '')) = 'hours' THEN GREATEST(0, LEAST(8, COALESCE(r.hours_off, 0)))
                  ELSE 0
                END
              ))::float8 AS hours_off
            FROM rep_time_off r
            CROSS JOIN LATERAL generate_series(r.start_date::timestamp, r.end_date::timestamp, interval '1 day') AS d(day_key)
            WHERE r.canceled_at IS NULL
              AND day_key::date >= ((now() AT TIME ZONE 'Europe/London')::date - 30)
              AND day_key::date < (now() AT TIME ZONE 'Europe/London')::date
            GROUP BY r.owner_id, day_key
          ), non_callback_calls AS (
            SELECT
              COALESCE(qe.owner_id, ql.owner_id) AS owner_id,
              DATE(qe.created_at AT TIME ZONE 'Europe/London') AS day_key,
              COUNT(*) FILTER (
                WHERE COALESCE(qe.meta->>'actionKey', '') NOT IN ('answered_interested', 'wants_info_callback', 'gatekeeper_callback')
              )::int AS non_callback_calls
            FROM queue_events qe
            JOIN queue_leads ql ON ql.id = qe.lead_id
            WHERE qe.event_type = 'call'
              AND COALESCE(qe.owner_id, ql.owner_id) IS NOT NULL
              AND DATE(qe.created_at AT TIME ZONE 'Europe/London') >= ((now() AT TIME ZONE 'Europe/London')::date - 30)
              AND DATE(qe.created_at AT TIME ZONE 'Europe/London') < (now() AT TIME ZONE 'Europe/London')::date
            GROUP BY COALESCE(qe.owner_id, ql.owner_id), DATE(qe.created_at AT TIME ZONE 'Europe/London')
          ), eligible_days AS (
            SELECT
              od.owner_id,
              od.day_key,
              COALESCE(td.hours_off, 0)::float8 AS hours_off,
              COALESCE(nc.non_callback_calls, 0)::int AS non_callback_calls
            FROM owner_days od
            LEFT JOIN time_off_daily td ON td.owner_id = od.owner_id AND td.day_key::date = od.day_key
            LEFT JOIN non_callback_calls nc ON nc.owner_id = od.owner_id AND nc.day_key = od.day_key
            WHERE COALESCE(td.hours_off, 0) < 8
          )
          SELECT
            owner_id,
            COALESCE(SUM(non_callback_calls)::float8 / NULLIF(COUNT(*), 0), 0) AS avg_non_callback_calls_daily
          FROM eligible_days
          GROUP BY owner_id
        `;
        const previousWorkingDayRows = await sql`
          WITH owners AS (
            SELECT DISTINCT owner_id
            FROM queue_leads
            WHERE owner_id IS NOT NULL
          ), window_days AS (
            SELECT generate_series(
              ((now() AT TIME ZONE 'Europe/London')::date - 14)::timestamp,
              ((now() AT TIME ZONE 'Europe/London')::date - 1)::timestamp,
              interval '1 day'
            )::date AS day_key
          ), owner_days AS (
            SELECT o.owner_id, d.day_key
            FROM owners o
            CROSS JOIN window_days d
            WHERE EXTRACT(ISODOW FROM d.day_key) BETWEEN 1 AND 5
          ), time_off_daily AS (
            SELECT
              r.owner_id,
              day_key,
              LEAST(8, SUM(
                CASE
                  WHEN lower(COALESCE(r.day_part, '')) = 'full' THEN 8
                  WHEN lower(COALESCE(r.day_part, '')) IN ('am', 'pm') THEN 4
                  WHEN lower(COALESCE(r.day_part, '')) = 'hours' THEN GREATEST(0, LEAST(8, COALESCE(r.hours_off, 0)))
                  ELSE 0
                END
              ))::float8 AS hours_off
            FROM rep_time_off r
            CROSS JOIN LATERAL generate_series(r.start_date::timestamp, r.end_date::timestamp, interval '1 day') AS d(day_key)
            WHERE r.canceled_at IS NULL
              AND day_key::date >= ((now() AT TIME ZONE 'Europe/London')::date - 14)
              AND day_key::date < (now() AT TIME ZONE 'Europe/London')::date
            GROUP BY r.owner_id, day_key
          ), call_counts AS (
            SELECT
              COALESCE(qe.owner_id, ql.owner_id) AS owner_id,
              DATE(qe.created_at AT TIME ZONE 'Europe/London') AS day_key,
              COUNT(*)::int AS call_count
            FROM queue_events qe
            JOIN queue_leads ql ON ql.id = qe.lead_id
            WHERE qe.event_type = 'call'
              AND COALESCE(qe.owner_id, ql.owner_id) IS NOT NULL
              AND DATE(qe.created_at AT TIME ZONE 'Europe/London') >= ((now() AT TIME ZONE 'Europe/London')::date - 14)
              AND DATE(qe.created_at AT TIME ZONE 'Europe/London') < (now() AT TIME ZONE 'Europe/London')::date
            GROUP BY COALESCE(qe.owner_id, ql.owner_id), DATE(qe.created_at AT TIME ZONE 'Europe/London')
          ), eligible_days AS (
            SELECT
              od.owner_id,
              od.day_key,
              COALESCE(cc.call_count, 0)::int AS call_count,
              COALESCE(td.hours_off, 0)::float8 AS hours_off
            FROM owner_days od
            LEFT JOIN call_counts cc ON cc.owner_id = od.owner_id AND cc.day_key = od.day_key
            LEFT JOIN time_off_daily td ON td.owner_id = od.owner_id AND td.day_key::date = od.day_key
            WHERE COALESCE(td.hours_off, 0) < 8
          ), ranked AS (
            SELECT
              owner_id,
              day_key,
              call_count,
              ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY day_key DESC) AS rn
            FROM eligible_days
          )
          SELECT
            owner_id,
            day_key AS previous_working_day_key,
            call_count AS previous_working_day_calls
          FROM ranked
          WHERE rn = 1
        `;
        const timeOffTodayRows = await sql`
          SELECT
            owner_id,
            LEAST(8, SUM(
              CASE
                WHEN lower(COALESCE(day_part, '')) = 'full' THEN 8
                WHEN lower(COALESCE(day_part, '')) IN ('am', 'pm') THEN 4
                WHEN lower(COALESCE(day_part, '')) = 'hours' THEN GREATEST(0, LEAST(8, COALESCE(hours_off, 0)))
                ELSE 0
              END
            ))::float8 AS hours_off_today
          FROM rep_time_off
          WHERE canceled_at IS NULL
            AND start_date <= (now() AT TIME ZONE 'Europe/London')::date
            AND end_date >= (now() AT TIME ZONE 'Europe/London')::date
          GROUP BY owner_id
        `;
        const map = new Map();
        const blank = () => ({ calls: 0, answered: 0, interested: 0, noAnswer: 0, voicemail: 0, gatekeeper: 0, wrongNumber: 0, callbacks: 0, callbacksToday: 0, avgNonCallbackCallsDaily: 0, adjustedNonCallbackPace: 0, remainingNonCallbackToday: 0, predictedCallVolumeToday: 0, yesterdayCalls: 0, previousWorkingDayCalls: 0, previousWorkingDayDate: null, hoursOffToday: 0, notInterested: 0, callsToday: 0, nonCallbackCallsToday: 0, qualified: 0, warmed: 0, heated: 0 });
        for (const rep of ROUND_ROBIN) {
          map.set(rep.id, { ownerId: rep.id, ownerName: rep.name, ...blank() });
        }
        for (const r of callRows) {
          const s = map.get(r.owner_id) || { ownerId: r.owner_id, ownerName: r.owner_name, ...blank() };
          s.ownerName = s.ownerName || r.owner_name;
          Object.assign(s, {
            calls: r.calls, answered: r.answered, interested: r.interested, noAnswer: r.no_answer,
            voicemail: r.voicemail, gatekeeper: r.gatekeeper, wrongNumber: r.wrong_number,
            notInterested: r.not_interested, callsToday: r.calls_today,
            nonCallbackCallsToday: r.non_callback_calls_today,
          });
          map.set(r.owner_id, s);
        }
        for (const r of callbackRows) {
          const s = map.get(r.owner_id) || { ownerId: r.owner_id, ownerName: r.owner_name, ...blank() };
          s.ownerName = s.ownerName || r.owner_name;
          s.callbacks = r.callbacks;
          map.set(r.owner_id, s);
        }
        for (const r of callbacksTodayRows) {
          const s = map.get(r.owner_id) || { ownerId: r.owner_id, ownerName: r.owner_name, ...blank() };
          s.ownerName = s.ownerName || r.owner_name;
          s.callbacksToday = r.callbacks_today || 0;
          map.set(r.owner_id, s);
        }
        for (const r of avgNonCallbackRows) {
          const s = map.get(r.owner_id) || { ownerId: r.owner_id, ownerName: null, ...blank() };
          s.avgNonCallbackCallsDaily = Number.isFinite(r.avg_non_callback_calls_daily)
            ? Number(r.avg_non_callback_calls_daily)
            : 0;
          map.set(r.owner_id, s);
        }
        for (const r of previousWorkingDayRows) {
          const s = map.get(r.owner_id) || { ownerId: r.owner_id, ownerName: null, ...blank() };
          const prevCalls = Number(r.previous_working_day_calls) || 0;
          s.previousWorkingDayCalls = prevCalls;
          s.yesterdayCalls = prevCalls;
          s.previousWorkingDayDate = r.previous_working_day_key || null;
          map.set(r.owner_id, s);
        }
        for (const r of timeOffTodayRows) {
          const s = map.get(r.owner_id) || { ownerId: r.owner_id, ownerName: null, ...blank() };
          s.hoursOffToday = Number(r.hours_off_today) || 0;
          map.set(r.owner_id, s);
        }
        for (const r of statusRows) {
          const s = map.get(r.owner_id) || { ownerId: r.owner_id, ownerName: r.owner_name, ...blank() };
          s.ownerName = s.ownerName || r.owner_name;
          s.qualified = r.qualified; s.warmed = r.warmed; s.heated = r.heated;
          map.set(r.owner_id, s);
        }
        for (const s of map.values()) {
          const hoursOff = Math.max(0, Math.min(8, Number(s.hoursOffToday || 0)));
          const availability = Math.max(0, Math.min(1, (8 - hoursOff) / 8));
          s.adjustedNonCallbackPace = (s.avgNonCallbackCallsDaily || 0) * availability;
          s.remainingNonCallbackToday = Math.max(0, s.adjustedNonCallbackPace - (s.nonCallbackCallsToday || 0));
          s.predictedCallVolumeToday = Math.max(0, Math.round((s.callsToday || 0) + (s.callbacksToday || 0) + s.remainingNonCallbackToday));
          s.ownerName = s.ownerName || repById(s.ownerId)?.name || null;
        }
        return res.status(200).json({ success: true, action, reps: Array.from(map.values()) });
      }

      // ── Candidate pool stats (banked / released / by sector / by wave) ────
      if (action === 'reconcile-candidates') {
        await ensureCandidatesTable(sql);
        const dryRun = body.dryRun !== false;
        const staleRows = await sql`
          SELECT qc.id, qc.apollo_id, qc.email, qc.name, qc.company_name
          FROM queue_candidates qc
          WHERE qc.released = FALSE AND qc.enqueued = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM queue_leads ql
              WHERE (qc.apollo_id IS NOT NULL AND ql.apollo_id = qc.apollo_id)
                 OR (qc.email IS NOT NULL AND lower(ql.email) = lower(qc.email))
            )
          ORDER BY qc.id
        `;
        if (!dryRun && staleRows.length) {
          const ids = staleRows.map((row) => Number(row.id));
          await sql`
            UPDATE queue_candidates
            SET enqueued = FALSE, updated_at = now()
            WHERE id = ANY(${ids}) AND released = FALSE
          `;
          await writeAudit(sql, {
            actorEmail: identity.email,
            actorRole: identity.role,
            event: 'candidate_enqueue_flags_reconciled',
            target: 'candidate-bank',
            meta: { count: ids.length },
          });
        }
        return res.status(200).json({
          success: true,
          action,
          dryRun,
          found: staleRows.length,
          reconciled: dryRun ? 0 : staleRows.length,
          sample: staleRows.slice(0, 20),
        });
      }

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
        const byWaveTier = await sql`
          SELECT wave, COALESCE(tier, 2) AS tier, COUNT(*)::int AS total
          FROM queue_candidates
          WHERE wave IS NOT NULL AND released = TRUE
          GROUP BY wave, COALESCE(tier, 2)
          ORDER BY wave, tier
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
        const lifecycleRows = await sql`
          SELECT
            COUNT(*) FILTER (WHERE released = FALSE AND enqueued = FALSE)::int AS banked,
            COUNT(*) FILTER (WHERE released = TRUE AND enqueued = FALSE)::int AS released_pending,
            COUNT(*) FILTER (WHERE released = TRUE AND enqueued = TRUE)::int AS released_enqueued,
            COUNT(*) FILTER (WHERE released = FALSE AND enqueued = TRUE)::int AS direct_enqueued,
            COUNT(*) FILTER (WHERE released = TRUE AND wave IS NULL)::int AS released_without_wave,
            COUNT(*) FILTER (WHERE released = FALSE AND wave IS NOT NULL)::int AS wave_without_release
          FROM queue_candidates
        `;
        const linkageRows = await sql`
          SELECT
            COUNT(*) FILTER (WHERE qc.released = FALSE AND qc.enqueued = TRUE AND ql.id IS NULL)::int AS enqueued_without_lead,
            COUNT(*) FILTER (WHERE qc.released = TRUE AND qc.enqueued = TRUE AND ql.id IS NULL)::int AS released_history_without_lead,
            COUNT(*) FILTER (WHERE qc.enqueued = TRUE AND ql.archived_at IS NOT NULL)::int AS archived_enqueued,
            COUNT(*) FILTER (WHERE qc.enqueued = FALSE AND ql.id IS NOT NULL AND ql.archived_at IS NULL)::int AS lead_without_enqueued
          FROM queue_candidates qc
          LEFT JOIN LATERAL (
            SELECT q.id, q.archived_at FROM queue_leads q
            WHERE (
                (qc.apollo_id IS NOT NULL AND q.apollo_id = qc.apollo_id)
                OR (qc.email IS NOT NULL AND lower(q.email) = lower(qc.email))
              )
            ORDER BY q.archived_at NULLS FIRST
            LIMIT 1
          ) ql ON TRUE
        `;
        const lifecycle = lifecycleRows[0] || {};
        const lifecycleTotal = (lifecycle.banked || 0) + (lifecycle.released_pending || 0)
          + (lifecycle.released_enqueued || 0) + (lifecycle.direct_enqueued || 0);
        const failures = [];
        if (lifecycleTotal !== (totalRows[0]?.c || 0)) failures.push('Lifecycle states do not sum to candidate total');
        if (lifecycle.released_without_wave) failures.push(`${lifecycle.released_without_wave} released candidates have no wave`);
        if (lifecycle.wave_without_release) failures.push(`${lifecycle.wave_without_release} candidates have a wave but are not released`);
        if (linkageRows[0]?.enqueued_without_lead) failures.push(`${linkageRows[0].enqueued_without_lead} enqueued candidates have no active queue lead`);
        if (linkageRows[0]?.lead_without_enqueued) failures.push(`${linkageRows[0].lead_without_enqueued} candidates have an active queue lead but are not marked enqueued`);
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
          byWaveTier,
          reconciliation: {
            states: {
              banked: lifecycle.banked || 0,
              releasedPending: lifecycle.released_pending || 0,
              releasedEnqueued: lifecycle.released_enqueued || 0,
              directEnqueued: lifecycle.direct_enqueued || 0,
            },
            stateTotal: lifecycleTotal,
            orphanedEnqueued: linkageRows[0]?.enqueued_without_lead || 0,
            releasedHistoryWithoutLead: linkageRows[0]?.released_history_without_lead || 0,
            archivedEnqueued: linkageRows[0]?.archived_enqueued || 0,
            unmarkedQueueLeads: linkageRows[0]?.lead_without_enqueued || 0,
            failures,
            valid: failures.length === 0,
          },
        });
      }

      // ── Candidate list for wave / backup pages ───────────────────────────
      if (action === 'candidate-list') {
        const wave = body.wave ?? req.query?.wave ?? null;
        const backup = body.backup ?? req.query?.backup ?? false;
        const sector = body.sector ?? req.query?.sector ?? null;
        const subSector = body.subSector ?? req.query?.subSector ?? null;
        const includeEnqueued = body.includeEnqueued ?? req.query?.includeEnqueued ?? false;
        const exactWave = body.exactWave ?? req.query?.exactWave ?? false;
        const waveSize = body.waveSize ?? req.query?.waveSize ?? 1111;
        const roleFit = body.roleFit ?? req.query?.roleFit ?? 'fit';
        const candidates = await listCandidates(sql, { wave, exactWave, backup, sector, subSector, includeEnqueued, waveSize, roleFit });
        return res.status(200).json({ success: true, action, wave, exactWave, backup, sector, subSector, includeEnqueued, waveSize, roleFit, candidates });
      }

      // ── Mark the next N unreleased candidates as a wave, return the list ──
      // Enrichment (credit spend) happens OUTSIDE this endpoint, in a controlled
      // script, then those rows are enqueued to the board.
      if (action === 'release-wave') {
        await ensureCandidatesTable(sql);
        const wave = Number.parseInt(body.wave, 10);
        const limit = Math.min(Math.max(Number.parseInt(body.limit, 10) || 1111, 1), 5000);
        const sector = body.sector ?? null;
        const subSector = body.subSector ?? null;
        const tier1Take = Math.floor(limit / 2);
        const tier2Take = limit - tier1Take;
        if (!Number.isFinite(wave) || wave < 1) {
          return res.status(400).json({ success: false, error: 'Valid wave number required' });
        }
        const existingWave = await sql`SELECT COUNT(*)::int AS c FROM queue_candidates WHERE wave = ${wave}`;
        if ((existingWave[0]?.c || 0) > 0) {
          return res.status(409).json({ success: false, error: `Wave ${wave} already exists` });
        }

        const rows = await sql`
          WITH eligible AS MATERIALIZED (
            SELECT * FROM queue_candidates
            WHERE released = FALSE
              AND role_fit IS NOT FALSE
              AND (${sector}::text IS NULL OR sector = ${sector})
              AND (${subSector}::text IS NULL OR sub_sector = ${subSector})
              AND NOT EXISTS (
                SELECT 1 FROM queue_candidates prior
                WHERE prior.released = FALSE
                  AND prior.id < queue_candidates.id
                  AND COALESCE(NULLIF(LOWER(TRIM(prior.company_domain)), ''), LOWER(regexp_replace(TRIM(COALESCE(prior.company_name, '')), '\\s+', ' ', 'g'))) =
                      COALESCE(NULLIF(LOWER(TRIM(queue_candidates.company_domain)), ''), LOWER(regexp_replace(TRIM(COALESCE(queue_candidates.company_name, '')), '\\s+', ' ', 'g')))
              )
            ORDER BY id
            FOR UPDATE SKIP LOCKED
          ), filtered AS (
            SELECT id, COALESCE(tier, 2) AS t, COALESCE(sector, 'Unknown') AS sec, priority, created_at
            FROM eligible
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
          RETURNING c.id, c.apollo_id, c.first_name, c.last_name, c.name, c.title, c.email, c.phone,
                    c.company_name, c.company_domain, c.company_website, c.company_industry,
                    c.company_employees, c.company_revenue, c.linkedin_url,
                    c.sector, c.sub_sector, c.priority, c.tier
        `;
        if (rows.length) {
          const assignments = rows.map((row, index) => {
            const owner = pickOwnerByIndex(index);
            return { id: row.id, owner_id: owner.id, owner_name: owner.name };
          });
          await sql`
            UPDATE queue_candidates AS c
            SET owner_id = a.owner_id,
                owner_name = a.owner_name,
                updated_at = now()
            FROM json_to_recordset(${JSON.stringify(assignments)}::json) AS a(id bigint, owner_id text, owner_name text)
            WHERE c.id = a.id
          `;

          const releaseLeads = rows
            .filter((row) => row.email)
            .map((row, index) => {
              const owner = pickOwnerByIndex(index);
              return {
                apollo_id: row.apollo_id,
                first_name: row.first_name,
                last_name: row.last_name,
                name: row.name,
                title: row.title,
                email: row.email,
                phone: row.phone,
                company_name: row.company_name,
                company_website: row.company_website,
                company_industry: row.company_industry,
                sector: row.sector,
                sub_sector: row.sub_sector,
                company_employees: row.company_employees,
                company_revenue: row.company_revenue,
                linkedin_url: row.linkedin_url,
                priority: row.priority || 'warm',
                raw: { source: 'release-wave', wave, candidateId: row.id },
                owner,
              };
            });

          for (const lead of releaseLeads) {
            await upsertLead(sql, lead, lead.owner);
          }
          const enqueuedCandidateIds = releaseLeads.map((lead) => lead.raw.candidateId);
          if (enqueuedCandidateIds.length) {
            await sql`
              UPDATE queue_candidates
              SET enqueued = TRUE, updated_at = now()
              WHERE id = ANY(${enqueuedCandidateIds})
            `;
          }
          await writeAudit(sql, {
            actorEmail: identity.email,
            actorRole: identity.role,
            event: 'wave_released',
            target: String(wave),
            meta: { released: rows.length, enqueued: releaseLeads.length },
          });
        }
        return res.status(200).json({ success: true, action, wave, released: rows.length, enqueued: rows.filter((row) => row.email).length, candidates: rows });
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

        await sql`
          UPDATE queue_leads
          SET archived_at = now(),
              archived_reason = 'manual-delete',
              updated_at = now()
          WHERE id = ${id}
        `;
        await writeAudit(sql, {
          actorEmail: identity.email,
          actorRole: identity.role,
          event: 'lead_archived',
          target: String(id),
          meta: { reason: 'manual-delete' },
        });

        return res.status(200).json({ success: true, action, id, deleted: true, archived: true, name: lead.name, companyName: lead.company_name });
      }

      // ── Purge outbound leads with no callable number (admin maintenance) ─
      if (action === 'purge-no-phone') {
        const dryRun = body.dryRun === true;
        const rows = await sql`
          SELECT id, name, email, company_name
          FROM queue_leads
          WHERE source IS DISTINCT FROM 'inbound'
            AND archived_at IS NULL
            AND COALESCE(NULLIF(TRIM(phone), ''), NULLIF(TRIM(direct_phone), '')) IS NULL
          ORDER BY created_at ASC, id ASC
        `;

        if (!dryRun && rows.length) {
          const ids = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
          if (ids.length) {
            await sql`
              UPDATE queue_leads
              SET archived_at = now(),
                  archived_reason = 'purge-no-phone',
                  updated_at = now()
              WHERE id = ANY(${ids})
            `;
          }
          await writeAudit(sql, {
            actorEmail: identity.email,
            actorRole: identity.role,
            event: 'leads_purged_no_phone',
            target: 'outbound',
            meta: { count: rows.length },
          });
        }

        return res.status(200).json({
          success: true,
          action,
          dryRun,
          purged: dryRun ? 0 : rows.length,
          found: rows.length,
          sample: rows.slice(0, 20),
        });
      }

      // ── Merge split company ownership without touching callback leads ────
      if (action === 'merge-company-owners') {
        await ensureLeadColumns(sql);
        const dryRun = body.dryRun === true;
        const outbound = await sql`
          SELECT id, owner_id, owner, callback_at, phone, direct_phone, company_name, company_website, updated_at
          FROM queue_leads
          WHERE source IS DISTINCT FROM 'inbound'
            AND owner_id IS NOT NULL
            AND archived_at IS NULL
          ORDER BY created_at ASC, id ASC
        `;

        const groups = new Map();
        for (const row of outbound) {
          const key = companyGroupKeyFromRow(row);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(row);
        }

        const updates = [];
        let companiesScanned = 0;
        let companiesSplit = 0;
        let companiesMerged = 0;

        for (const rows of groups.values()) {
          companiesScanned += 1;
          const ownerIds = Array.from(new Set(rows.map((r) => String(r.owner_id || '')).filter(Boolean)));
          if (ownerIds.length <= 1) continue;
          companiesSplit += 1;

          const byOwner = new Map();
          for (const r of rows) {
            const key = String(r.owner_id || '');
            if (!key) continue;
            if (!byOwner.has(key)) {
              byOwner.set(key, {
                ownerId: key,
                ownerName: r.owner || repById(key)?.name || null,
                total: 0,
                callbacks: 0,
                latestTouch: 0,
              });
            }
            const o = byOwner.get(key);
            o.total += 1;
            if (r.callback_at) o.callbacks += 1;
            const t = r.updated_at ? new Date(r.updated_at).getTime() : 0;
            if (Number.isFinite(t) && t > o.latestTouch) o.latestTouch = t;
          }

          const owners = Array.from(byOwner.values()).sort((a, b) =>
            (b.callbacks - a.callbacks) ||
            (b.total - a.total) ||
            (b.latestTouch - a.latestTouch) ||
            a.ownerId.localeCompare(b.ownerId)
          );
          const target = owners[0];
          if (!target?.ownerId) continue;

          // Callback leads remain untouched; only non-callback rows are moved.
          const candidates = rows.filter((r) => !r.callback_at && String(r.owner_id || '') !== target.ownerId);
          if (!candidates.length) continue;
          companiesMerged += 1;

          for (const c of candidates) {
            updates.push({
              id: c.id,
              owner_id: target.ownerId,
              owner: target.ownerName || repById(target.ownerId)?.name || null,
            });
          }
        }

        if (!dryRun && updates.length) {
          await sql`
            UPDATE queue_leads AS q
            SET owner_id = u.owner_id,
                owner = COALESCE(u.owner, q.owner),
                updated_at = now()
            FROM json_to_recordset(${JSON.stringify(updates)}::json) AS u(id bigint, owner_id text, owner text)
            WHERE q.id = u.id
          `;

          for (const u of updates) {
            await logQueueEvent(sql, {
              leadId: u.id,
              eventType: 'reassign',
              ownerId: u.owner_id,
              ownerName: u.owner,
              meta: { via: 'merge-company-owners', callbackSafe: true },
            });
          }
          await writeAudit(sql, {
            actorEmail: identity.email,
            actorRole: identity.role,
            event: 'company_owners_merged',
            target: 'outbound',
            meta: { companiesMerged, leadsUpdated: updates.length },
          });
        }

        return res.status(200).json({
          success: true,
          action,
          dryRun,
          companiesScanned,
          companiesSplit,
          companiesMerged,
          leadsUpdated: updates.length,
        });
      }

      // ── Status / notes updates (GHL write ONLY on convert) ─────────────────
      if (action === 'status') {
        const { id, status } = body;
        if (!id || !STATUSES.includes(status)) {
          return res.status(400).json({ success: false, error: 'Valid id and status required' });
        }

        let lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
        if (!canAccessLead(identity, lead)) {
          return res.status(403).json({ success: false, error: 'You can only update your own leads' });
        }

        let ghl = null;
        let owner = null;
        const nextPriority = statusPriority(status);
        const answers = status === 'qualified' ? normalizeQualifyAnswers(body.answers) : null;
        const qualificationNotes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
        if (QUALIFICATION_STATUSES.has(status)) {
          const claim = await claimQualification(sql, id);
          if (claim.completed) {
            return res.status(200).json({ success: true, action, id, status: 'qualified', alreadyQualified: true });
          }
          if (claim.conflict) {
            return res.status(409).json({ success: false, error: 'Qualification is already in progress' });
          }
          lead = claim.lead;
          owner = lead.owner_id ? { id: lead.owner_id, name: lead.owner } : await pickRoundRobinOwner(sql);
        }

        await sql`
          UPDATE queue_leads SET
            status = ${status},
            priority = ${nextPriority},
            owner = COALESCE(${owner?.name || body.owner || null}, owner),
            owner_id = COALESCE(${owner?.id || null}, owner_id),
            call_notes = COALESCE(${body.notes ?? null}, call_notes),
            qualify_answers = COALESCE(${answers ? JSON.stringify(answers) : null}::jsonb, qualify_answers),
            opportunity_stage = CASE WHEN ${status} = 'qualified' THEN COALESCE(opportunity_stage, 'qualified') ELSE opportunity_stage END,
            opportunity_origin = CASE WHEN ${status} = 'qualified' THEN COALESCE(opportunity_origin, 'call_list') ELSE opportunity_origin END,
            qualified_at = CASE WHEN ${status} = 'qualified' THEN COALESCE(qualified_at, now()) ELSE qualified_at END,
            qualification_state = CASE WHEN ${status} = 'qualified' THEN 'completed' ELSE qualification_state END,
            qualification_error = CASE WHEN ${status} = 'qualified' THEN NULL ELSE qualification_error END,
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
          actorEmail: identity.email,
          actorRole: identity.role,
          meta: { via: 'status-action', priority: nextPriority, qualified: status === 'qualified' ? true : undefined },
        });

        if (status === 'wants_more_info' && lead.email && !lead.archived_at) {
          await sql`
            INSERT INTO email_campaign_enrollments (campaign_id, lead_id, status, current_step, next_step_due)
            SELECT c.id, ${id}, 'active', 0, now()
            FROM email_campaigns c
            WHERE c.status = 'active' AND c.campaign_type = 'growth'
            ORDER BY c.activated_at DESC NULLS LAST, c.id DESC
            LIMIT 1
            ON CONFLICT (campaign_id, lead_id) DO NOTHING
          `;
        }

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
          actorEmail: identity.email,
          actorRole: identity.role,
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
          actorEmail: identity.email,
          actorRole: identity.role,
          meta: { from: lead.priority, to: priority },
        });

        return res.status(200).json({ success: true, action, id, priority });
      }

      if (action === 'manual-opportunity-create') {
        const nameRaw = String(body.name || '').trim().replace(/\s+/g, ' ');
        const titleRaw = String(body.title || '').trim().replace(/\s+/g, ' ');
        const companyNameRaw = String(body.companyName || '').trim().replace(/\s+/g, ' ');
        const emailRaw = String(body.email || '').trim().toLowerCase();
        const phoneRaw = String(body.phone || '').trim();
        const notesRaw = String(body.notes || '').trim();
        const sectorRaw = String(body.sector || '').trim().replace(/\s+/g, ' ');
        const subSectorRaw = String(body.subSector || '').trim().replace(/\s+/g, ' ');
        const answers = normalizeQualifyAnswers(body.answers);
        const hasMeetingScheduledAt = body.meetingScheduledAt !== undefined;
        const meetingScheduledAt = hasMeetingScheduledAt ? (body.meetingScheduledAt || null) : null;
        const nextStepSummary = typeof body.nextStepSummary === 'string' && body.nextStepSummary.trim()
          ? body.nextStepSummary.trim().slice(0, 1000)
          : null;
        const requestedOrigin = String(body.opportunityOrigin || body.origin || '').trim().toLowerCase();
        const opportunityOrigin = requestedOrigin === 'manual_activity' ? 'manual_activity' : 'manual_opportunity';
        let ownerId = String(body.ownerId || '').trim();

        if (!nameRaw) return res.status(400).json({ success: false, error: 'Lead name is required' });
        if (!titleRaw) return res.status(400).json({ success: false, error: 'Job title is required' });
        if (!companyNameRaw) return res.status(400).json({ success: false, error: 'Company name is required' });
        if (!emailRaw && !phoneRaw) return res.status(400).json({ success: false, error: 'Email or phone is required' });

        if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
          return res.status(400).json({ success: false, error: 'Enter a valid email address' });
        }
        if (meetingScheduledAt) {
          const d = new Date(meetingScheduledAt);
          if (Number.isNaN(d.getTime())) {
            return res.status(400).json({ success: false, error: 'Meeting date must be a valid date/time' });
          }
        }

        if (isRep(identity)) ownerId = String(identity.ghlOwnerId || '').trim();
        if (!ownerId) return res.status(400).json({ success: false, error: 'Opportunity owner is required' });
        const rep = repById(ownerId);
        if (!rep) return res.status(400).json({ success: false, error: 'Owner must be one of the round-robin reps' });

        if (emailRaw) {
          const dupe = await sql`
            SELECT id, name, company_name, status, opportunity_stage
            FROM queue_leads
            WHERE email = ${emailRaw} AND archived_at IS NULL
            LIMIT 1
          `;
          if (dupe[0]) {
            return res.status(409).json({
              success: false,
              error: 'A lead with this email already exists',
              existing: {
                id: dupe[0].id,
                name: dupe[0].name,
                companyName: dupe[0].company_name,
                status: dupe[0].status,
                opportunityStage: dupe[0].opportunity_stage,
              },
            });
          }
        }

        const split = splitLeadName(nameRaw);
        const opportunityStage = meetingScheduledAt ? 'meeting_booked' : 'qualified';
        const inserted = await sql`
          INSERT INTO queue_leads (
            first_name, last_name, name, title, email, phone, direct_phone,
            company_name, sector, sub_sector,
            priority, status, source,
            call_notes, owner, owner_id,
            qualify_answers, next_step_summary,
            opportunity_origin,
            opportunity_stage, meeting_booked_at, meeting_scheduled_at,
            qualified_at, last_touch_at, updated_at
          ) VALUES (
            ${split.firstName || null}, ${split.lastName || null}, ${split.name}, ${titleRaw.slice(0, 200)},
            ${emailRaw || null}, ${phoneRaw || null}, ${phoneRaw || null},
            ${companyNameRaw.slice(0, 250)}, ${sectorRaw ? sectorRaw.slice(0, 120) : null}, ${subSectorRaw ? subSectorRaw.slice(0, 120) : null},
            'hot', 'qualified', 'outbound',
            ${notesRaw ? notesRaw.slice(0, 5000) : null}, ${rep.name}, ${rep.id},
            ${answers ? JSON.stringify(answers) : null}::jsonb, ${nextStepSummary},
            ${opportunityOrigin},
            ${opportunityStage},
            CASE WHEN ${meetingScheduledAt}::timestamptz IS NOT NULL THEN now() ELSE NULL END,
            ${meetingScheduledAt}::timestamptz,
            now(), now(), now()
          )
          RETURNING *
        `;
        const leadRow = inserted[0];

        await logQueueEvent(sql, {
          leadId: leadRow.id,
          eventType: 'status_change',
          fromStatus: null,
          toStatus: 'qualified',
          ownerId: rep.id,
          ownerName: rep.name,
          actorEmail: identity.email,
          actorRole: identity.role,
          meta: {
            via: 'manual-opportunity-create',
            opportunityStage,
            opportunityOrigin,
            meetingScheduledAt: meetingScheduledAt || undefined,
            hasQualifyAnswers: !!answers,
          },
        });

        if (meetingScheduledAt) {
          await createOpportunityMeeting(sql, {
            lead: leadRow,
            scheduledFor: new Date(meetingScheduledAt).toISOString(),
            meetingType: 'discovery',
            bookingChannel: 'manual',
            notes: notesRaw ? notesRaw.slice(0, 5000) : null,
            nextStepSummary,
            primaryOwnerId: rep.id,
            primaryOwnerName: rep.name,
            accompanyingOwnerIds: [],
            actorEmail: identity.email,
            actorRole: identity.role,
          });
        }

        await writeAudit(sql, {
          actorEmail: identity.email,
          actorRole: identity.role,
          event: 'manual_opportunity_created',
          target: 'queue_leads',
          meta: { leadId: leadRow.id, ownerId: rep.id, ownerName: rep.name },
        });

        return res.status(200).json({
          success: true,
          action,
          lead: rowToClient(leadRow),
        });
      }

      if (action === 'set-opportunity-stage') {
        const { id, stage } = body;
        if (!id || !OPPORTUNITY_STAGES.includes(stage)) {
          return res.status(400).json({ success: false, error: 'Lead id and valid opportunity stage required' });
        }
        const nextStepSummary = typeof body.nextStepSummary === 'string' && body.nextStepSummary.trim() ? body.nextStepSummary.trim().slice(0, 1000) : null;
        const lossReason = typeof body.lossReason === 'string' && body.lossReason.trim() ? body.lossReason.trim().slice(0, 500) : null;
        const dealType = typeof body.dealType === 'string' && ['Recurring', 'One-off', 'Hybrid'].includes(body.dealType) ? body.dealType : null;
        const hasCallbackAt = body.callbackAt !== undefined;
        const callbackAt = hasCallbackAt ? (body.callbackAt || null) : null;
        const hasProposalSentAt = body.proposalSentAt !== undefined;
        const proposalSentAt = hasProposalSentAt ? (body.proposalSentAt || null) : null;
        const hasDecisionDeadlineAt = body.decisionDeadlineAt !== undefined;
        const decisionDeadlineAt = hasDecisionDeadlineAt ? (body.decisionDeadlineAt || null) : null;
        const hasMeetingAt = body.meetingAt !== undefined;
        const meetingAt = hasMeetingAt ? (body.meetingAt || null) : null;
        const hasMeetingScheduledAt = body.meetingScheduledAt !== undefined;
        const meetingScheduledAt = hasMeetingScheduledAt ? (body.meetingScheduledAt || null) : null;
        const hasMrr = body.mrrValue !== undefined;
        const hasOneOff = body.oneOffValue !== undefined;
        const mrrValue = hasMrr && body.mrrValue !== null && body.mrrValue !== '' ? Number(body.mrrValue) : null;
        const oneOffValue = hasOneOff && body.oneOffValue !== null && body.oneOffValue !== '' ? Number(body.oneOffValue) : null;
        if ((hasMrr && (mrrValue === null || !Number.isFinite(mrrValue) || mrrValue < 0)) || (hasOneOff && (oneOffValue === null || !Number.isFinite(oneOffValue) || oneOffValue < 0))) {
          return res.status(400).json({ success: false, error: 'Deal values must be zero or positive numbers' });
        }
        if (stage === 'scoping' && !dealType) {
          return res.status(400).json({ success: false, error: 'Deal type is required when moving an opportunity to Scoping' });
        }
        if (stage === 'proposal' && !proposalSentAt) {
          return res.status(400).json({ success: false, error: 'Proposal sent date is required when moving an opportunity to Proposal' });
        }
        if (stage === 'lost' && !lossReason) {
          return res.status(400).json({ success: false, error: 'Loss reason is required when moving an opportunity to Lost' });
        }
        if (stage === 'meeting_booked' && !meetingScheduledAt) {
          return res.status(400).json({ success: false, error: 'Meeting date is required when booking a meeting' });
        }
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
        if (!canAccessLead(identity, lead)) {
          return res.status(403).json({ success: false, error: 'You can only update your own qualified leads' });
        }
        if (lead.status !== 'qualified') {
          return res.status(400).json({ success: false, error: 'Only qualified leads can be moved on the opportunities board' });
        }

        const existingDealType = typeof lead.deal_type === 'string' ? lead.deal_type : null;
        const existingMrrValue = lead.mrr_value == null ? null : Number(lead.mrr_value);
        const existingOneOffValue = lead.one_off_value == null ? null : Number(lead.one_off_value);
        const effectiveDealType = dealType || existingDealType;
        const effectiveMrr = hasMrr ? mrrValue : existingMrrValue;
        const effectiveOneOff = hasOneOff ? oneOffValue : existingOneOffValue;
        const hasEffectiveCommercialValue = Number(effectiveMrr || 0) > 0 || Number(effectiveOneOff || 0) > 0;

        if ((stage === 'scoping' || stage === 'proposal') && !effectiveDealType) {
          return res.status(400).json({ success: false, error: `Deal type is required when moving an opportunity to ${stage === 'scoping' ? 'Scoping' : 'Proposal'}` });
        }
        if ((stage === 'scoping' || stage === 'proposal') && !hasEffectiveCommercialValue) {
          return res.status(400).json({ success: false, error: `MRR or one-off value is required when moving an opportunity to ${stage === 'scoping' ? 'Scoping' : 'Proposal'}` });
        }

        const fromStage = lead.opportunity_stage || 'qualified';
        const stageRank = (stageKey) => {
          const idx = OPPORTUNITY_STAGES.indexOf(stageKey);
          return idx < 0 ? 0 : idx;
        };
        const isBackwardMove = stageRank(stage) < stageRank(fromStage);
        if (isBackwardMove && !hasMinRole(identity, 'admin')) {
          return res.status(403).json({ success: false, error: 'Only admins can move opportunities backwards' });
        }
        const clearsStage = (stageKey) => isBackwardMove && stageRank(stage) < stageRank(stageKey);
        const clearMeetingBooked = clearsStage('meeting_booked');
        const clearMeetingNoShow = clearsStage('meeting_no_show');
        const clearMeetingAttended = clearsStage('meeting_attended');
        const clearScoping = clearsStage('scoping');
        const clearProposal = clearsStage('proposal');
        const clearWon = clearsStage('won');
        const clearLost = clearsStage('lost');

        let ghl = null;
        if (stage === 'won') {
          const owner = lead.owner_id ? { id: lead.owner_id, name: lead.owner } : await pickRoundRobinOwner(sql);
          const contactFieldMap = await getContactFieldMap();
          const opportunityFieldMap = await getOpportunityFieldMap();
          const answers = parseLeadQualifyAnswers(lead) || {};
          const qualificationNotes = typeof lead.call_notes === 'string' && lead.call_notes.trim() ? lead.call_notes.trim() : null;
          const qualifyFields = buildQualifyCustomFields(answers, contactFieldMap);
          const reportingFields = buildReportingCustomFields({
            lead,
            owner,
            status: 'qualified',
            qualifiedAt: new Date(),
            callbackAt: lead.callback_at,
            qualificationNotes,
          }, contactFieldMap);
          const opportunityFields = buildOpportunityReportingCustomFields({ lead, answers, qualificationNotes }, opportunityFieldMap);
          const contactCustomFields = mergeCustomFields(qualifyFields, reportingFields);
          ghl = await pushToGhl(sql, lead, {
            owner,
            contactCustomFields,
            opportunityCustomFields: opportunityFields,
            stageId: CONVERTED_STAGE_ID || QUALIFIED_STAGE_ID,
            stageLabel: 'Won',
          });
        }
        await sql`
          UPDATE queue_leads
          SET opportunity_stage = ${stage},
              mrr_value = CASE WHEN ${hasMrr}::boolean THEN ${mrrValue} ELSE mrr_value END,
              one_off_value = CASE WHEN ${hasOneOff}::boolean THEN ${oneOffValue} ELSE one_off_value END,
              deal_type = COALESCE(${dealType}, deal_type),
              next_step_summary = COALESCE(${nextStepSummary}, next_step_summary),
              loss_reason = CASE WHEN ${clearLost}::boolean THEN NULL WHEN ${stage} = 'lost' THEN ${lossReason} ELSE loss_reason END,
              callback_at = CASE WHEN ${hasCallbackAt}::boolean THEN ${callbackAt}::timestamptz ELSE callback_at END,
              proposal_sent_at = CASE WHEN ${clearProposal}::boolean THEN NULL WHEN ${hasProposalSentAt}::boolean THEN ${proposalSentAt}::timestamptz ELSE proposal_sent_at END,
              decision_deadline_at = CASE WHEN ${clearProposal}::boolean THEN NULL WHEN ${hasDecisionDeadlineAt}::boolean THEN ${decisionDeadlineAt}::timestamptz ELSE decision_deadline_at END,
              meeting_booked_at = CASE WHEN ${clearMeetingBooked}::boolean THEN NULL WHEN ${stage} = 'meeting_booked' THEN COALESCE(meeting_booked_at, now()) ELSE meeting_booked_at END,
              meeting_scheduled_at = CASE WHEN ${clearMeetingBooked}::boolean THEN NULL WHEN ${hasMeetingScheduledAt}::boolean THEN ${meetingScheduledAt}::timestamptz ELSE meeting_scheduled_at END,
              meeting_no_show_at = CASE WHEN ${clearMeetingNoShow}::boolean THEN NULL WHEN ${stage} = 'meeting_no_show' THEN COALESCE(meeting_no_show_at, now()) ELSE meeting_no_show_at END,
              meeting_attended_at = CASE WHEN ${clearMeetingAttended}::boolean THEN NULL WHEN ${stage} = 'meeting_attended' THEN COALESCE(meeting_attended_at, ${meetingAt}::timestamptz, now()) ELSE meeting_attended_at END,
              scoping_at = CASE WHEN ${clearScoping}::boolean THEN NULL WHEN ${stage} = 'scoping' THEN COALESCE(scoping_at, now()) ELSE scoping_at END,
              proposal_at = CASE WHEN ${clearProposal}::boolean THEN NULL WHEN ${stage} = 'proposal' THEN COALESCE(proposal_at, now()) ELSE proposal_at END,
              won_at = CASE WHEN ${clearWon}::boolean THEN NULL WHEN ${stage} = 'won' THEN COALESCE(won_at, now()) ELSE won_at END,
              lost_at = CASE WHEN ${clearLost}::boolean THEN NULL WHEN ${stage} = 'lost' THEN COALESCE(lost_at, now()) ELSE lost_at END,
              apollo_synced = COALESCE(${ghl?.apollo?.ok ?? null}, apollo_synced),
              ghl_contact_id = COALESCE(${ghl?.contactId || null}, ghl_contact_id),
              ghl_opportunity_id = COALESCE(${ghl?.opportunityId || null}, ghl_opportunity_id),
              updated_at = now(), last_touch_at = now()
          WHERE id = ${id}
        `;

        await logQueueEvent(sql, {
          leadId: id,
          eventType: 'opportunity_stage',
          ownerId: lead.owner_id,
          ownerName: lead.owner,
          actorEmail: identity.email,
          actorRole: identity.role,
          meta: { fromStage, toStage: stage, backwardMove: isBackwardMove || undefined, mrrValue: hasMrr ? mrrValue : undefined, oneOffValue: hasOneOff ? oneOffValue : undefined, dealType, nextStepSummary, lossReason, callbackAt, proposalSentAt, decisionDeadlineAt, meetingAt: hasMeetingAt ? meetingAt : undefined, meetingScheduledAt: hasMeetingScheduledAt ? meetingScheduledAt : undefined },
        });

        if (stage === 'meeting_booked') {
          if (meetingScheduledAt) {
            await createOpportunityMeeting(sql, {
              lead,
              scheduledFor: new Date(meetingScheduledAt).toISOString(),
              meetingType: String(fromStage || 'qualified') === 'qualified' ? 'discovery' : 'follow_up',
              bookingChannel: 'manual',
              notes: null,
              nextStepSummary,
              primaryOwnerId: lead.owner_id,
              primaryOwnerName: lead.owner,
              accompanyingOwnerIds: [],
              actorEmail: identity.email,
              actorRole: identity.role,
            });
          }
        }

        return res.status(200).json({ success: true, action, id, stage, ghl });
      }

      // ── Mark a booked meeting as attended or a no-show (attendance tracking) ─
      if (action === 'log-meeting-outcome') {
        const { id } = body;
        const outcome = String(body.outcome || '').toLowerCase();
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });
        if (!['attended', 'no_show'].includes(outcome)) {
          return res.status(400).json({ success: false, error: 'Outcome must be attended or no_show' });
        }
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
        if (!canAccessLead(identity, lead)) {
          return res.status(403).json({ success: false, error: 'You can only update your own qualified leads' });
        }
        if (lead.status !== 'qualified') {
          return res.status(400).json({ success: false, error: 'Only qualified leads can log meeting outcomes' });
        }
        const attendedAt = body.meetingAt || null;
        const outcomeNotes = typeof body.outcomeNotes === 'string' && body.outcomeNotes.trim()
          ? body.outcomeNotes.trim().slice(0, 5000)
          : null;
        const meetingId = body.meetingId ? Number(body.meetingId) : null;

        if (outcome === 'attended') {
          await sql`
            UPDATE queue_leads
            SET opportunity_stage = 'meeting_attended',
                meeting_attended_at = COALESCE(meeting_attended_at, ${attendedAt}::timestamptz, now()),
                updated_at = now(), last_touch_at = now()
            WHERE id = ${id}
          `;
        } else {
          // No-show: count it, timestamp it, and move it into the no-show bucket.
          await sql`
            UPDATE queue_leads
            SET opportunity_stage = 'meeting_no_show',
                meeting_no_show_at = now(),
                meeting_no_show_count = COALESCE(meeting_no_show_count, 0) + 1,
                updated_at = now(), last_touch_at = now()
            WHERE id = ${id}
          `;
        }

        await logQueueEvent(sql, {
          leadId: id,
          eventType: 'meeting_outcome',
          ownerId: lead.owner_id,
          ownerName: lead.owner,
          actorEmail: identity.email,
          actorRole: identity.role,
          meta: { outcome, attendedAt: outcome === 'attended' ? attendedAt : undefined },
        });

        await markOpportunityMeetingOutcome(sql, {
          lead,
          meetingId: Number.isFinite(meetingId) ? meetingId : null,
          outcome,
          occurredAt: outcome === 'attended' ? (attendedAt || new Date().toISOString()) : new Date().toISOString(),
          outcomeNotes,
          actorEmail: identity.email,
          actorRole: identity.role,
        });

        return res.status(200).json({ success: true, action, id, outcome });
      }

      if (action === 'set-opportunity-followup') {
        const { id } = body;
        if (!id) {
          return res.status(400).json({ success: false, error: 'Lead id required' });
        }
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
        if (!canAccessLead(identity, lead)) {
          return res.status(403).json({ success: false, error: 'You can only update your own qualified leads' });
        }
        if (lead.status !== 'qualified') {
          return res.status(400).json({ success: false, error: 'Only qualified leads can be updated on the opportunities board' });
        }

        const nextStepSummary = typeof body.nextStepSummary === 'string' && body.nextStepSummary.trim() ? body.nextStepSummary.trim().slice(0, 1000) : null;
        const callbackAt = body.callbackAt || null;
        await sql`
          UPDATE queue_leads
          SET next_step_summary = ${nextStepSummary},
              callback_at = ${callbackAt}::timestamptz,
              updated_at = now(), last_touch_at = now()
          WHERE id = ${id}
        `;

        await logQueueEvent(sql, {
          leadId: id,
          eventType: 'opportunity_followup',
          ownerId: lead.owner_id,
          ownerName: lead.owner,
          actorEmail: identity.email,
          actorRole: identity.role,
          meta: { nextStepSummary, callbackAt },
        });

        return res.status(200).json({ success: true, action, id, nextStepSummary, callbackAt });
      }

      // ── Qualify (local gate → Opportunities board) ────────────────────────
      // `convert` kept as an alias so any older callers still land in the local board.
      if (action === 'convert' || action === 'qualify') {
        const { id } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });

        const existingLead = await loadLead(sql, id);
        if (!existingLead) return res.status(404).json({ success: false, error: 'Lead not found' });
        if (!canAccessLead(identity, existingLead)) {
          return res.status(403).json({ success: false, error: 'You can only qualify your own leads' });
        }

        const claim = await claimQualification(sql, id);
        if (claim.completed) {
          return res.status(200).json({ success: true, action, id, status: 'qualified', alreadyQualified: true });
        }
        if (claim.conflict) {
          return res.status(409).json({ success: false, error: 'Qualification is already in progress' });
        }
        const lead = claim.lead;
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

        const owner = lead.owner_id ? { id: lead.owner_id, name: lead.owner } : await pickRoundRobinOwner(sql);
        const answers = normalizeQualifyAnswers(body.answers);
        const meetingScheduledAt = typeof body.meetingScheduledAt === 'string' && body.meetingScheduledAt.trim()
          ? body.meetingScheduledAt.trim()
          : null;
        const meetingNextStepSummary = typeof body.nextStepSummary === 'string' && body.nextStepSummary.trim()
          ? body.nextStepSummary.trim().slice(0, 1000)
          : null;

        await sql`
          UPDATE queue_leads SET
            status = 'qualified',
            priority = 'hot',
            owner = COALESCE(${owner?.name || null}, owner),
            owner_id = COALESCE(${owner?.id || null}, owner_id),
            call_notes = COALESCE(${body.notes ?? null}, call_notes),
            qualify_answers = COALESCE(${answers ? JSON.stringify(answers) : null}::jsonb, qualify_answers),
            opportunity_origin = COALESCE(opportunity_origin, 'call_list'),
            opportunity_stage = CASE WHEN ${meetingScheduledAt}::timestamptz IS NOT NULL THEN 'meeting_booked' ELSE COALESCE(opportunity_stage, 'qualified') END,
            meeting_booked_at = CASE WHEN ${meetingScheduledAt}::timestamptz IS NOT NULL THEN COALESCE(meeting_booked_at, now()) ELSE meeting_booked_at END,
            meeting_scheduled_at = CASE WHEN ${meetingScheduledAt}::timestamptz IS NOT NULL THEN ${meetingScheduledAt}::timestamptz ELSE meeting_scheduled_at END,
            next_step_summary = COALESCE(${meetingNextStepSummary}, next_step_summary),
            qualified_at = COALESCE(qualified_at, now()),
            qualification_state = 'completed',
            qualification_error = NULL,
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
          actorEmail: identity.email,
          actorRole: identity.role,
          meta: { via: 'qualify-action', qualified: true, priority: 'hot', meetingScheduledAt, nextStepSummary: meetingNextStepSummary },
        });

        if (meetingScheduledAt) {
          const refreshedLead = await loadLead(sql, id);
          await createOpportunityMeeting(sql, {
            lead: refreshedLead || lead,
            scheduledFor: new Date(meetingScheduledAt).toISOString(),
            meetingType: 'discovery',
            bookingChannel: 'qualify',
            notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 5000) : null,
            nextStepSummary: meetingNextStepSummary,
            primaryOwnerId: owner?.id || lead.owner_id,
            primaryOwnerName: owner?.name || lead.owner,
            accompanyingOwnerIds: [],
            actorEmail: identity.email,
            actorRole: identity.role,
          });
        }

        return res.status(200).json({ success: true, action, id, status: 'qualified', priority: 'hot', localOnly: true, opportunityStage: meetingScheduledAt ? 'meeting_booked' : 'qualified' });
      }

      // ── Disposition + callback (DB only) ──────────────────────────────────
      if (action === 'disposition') {
        const { id, disposition, callbackAt } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
        if (!canAccessLead(identity, lead)) return res.status(403).json({ success: false, error: 'You can only update your own leads' });
        const clearCompanyTarget = isCoveredDisposition(disposition);
        await sql`
          UPDATE queue_leads SET
            disposition = ${disposition ?? null},
            callback_at = ${callbackAt ?? null},
            company_target = CASE WHEN ${clearCompanyTarget} THEN FALSE ELSE company_target END,
            last_touch_at = now(),
            updated_at = now()
          WHERE id = ${id}
        `;
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
          actorEmail: identity.email,
          actorRole: identity.role,
          meta: { disposition: disposition ?? null, callbackAt: callbackAt ?? null },
        });
        return res.status(200).json({ success: true, action, id });
      }

      // ── Company contact state helpers: one active target per business ─────
      if (action === 'company-contact-state') {
        const { id, mode } = body;
        if (!id || !mode) return res.status(400).json({ success: false, error: 'Lead id and mode required' });
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
        if (!canAccessLead(identity, lead)) return res.status(403).json({ success: false, error: 'You can only update your own leads' });

        if (mode === 'cover') {
          const days = Math.max(1, Math.min(30, Number.parseInt(body.days, 10) || 7));
          const until = new Date();
          until.setDate(until.getDate() + days);
          const untilIso = until.toISOString();
          await sql`
            UPDATE queue_leads
            SET
              disposition = 'Covered by colleague',
              callback_at = ${untilIso}::timestamptz,
              company_target = FALSE,
              last_touch_at = now(),
              updated_at = now()
            WHERE id = ${id}
          `;
          await logQueueEvent(sql, {
            leadId: id,
            eventType: 'disposition',
            ownerId: lead.owner_id,
            ownerName: lead.owner,
            actorEmail: identity.email,
            actorRole: identity.role,
            meta: { disposition: 'Covered by colleague', callbackAt: untilIso, mode: 'cover-company-contact' },
          });
          return res.status(200).json({ success: true, action, id, mode, coveredUntil: untilIso });
        }

        if (mode === 'promote') {
          const peers = await loadCompanyPeers(sql, lead);
          const allowedPeerIds = peers.filter((p) => canAccessLead(identity, p)).map((p) => Number(p.id)).filter((n) => Number.isFinite(n));
          if (!allowedPeerIds.includes(Number(id))) allowedPeerIds.push(Number(id));
          if (allowedPeerIds.length) {
            await sql`UPDATE queue_leads SET company_target = FALSE, updated_at = now() WHERE id = ANY(${allowedPeerIds})`;
          }
          await sql`
            UPDATE queue_leads
            SET
              company_target = TRUE,
              disposition = CASE WHEN disposition = 'Covered by colleague' THEN NULL ELSE disposition END,
              callback_at = NULL,
              last_touch_at = now(),
              updated_at = now()
            WHERE id = ${id}
          `;
          await logQueueEvent(sql, {
            leadId: id,
            eventType: 'status_change',
            fromStatus: lead.status,
            toStatus: lead.status,
            ownerId: lead.owner_id,
            ownerName: lead.owner,
            actorEmail: identity.email,
            actorRole: identity.role,
            meta: { mode: 'promote-company-target', peersReset: allowedPeerIds.length },
          });
          return res.status(200).json({ success: true, action, id, mode, peersReset: allowedPeerIds.length });
        }

        return res.status(400).json({ success: false, error: 'Unknown mode for company-contact-state' });
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
          actorEmail: identity.email,
          actorRole: identity.role,
          meta: { from: { sector: lead.sector, subSector: lead.sub_sector }, to: { sector, subSector } },
        });
        return res.status(200).json({ success: true, action, id, sector, subSector });
      }

      // ── Correct a lead's contact details (reps can fix their own records) ─
      if (action === 'set-lead-name') {
        const { id } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });
        const nextName = String(body.name || '').trim().replace(/\s+/g, ' ');
        const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title');
        const hasEmail = Object.prototype.hasOwnProperty.call(body, 'email');
        const hasPhone = Object.prototype.hasOwnProperty.call(body, 'phone');
        const hasNotes = Object.prototype.hasOwnProperty.call(body, 'notes');
        const nextTitle = hasTitle ? (String(body.title || '').trim().replace(/\s+/g, ' ') || null) : null;
        const nextEmail = hasEmail ? (String(body.email || '').trim().toLowerCase() || null) : null;
        const nextPhone = hasPhone ? (String(body.phone || '').trim() || null) : null;
        const nextNotes = hasNotes ? (String(body.notes || '').trim() || null) : null;
        if (!nextName) return res.status(400).json({ success: false, error: 'Lead name is required' });
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
        if (!canAccessLead(identity, lead)) return res.status(403).json({ success: false, error: 'You can only update your own leads' });
        if (hasEmail && nextEmail) {
          const clash = await sql`
            SELECT id FROM queue_leads
            WHERE id <> ${id}
              AND lower(email) = lower(${nextEmail})
            LIMIT 1
          `;
          if (clash.length) {
            return res.status(409).json({ success: false, error: 'That email is already used by another lead' });
          }
        }
        const split = splitLeadName(nextName);
        await sql`
          UPDATE queue_leads
          SET name = ${split.name},
              first_name = ${split.firstName},
              last_name = ${split.lastName},
              title = CASE WHEN ${hasTitle}::boolean THEN ${nextTitle} ELSE title END,
              email = CASE WHEN ${hasEmail}::boolean THEN ${nextEmail} ELSE email END,
              phone = CASE WHEN ${hasPhone}::boolean THEN ${nextPhone} ELSE phone END,
              call_notes = CASE WHEN ${hasNotes}::boolean THEN ${nextNotes} ELSE call_notes END,
              updated_at = now(),
              last_touch_at = now()
          WHERE id = ${id}
        `;
        await logQueueEvent(sql, {
          leadId: id,
          eventType: 'lead_name',
          ownerId: lead.owner_id,
          ownerName: lead.owner,
          actorEmail: identity.email,
          actorRole: identity.role,
          meta: {
            from: {
              name: lead.name || null,
              title: lead.title || null,
              email: lead.email || null,
              phone: lead.phone || null,
              notes: lead.call_notes || null,
            },
            to: {
              name: split.name,
              title: hasTitle ? nextTitle : (lead.title || null),
              email: hasEmail ? nextEmail : (lead.email || null),
              phone: hasPhone ? nextPhone : (lead.phone || null),
              notes: hasNotes ? nextNotes : (lead.call_notes || null),
            },
          },
        });
        if (hasNotes) {
          const noteDelta = deriveLeadDetailsNoteDelta(lead.call_notes, nextNotes);
          if (noteDelta) {
            await createLeadTimelineNote(sql, {
              leadId: id,
              note: noteDelta,
              source: 'lead-details-note',
              ownerId: lead.owner_id || identity.ghlOwnerId || null,
              ownerName: lead.owner || identity.name || null,
              actorEmail: identity.email,
              actorRole: identity.role,
              appendToCallNotes: false,
            });
          }
        }
        return res.status(200).json({
          success: true,
          action,
          id,
          name: split.name,
          firstName: split.firstName,
          lastName: split.lastName,
          title: hasTitle ? nextTitle : (lead.title ?? null),
          email: hasEmail ? nextEmail : (lead.email ?? null),
          phone: hasPhone ? nextPhone : (lead.phone ?? null),
          notes: hasNotes ? nextNotes : (lead.call_notes ?? null),
        });
      }

      // ── Save call notes (DB only) ─────────────────────────────────────────
      if (action === 'note') {
        const { id, notes } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
        if (!canAccessLead(identity, lead)) return res.status(403).json({ success: false, error: 'You can only update your own leads' });
        await sql`
          UPDATE queue_leads SET call_notes = ${notes ?? null}, last_touch_at = now(), updated_at = now()
          WHERE id = ${id}
        `;
        await logQueueEvent(sql, {
          leadId: id,
          eventType: 'note',
          ownerId: lead?.owner_id || null,
          ownerName: lead?.owner || null,
          actorEmail: identity.email,
          actorRole: identity.role,
          meta: { text: notes ?? null, source: 'detail-editor' },
        });
        return res.status(200).json({ success: true, action, id });
      }

      // ── Notes timeline (contact/call/opportunity context) ───────────────
      if (action === 'notes-history') {
        const { id } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

        await ensureLeadNotesTable(sql);
        const rows = await sql`
          SELECT id, note, owner_id, owner_name, source, created_at
          FROM lead_notes
          WHERE lead_id = ${id}
          ORDER BY created_at ASC, id ASC
        `;

        const notes = rows.map((r) => ({
          id: r.id,
          note: r.note,
          ownerId: r.owner_id || null,
          ownerName: r.owner_name || null,
          source: r.source || 'manual',
          createdAt: r.created_at,
        }));

        const legacySnapshot = normalizeTimelineNoteText(lead.call_notes);
        const timelineSnapshot = normalizeTimelineNoteText((notes || []).map((n) => n.note || '').join('\n'));
        const includeLegacySnapshot = !!legacySnapshot && (!notes.length || timelineSnapshot !== legacySnapshot);

        if (includeLegacySnapshot) {
          notes.unshift({
            id: `snapshot-${id}`,
            note: String(lead.call_notes),
            ownerId: lead.owner_id || null,
            ownerName: lead.owner || null,
            source: 'legacy_field_snapshot',
            createdAt: lead.updated_at || lead.created_at || null,
          });
        }

        notes.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        return res.status(200).json({ success: true, action, id, notes });
      }

      if (action === 'meeting-history') {
        const { id } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
        if (!canViewLead(identity, lead)) return res.status(403).json({ success: false, error: 'You can only view your own inbound leads' });
        const meetings = await loadOpportunityMeetings(sql, id);
        return res.status(200).json({ success: true, action, id, meetings });
      }

      if (action === 'meeting-history-bulk') {
        const ids = Array.isArray(body.ids)
          ? body.ids.map((value) => Number(value)).filter((value) => Number.isFinite(value))
          : [];
        if (!ids.length) return res.status(200).json({ success: true, action, meetingsByLead: {} });
        const leads = await sql`
          SELECT * FROM queue_leads
          WHERE id = ANY(${ids})
            AND archived_at IS NULL
        `;
        const allowedIds = leads
          .filter((lead) => canViewLead(identity, lead))
          .map((lead) => Number(lead.id))
          .filter((value) => Number.isFinite(value));
        const meetingsByLead = await loadOpportunityMeetingsBulk(sql, allowedIds);
        return res.status(200).json({ success: true, action, meetingsByLead });
      }

      if (action === 'book-opportunity-meeting') {
        const { id } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
        if (!canAccessLead(identity, lead)) return res.status(403).json({ success: false, error: 'You can only update your own qualified leads' });
        if (lead.status !== 'qualified') return res.status(400).json({ success: false, error: 'Only qualified leads can book meetings' });

        const scheduledFor = String(body.scheduledFor || body.meetingScheduledAt || '').trim();
        if (!scheduledFor) return res.status(400).json({ success: false, error: 'Meeting date is required' });
        const scheduledDate = new Date(scheduledFor);
        if (Number.isNaN(scheduledDate.getTime())) return res.status(400).json({ success: false, error: 'Meeting date must be valid' });

        const meetingType = normalizeMeetingType(body.meetingType);
        const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 5000) : null;
        const nextStepSummary = typeof body.nextStepSummary === 'string' ? body.nextStepSummary.trim().slice(0, 1000) : null;
        const accompanyingOwnerIds = normalizeMeetingParticipantIds(body.accompanyingOwnerIds).filter((ownerId) => !!repById(ownerId));
        const meeting = await createOpportunityMeeting(sql, {
          lead,
          scheduledFor: scheduledDate.toISOString(),
          meetingType,
          bookingChannel: 'manual',
          notes,
          nextStepSummary,
          primaryOwnerId: lead.owner_id || identity.ghlOwnerId || null,
          primaryOwnerName: lead.owner || identity.name || null,
          accompanyingOwnerIds,
          actorEmail: identity.email,
          actorRole: identity.role,
        });

        if (['qualified', 'meeting_booked', 'meeting_no_show', 'meeting_attended'].includes(String(lead.opportunity_stage || 'qualified'))) {
          await sql`
            UPDATE queue_leads
            SET opportunity_stage = 'meeting_booked', last_touch_at = now(), updated_at = now()
            WHERE id = ${id}
          `;
        }

        const refreshed = await loadLead(sql, id);
        return res.status(200).json({ success: true, action, id, meeting, lead: rowToClient(refreshed) });
      }

      if (action === 'add-lead-note') {
        const { id } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });
        const note = String(body.note || '').trim();
        if (!note) return res.status(400).json({ success: false, error: 'Note text required' });
        const source = String(body.source || 'manual').trim().slice(0, 64) || 'manual';
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
        if (!canAccessLead(identity, lead)) return res.status(403).json({ success: false, error: 'You can only update your own leads' });

        const ownerId = lead.owner_id || identity.ghlOwnerId || null;
        const ownerName = lead.owner || identity.name || null;
        const created = await createLeadTimelineNote(sql, {
          leadId: id,
          note,
          source,
          ownerId,
          ownerName,
          actorEmail: identity.email,
          actorRole: identity.role,
          appendToCallNotes: true,
        });

        return res.status(200).json({
          success: true,
          action,
          id,
          note: created,
        });
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
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
        if (!canViewLead(identity, lead)) return res.status(403).json({ success: false, error: 'You can only view your own inbound leads' });
        const calls = await loadCallHistory(sql, id);
        return res.status(200).json({ success: true, action, id, calls });
      }

      // ── Manually log a call outcome (fallback when 3CX webhook is off) ────
      if (action === 'log-call') {
        const { id } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });
        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
        if (!canAccessLead(identity, lead)) return res.status(403).json({ success: false, error: 'You can only log calls on your own leads' });
        const result = await recordCall(sql, {
          lead,
          direction: body.direction || 'outbound',
          fromNumber: body.fromNumber || null,
          toNumber: body.toNumber || lead.phone || null,
          agent: body.agent || lead.owner || null,
          durationSec: body.durationSec,
          outcome: body.outcome || null,
          actionKey: body.actionKey || null,
          actionLabel: body.actionLabel || null,
          recordingUrl: body.recordingUrl || null,
          callId: body.callId || null,
          provider: body.provider || 'manual',
        });

        // Optional one-click board updates driven by the call outcome.
        // Qualifying is intentionally excluded — it must go through the qualify questionnaire.
        const setStatus = STATUSES.includes(body.setStatus) && body.setStatus !== 'qualified' ? body.setStatus : null;
        const setDisposition = typeof body.setDisposition === 'string' && body.setDisposition !== '' ? body.setDisposition : null;
        const callbackAt = body.callbackAt || null;
        const clearCallbackAt = body.clearCallbackAt === true || setStatus === 'no_answer';
        const notes = typeof body.notes === 'string' && body.notes.trim() !== '' ? body.notes.trim() : null;
        const nextPriority = setStatus ? statusPriority(setStatus) : null;
        if (setStatus || setDisposition || callbackAt || clearCallbackAt || notes) {
          await sql`
            UPDATE queue_leads SET
              status = COALESCE(${setStatus}, status),
              priority = COALESCE(${nextPriority}, priority),
              disposition = COALESCE(${setDisposition}, disposition),
              callback_at = CASE
                WHEN ${clearCallbackAt}::boolean THEN NULL
                ELSE COALESCE(${callbackAt}::timestamptz, callback_at)
              END,
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
          if (setDisposition || callbackAt || clearCallbackAt) {
            await logQueueEvent(sql, {
              leadId: id, eventType: 'disposition', ownerId: lead.owner_id, ownerName: lead.owner,
              meta: { disposition: setDisposition, callbackAt, clearCallbackAt },
            });
          }
          if (notes) {
            await createLeadTimelineNote(sql, {
              leadId: id,
              note: notes,
              source: 'call-outcome-note',
              ownerId: lead.owner_id || identity.ghlOwnerId || null,
              ownerName: lead.owner || identity.name || null,
              actorEmail: identity.email,
              actorRole: identity.role,
              appendToCallNotes: false,
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
        return res.status(200).json({ success: true, action, id, ...result, applied: { setStatus, setDisposition, callbackAt, clearCallbackAt } });
      }

      if (action === 'log-manual-activity') {
        await ensureManualActivityBlocksTable(sql);
        const title = String(body.title || '').trim();
        const notes = String(body.notes || '').trim();
        const source = String(body.source || 'outbound').trim().toLowerCase() === 'inbound' ? 'inbound' : 'outbound';
        const startsAtRaw = String(body.startsAt || body.startAt || '').trim();
        const endsAtRaw = String(body.endsAt || body.endAt || '').trim();
        const startsAt = startsAtRaw ? new Date(startsAtRaw) : null;
        const endsAt = endsAtRaw ? new Date(endsAtRaw) : null;

        if (!title) return res.status(400).json({ success: false, error: 'Activity title is required' });
        if (!startsAt || Number.isNaN(startsAt.getTime())) return res.status(400).json({ success: false, error: 'Valid activity start date/time is required' });
        if (!endsAt || Number.isNaN(endsAt.getTime())) return res.status(400).json({ success: false, error: 'Valid activity end date/time is required' });
        if (endsAt.getTime() <= startsAt.getTime()) return res.status(400).json({ success: false, error: 'Activity end must be after start' });

        let ownerId = String(body.ownerId || '').trim();
        if (isRep(identity)) ownerId = String(identity.ghlOwnerId || '').trim();
        if (!ownerId) return res.status(400).json({ success: false, error: 'No owner mapped for activity logging' });

        const ownerName = repById(ownerId)?.name || String(identity.name || '').trim() || ownerId;
        const row = await sql`
          INSERT INTO manual_activity_blocks (owner_id, owner_name, title, notes, source, starts_at, ends_at, meta)
          VALUES (
            ${ownerId},
            ${ownerName || null},
            ${title.slice(0, 200)},
            ${notes ? notes.slice(0, 5000) : null},
            ${source},
            ${startsAt.toISOString()}::timestamptz,
            ${endsAt.toISOString()}::timestamptz,
            ${JSON.stringify({ provider: 'manual-activity', via: 'sidebar-activity-log' })}
          )
          RETURNING id, created_at, starts_at, ends_at
        `;

        await writeAudit(sql, {
          actorEmail: identity.email,
          actorRole: identity.role,
          event: 'manual_activity_logged',
          target: 'manual_activity_blocks',
          meta: { ownerId, source, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
        });

        return res.status(200).json({
          success: true,
          action,
          logged: true,
          id: row[0]?.id || null,
          createdAt: row[0]?.created_at || null,
          startsAt: row[0]?.starts_at || null,
          endsAt: row[0]?.ends_at || null,
        });
      }

      if (action === 'manual-activities-recent') {
        await ensureManualActivityBlocksTable(sql);
        const limitInput = Number.parseInt(String(body.limit || '300'), 10);
        const limit = Number.isFinite(limitInput) ? Math.max(1, Math.min(1000, limitInput)) : 300;
        const source = String(body.source || 'outbound').trim().toLowerCase() === 'inbound' ? 'inbound' : 'outbound';
        let ownerId = String(body.ownerId || '').trim();
        if (isRep(identity)) ownerId = String(identity.ghlOwnerId || '').trim();
        const ownerFilter = ownerId || null;

        const rangeStartRaw = String(body.rangeStart || '').trim();
        const rangeEndRaw = String(body.rangeEnd || '').trim();
        const rangeStartDate = rangeStartRaw ? new Date(rangeStartRaw) : null;
        const rangeEndDate = rangeEndRaw ? new Date(rangeEndRaw) : null;
        const rangeStart = rangeStartDate && !Number.isNaN(rangeStartDate.getTime()) ? rangeStartDate.toISOString() : null;
        const rangeEnd = rangeEndDate && !Number.isNaN(rangeEndDate.getTime()) ? rangeEndDate.toISOString() : null;

        const rows = await sql`
          SELECT id, owner_id, owner_name, title, notes, source, starts_at, ends_at, created_at, updated_at
          FROM manual_activity_blocks
          WHERE source = ${source}
            AND (${ownerFilter}::text IS NULL OR owner_id = ${ownerFilter})
            AND (${rangeStart}::timestamptz IS NULL OR ends_at >= ${rangeStart}::timestamptz)
            AND (${rangeEnd}::timestamptz IS NULL OR starts_at <= ${rangeEnd}::timestamptz)
          ORDER BY starts_at ASC, id ASC
          LIMIT ${limit}
        `;

        return res.status(200).json({
          success: true,
          action,
          logs: rows.map((row) => ({
            id: row.id,
            ownerId: row.owner_id,
            ownerName: row.owner_name,
            title: row.title,
            notes: row.notes,
            source: row.source,
            startsAt: row.starts_at,
            endsAt: row.ends_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          })),
        });
      }

      if (action === 'manual-activity-update') {
        await ensureManualActivityBlocksTable(sql);
        const id = Number.parseInt(String(body.id || ''), 10);
        if (!Number.isFinite(id) || id <= 0) {
          return res.status(400).json({ success: false, error: 'Valid manual activity id is required' });
        }

        const existingRows = await sql`
          SELECT id, owner_id, owner_name, title, notes, source, starts_at, ends_at
          FROM manual_activity_blocks
          WHERE id = ${id}
          LIMIT 1
        `;
        const existing = existingRows[0];
        if (!existing) return res.status(404).json({ success: false, error: 'Manual activity not found' });
        if (isRep(identity) && String(existing.owner_id || '') !== String(identity.ghlOwnerId || '')) {
          return res.status(403).json({ success: false, error: 'You can only edit your own manual activities' });
        }

        const nextTitle = body.title == null ? String(existing.title || '') : String(body.title || '').trim();
        if (!nextTitle) return res.status(400).json({ success: false, error: 'Activity title is required' });
        const nextNotes = body.notes == null ? (existing.notes == null ? null : String(existing.notes)) : (String(body.notes || '').trim() || null);
        const nextStartsRaw = body.startsAt == null
          ? (existing.starts_at ? new Date(existing.starts_at).toISOString() : '')
          : String(body.startsAt || '').trim();
        const nextEndsRaw = body.endsAt == null
          ? (existing.ends_at ? new Date(existing.ends_at).toISOString() : '')
          : String(body.endsAt || '').trim();
        const nextStarts = nextStartsRaw ? new Date(nextStartsRaw) : null;
        const nextEnds = nextEndsRaw ? new Date(nextEndsRaw) : null;
        if (!nextStarts || Number.isNaN(nextStarts.getTime())) return res.status(400).json({ success: false, error: 'Valid activity start date/time is required' });
        if (!nextEnds || Number.isNaN(nextEnds.getTime())) return res.status(400).json({ success: false, error: 'Valid activity end date/time is required' });
        if (nextEnds.getTime() <= nextStarts.getTime()) return res.status(400).json({ success: false, error: 'Activity end must be after start' });

        const updatedRows = await sql`
          UPDATE manual_activity_blocks
          SET
            title = ${nextTitle.slice(0, 200)},
            notes = ${nextNotes ? nextNotes.slice(0, 5000) : null},
            starts_at = ${nextStarts.toISOString()}::timestamptz,
            ends_at = ${nextEnds.toISOString()}::timestamptz,
            owner_name = COALESCE(owner_name, ${repById(existing.owner_id)?.name || null}),
            updated_at = now()
          WHERE id = ${id}
          RETURNING id, owner_id, owner_name, title, notes, source, starts_at, ends_at, created_at, updated_at
        `;
        const updated = updatedRows[0];

        await writeAudit(sql, {
          actorEmail: identity.email,
          actorRole: identity.role,
          event: 'manual_activity_updated',
          target: 'manual_activity_blocks',
          meta: { id, ownerId: updated?.owner_id || existing.owner_id || null },
        });

        return res.status(200).json({
          success: true,
          action,
          log: updated ? {
            id: updated.id,
            ownerId: updated.owner_id,
            ownerName: updated.owner_name,
            title: updated.title,
            notes: updated.notes,
            source: updated.source,
            startsAt: updated.starts_at,
            endsAt: updated.ends_at,
            createdAt: updated.created_at,
            updatedAt: updated.updated_at,
          } : null,
        });
      }

      if (action === 'manual-activity-conflicts') {
        await ensureManualActivityBlocksTable(sql);
        const source = String(body.source || 'outbound').trim().toLowerCase() === 'inbound' ? 'inbound' : 'outbound';
        const startsAtRaw = String(body.startsAt || body.startAt || '').trim();
        const endsAtRaw = String(body.endsAt || body.endAt || '').trim();
        const startsAt = startsAtRaw ? new Date(startsAtRaw) : null;
        const endsAt = endsAtRaw ? new Date(endsAtRaw) : null;
        if (!startsAt || Number.isNaN(startsAt.getTime())) {
          return res.status(400).json({ success: false, error: 'Valid activity start date/time is required' });
        }
        if (!endsAt || Number.isNaN(endsAt.getTime())) {
          return res.status(400).json({ success: false, error: 'Valid activity end date/time is required' });
        }
        if (endsAt.getTime() <= startsAt.getTime()) {
          return res.status(400).json({ success: false, error: 'Activity end must be after start' });
        }

        let ownerId = String(body.ownerId || '').trim();
        if (isRep(identity)) ownerId = String(identity.ghlOwnerId || '').trim();
        if (!ownerId) return res.status(400).json({ success: false, error: 'No owner mapped for activity conflict check' });

        const excludeIdInput = Number.parseInt(String(body.excludeId || body.id || ''), 10);
        const excludeId = Number.isFinite(excludeIdInput) && excludeIdInput > 0 ? excludeIdInput : null;

        const rows = await sql`
          SELECT id, owner_id, owner_name, title, notes, source, starts_at, ends_at, created_at, updated_at
          FROM manual_activity_blocks
          WHERE owner_id = ${ownerId}
            AND source = ${source}
            AND (${excludeId}::bigint IS NULL OR id <> ${excludeId})
            AND starts_at < ${endsAt.toISOString()}::timestamptz
            AND ends_at > ${startsAt.toISOString()}::timestamptz
          ORDER BY starts_at ASC, id ASC
          LIMIT 25
        `;

        return res.status(200).json({
          success: true,
          action,
          ownerId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          hasConflicts: rows.length > 0,
          conflicts: rows.map((row) => ({
            id: row.id,
            ownerId: row.owner_id,
            ownerName: row.owner_name,
            title: row.title,
            notes: row.notes,
            source: row.source,
            startsAt: row.starts_at,
            endsAt: row.ends_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          })),
        });
      }

      return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
