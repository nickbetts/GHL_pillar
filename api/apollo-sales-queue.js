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
import { checkAuth } from './auth.js';

const LOCATION_ID = process.env.GHL_LOCATION_ID;
const PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const QUALIFIED_STAGE_ID = process.env.GHL_QUALIFIED_STAGE_ID;
const CONVERTED_STAGE_ID = process.env.GHL_CONVERTED_STAGE_ID;

const STATUSES = ['to_contact', 'to_call_back', 'wants_more_info', 'no_answer', 'qualified', 'converted', 'not_interested'];
const PRIORITIES = ['hot', 'warm', 'cold'];
const GHL_STATUSES = new Set(['converted']);

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
      ${lead.company_revenue}, ${lead.linkedin_url}, ${lead.priority}, ${owner.name}, ${owner.id},
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
    apolloSynced: row.apollo_synced,
    lastTouchAt: row.last_touch_at,
    ghlContactId: row.ghl_contact_id,
    ghlOpportunityId: row.ghl_opportunity_id,
  };
}

// ── GHL integration (only reached via the qualify/convert gate) ─────────────

async function ensureGhlContact(lead, owner) {
  if (lead.ghl_contact_id) return lead.ghl_contact_id;

  try {
    const existing = await get(`/contacts/${lead.email}`, { locationId: LOCATION_ID });
    if (existing?.contact?.id) return existing.contact.id;
  } catch {
    // not found — create below
  }

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
    tags: ['apollo-queue', `priority-${lead.priority || 'warm'}`],
  });

  return created?.contact?.id || null;
}

async function ensureGhlOpportunity(lead, contactId, { stageId, monetaryValue, owner }) {
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
  });

  return { id: created?.opportunity?.id || null, skipped: false };
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

async function pushToGhl(lead, { asDeal, monetaryValue, owner }) {
  const contactId = await ensureGhlContact(lead, owner);
  const stageId = asDeal ? (CONVERTED_STAGE_ID || QUALIFIED_STAGE_ID) : QUALIFIED_STAGE_ID;
  const opportunity = await ensureGhlOpportunity(lead, contactId, { stageId, monetaryValue, owner });
  const apollo = await apolloWriteback(lead, asDeal ? 'Converted' : 'Qualified');
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
  await sql`CREATE INDEX IF NOT EXISTS queue_candidates_wave_idx ON queue_candidates (wave)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_candidates_released_idx ON queue_candidates (released)`;
  await sql`CREATE INDEX IF NOT EXISTS queue_candidates_sector_idx ON queue_candidates (sector)`;
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

/** Ensure no rows remain unassigned on board load. */
async function ensureOwnersAssigned(sql) {
  const unassigned = await sql`
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
  if (!checkAuth(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  let sql;
  try {
    sql = getSql();
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  if (req.method === 'GET') {
    try {
      await ensureOwnersAssigned(sql);
      // One-time migration: map the old single 'contacted' status onto 'to_call_back'.
      await sql`UPDATE queue_leads SET status = 'to_call_back' WHERE status = 'contacted'`;

      const rows = await sql`
        SELECT * FROM queue_leads
        ORDER BY
          CASE priority WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
          created_at DESC
      `;
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

    try {
      // ── Enqueue MCP-curated contacts into staging (no GHL write) ──────────
      if (action === 'enqueue') {
        const contacts = Array.isArray(body.contacts) ? body.contacts : [];
        let inserted = 0;
        for (const raw of contacts) {
          const lead = normalizeContact(raw);
          inserted += await upsertLead(sql, lead);
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

      // ── Candidate pool stats (banked / released / by sector / by wave) ────
      if (action === 'candidate-stats') {
        await ensureCandidatesTable(sql);
        const totalRows = await sql`SELECT COUNT(*)::int AS c FROM queue_candidates`;
        const releasedRows = await sql`SELECT COUNT(*)::int AS c FROM queue_candidates WHERE released = TRUE`;
        const enqueuedRows = await sql`SELECT COUNT(*)::int AS c FROM queue_candidates WHERE enqueued = TRUE`;
        const bySector = await sql`
          SELECT COALESCE(sector, 'Unknown') AS sector,
                 COUNT(*)::int AS total,
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
          bySector,
          bySubSector,
          byTier,
          byWave,
        });
      }

      // ── Mark the next N unreleased candidates as a wave, return the list ──
      // Enrichment (credit spend) happens OUTSIDE this endpoint, in a controlled
      // script, then those rows are enqueued to the board.
      if (action === 'release-wave') {
        await ensureCandidatesTable(sql);
        const wave = Number.parseInt(body.wave, 10);
        const limit = Math.min(Math.max(Number.parseInt(body.limit, 10) || 1111, 1), 5000);
        if (!Number.isFinite(wave) || wave < 1) {
          return res.status(400).json({ success: false, error: 'Valid wave number required' });
        }

        const rows = await sql`
          WITH picked AS (
            SELECT id FROM queue_candidates
            WHERE released = FALSE
            ORDER BY COALESCE(tier, 2) ASC, CASE priority WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END, id ASC
            LIMIT ${limit}
          )
          UPDATE queue_candidates c
          SET wave = ${wave}, released = TRUE, released_at = now(), updated_at = now()
          FROM picked
          WHERE c.id = picked.id
          RETURNING c.id, c.apollo_id, c.first_name, c.last_name, c.name, c.title,
                    c.company_name, c.company_domain, c.sector, c.sub_sector, c.priority
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
        if (GHL_STATUSES.has(status)) {
          // Preserve the queue owner as the GHL assignee. Fallback should be rare.
          owner = lead.owner_id ? { id: lead.owner_id, name: lead.owner } : await pickRoundRobinOwner(sql);
          ghl = await pushToGhl(lead, { asDeal: status === 'converted', monetaryValue: body.monetaryValue, owner });
        }

        await sql`
          UPDATE queue_leads SET
            status = ${status},
            owner = COALESCE(${owner?.name || body.owner || null}, owner),
            owner_id = COALESCE(${owner?.id || null}, owner_id),
            call_notes = COALESCE(${body.notes ?? null}, call_notes),
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
          meta: { via: 'status-action' },
        });

        return res.status(200).json({ success: true, action, id, status, ghl });
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

      // ── Convert to deal (gate → GHL contact + opportunity) ────────────────
      if (action === 'convert') {
        const { id } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });

        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

        // Always carry queue owner into GHL assignee when converting.
        const owner = lead.owner_id ? { id: lead.owner_id, name: lead.owner } : await pickRoundRobinOwner(sql);
        const ghl = await pushToGhl(lead, { asDeal: true, monetaryValue: body.monetaryValue, owner });

        await sql`
          UPDATE queue_leads SET
            status = 'converted',
            owner = COALESCE(${owner?.name || null}, owner),
            owner_id = COALESCE(${owner?.id || null}, owner_id),
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
          toStatus: 'converted',
          ownerId: owner?.id || lead.owner_id,
          ownerName: owner?.name || lead.owner,
          meta: { via: 'convert-action', monetaryValue: body.monetaryValue || null },
        });

        return res.status(200).json({ success: true, action, id, ghl });
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
        await logQueueEvent(sql, {
          leadId: id,
          eventType: 'disposition',
          ownerId: lead?.owner_id || null,
          ownerName: lead?.owner || null,
          meta: { disposition: disposition ?? null, callbackAt: callbackAt ?? null },
        });
        return res.status(200).json({ success: true, action, id });
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

      return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
