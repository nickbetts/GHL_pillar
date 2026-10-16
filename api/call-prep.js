/**
 * POST /api/call-prep { leadId, refresh? } — a short AI brief for the call, cached per lead for a week.
 * Reps can prep their own leads; managers and admins can prep any.
 */

import { getSql } from './db.js';
import { hasMinRole, resolveIdentity } from './session.js';
import { generateCallPrep, leadFacts } from '../lib/callPrep.js';

const CACHE_DAYS = 7;
let tableReady = null;
function ensureTable(sql) {
  if (!tableReady) {
    tableReady = sql`CREATE TABLE IF NOT EXISTS lead_call_prep (lead_id BIGINT PRIMARY KEY, brief JSONB NOT NULL, source TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`
      .catch((error) => { tableReady = null; throw error; });
  }
  return tableReady;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const identity = resolveIdentity(req);
  if (!identity) return res.status(401).json({ success: false, error: 'Not signed in' });
  const leadId = Number.parseInt(req.body?.leadId, 10);
  if (!Number.isFinite(leadId)) return res.status(400).json({ success: false, error: 'leadId required' });

  try {
    const sql = getSql();
    const rows = await sql`
      SELECT id, name, title, company_name, company_website, company_industry, sector, sub_sector, company_employees, company_revenue,
             source, status, disposition, next_step_summary, owner_id
      FROM queue_leads WHERE id = ${leadId} AND archived_at IS NULL
    `;
    const lead = rows[0];
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (!hasMinRole(identity, 'manager') && String(lead.owner_id || '') !== String(identity.ghlOwnerId || '')) {
      return res.status(403).json({ success: false, error: 'You can only prep your own leads' });
    }

    await ensureTable(sql);
    if (!req.body?.refresh) {
      const cached = await sql`SELECT brief, source, created_at FROM lead_call_prep WHERE lead_id = ${leadId} AND created_at > now() - ${`${CACHE_DAYS} days`}::interval`;
      if (cached[0]) return res.status(200).json({ success: true, brief: cached[0].brief, source: cached[0].source, cachedAt: cached[0].created_at });
    }

    const [notes, calls] = await Promise.all([
      sql`SELECT note FROM lead_notes WHERE lead_id = ${leadId} ORDER BY created_at DESC LIMIT 5`,
      sql`SELECT COALESCE(meta->>'outcome', 'Call') AS outcome FROM queue_events WHERE lead_id = ${leadId} AND event_type = 'call' ORDER BY created_at DESC LIMIT 5`,
    ]);
    const { brief, source } = await generateCallPrep(leadFacts(lead, { notes: notes.map((n) => n.note), calls: calls.map((c) => c.outcome) }));
    await sql`
      INSERT INTO lead_call_prep (lead_id, brief, source, created_at) VALUES (${leadId}, ${JSON.stringify(brief)}::jsonb, ${source}, now())
      ON CONFLICT (lead_id) DO UPDATE SET brief = EXCLUDED.brief, source = EXCLUDED.source, created_at = now()
    `;
    return res.status(200).json({ success: true, brief, source });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
