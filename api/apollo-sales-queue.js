/**
 * Apollo Sales Queue — Neon-backed staging store + gated GHL integration.
 *
 * Flow:
 *   1. Leads are enqueued from Apollo (via MCP curation or an Apollo list) into
 *      Postgres at status `to_contact`. They do NOT touch GHL yet.
 *   2. Reps work them on the board: to_contact -> contacted.
 *   3. GATE: moving a lead to `qualified` or `converted` is the ONLY thing that
 *      writes to GHL (contact, and an opportunity/deal on convert).
 *   4. `not_interested` leads stay out of GHL entirely.
 *
 * Endpoints:
 *   GET  /api/apollo-sales-queue            -> board data grouped by status
 *   POST /api/apollo-sales-queue { action } -> enqueue | sync-list | status | note | convert
 */

import { get, post, put } from '../client.js';
import { getSql } from './db.js';
import { getContactsFromList, apolloFetch } from './apollo-client.js';
import { checkAuth } from './auth.js';

const LOCATION_ID = process.env.GHL_LOCATION_ID;
const DEFAULT_APOLLO_LIST_ID = process.env.APOLLO_LIST_ID;
const PIPELINE_ID = process.env.GHL_PIPELINE_ID;
const QUALIFIED_STAGE_ID = process.env.GHL_QUALIFIED_STAGE_ID;
const CONVERTED_STAGE_ID = process.env.GHL_CONVERTED_STAGE_ID;

const STATUSES = ['to_contact', 'contacted', 'qualified', 'converted', 'not_interested'];
const GHL_STATUSES = new Set(['qualified', 'converted']);

// Round-robin sales reps (GHL user IDs)
const ROUND_ROBIN = [
  { name: 'Brendon Mwatsenekenyi', id: '6FX5X4kH2JFJc6u9zhSC' },
  { name: 'Zain Safir-Sheikh', id: 'XbyxbOK1Q1raRCjjGx4O' },
  { name: 'Amir Ward', id: 's7OG2BM94q7uNRsHLqM7' },
];

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
  const rows = await sql`
    INSERT INTO queue_leads (
      apollo_id, first_name, last_name, name, title, email, phone,
      company_name, company_website, company_industry, company_employees,
      company_revenue, linkedin_url, priority, raw, last_touch_at
    ) VALUES (
      ${lead.apollo_id}, ${lead.first_name}, ${lead.last_name}, ${lead.name},
      ${lead.title}, ${lead.email}, ${lead.phone}, ${lead.company_name},
      ${lead.company_website}, ${lead.company_industry}, ${lead.company_employees},
      ${lead.company_revenue}, ${lead.linkedin_url}, ${lead.priority},
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
      company_employees = COALESCE(EXCLUDED.company_employees, queue_leads.company_employees),
      company_revenue   = COALESCE(EXCLUDED.company_revenue, queue_leads.company_revenue),
      linkedin_url      = COALESCE(EXCLUDED.linkedin_url, queue_leads.linkedin_url),
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
          inserted += await upsertLead(sql, normalizeContact(raw));
        }
        return res.status(200).json({ success: true, action, inserted });
      }

      // ── Pull an Apollo list server-side into staging (no GHL write) ───────
      if (action === 'sync-list') {
        const listId = body.listId || DEFAULT_APOLLO_LIST_ID;
        if (!listId) {
          return res.status(400).json({ success: false, error: 'No Apollo list ID provided' });
        }
        const apolloContacts = await getContactsFromList(listId);
        let inserted = 0;
        for (const raw of apolloContacts) {
          inserted += await upsertLead(sql, normalizeContact(raw));
        }
        return res.status(200).json({ success: true, action, listId, inserted });
      }

      // ── Status / notes updates (GHL write ONLY on qualify/convert) ────────
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

        return res.status(200).json({ success: true, action, id, status, ghl });
      }

      // ── Convert to deal (gate → GHL contact + opportunity) ────────────────
      if (action === 'convert') {
        const { id } = body;
        if (!id) return res.status(400).json({ success: false, error: 'Lead id required' });

        const lead = await loadLead(sql, id);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

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
        return res.status(200).json({ success: true, action, id });
      }

      return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
