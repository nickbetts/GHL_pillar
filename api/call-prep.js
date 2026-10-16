/**
 * POST /api/call-prep { leadId, refresh? } — the call brief for a lead.
 * The AI playbook is written once per sector and kept for good; managers and admins can regenerate it.
 * Reps can prep their own leads; managers and admins can prep any.
 */

import { getSql } from './db.js';
import { hasMinRole, resolveIdentity } from './session.js';
import { composeBrief, generateSectorPlaybook, leadFacts, sectorKey } from '../lib/callPrep.js';

let tableReady = null;
function ensureTable(sql) {
  if (!tableReady) {
    tableReady = sql`CREATE TABLE IF NOT EXISTS sector_call_prep (sector_key TEXT PRIMARY KEY, playbook JSONB NOT NULL, source TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`
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
  const isManager = hasMinRole(identity, 'manager');

  try {
    const sql = getSql();
    const rows = await sql`
      SELECT id, name, title, company_name, company_industry, sector, sub_sector, company_employees,
             status, disposition, next_step_summary, owner_id
      FROM queue_leads WHERE id = ${leadId} AND archived_at IS NULL
    `;
    const lead = rows[0];
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (!isManager && String(lead.owner_id || '') !== String(identity.ghlOwnerId || '')) {
      return res.status(403).json({ success: false, error: 'You can only prep your own leads' });
    }

    const [notes, calls] = await Promise.all([
      sql`SELECT note FROM lead_notes WHERE lead_id = ${leadId} ORDER BY created_at DESC LIMIT 5`,
      sql`SELECT COALESCE(meta->>'outcome', 'Call') AS outcome FROM queue_events WHERE lead_id = ${leadId} AND event_type = 'call' ORDER BY created_at DESC LIMIT 5`,
    ]);
    const facts = leadFacts(lead, { notes: notes.map((n) => n.note), calls: calls.map((c) => c.outcome) });
    const key = sectorKey(facts);

    await ensureTable(sql);
    let playbook = null;
    let source = 'ai';
    if (!(req.body?.refresh && isManager)) {
      const cached = await sql`SELECT playbook FROM sector_call_prep WHERE sector_key = ${key}`;
      if (cached[0]) playbook = cached[0].playbook;
    }
    if (!playbook) {
      const generated = await generateSectorPlaybook(facts);
      playbook = generated.playbook;
      source = generated.source;
      // Only real AI output is kept; the standard fallback is cheap to rebuild and must not block the AI later.
      if (source === 'ai') {
        await sql`
          INSERT INTO sector_call_prep (sector_key, playbook, source, created_at) VALUES (${key}, ${JSON.stringify(playbook)}::jsonb, ${source}, now())
          ON CONFLICT (sector_key) DO UPDATE SET playbook = EXCLUDED.playbook, source = EXCLUDED.source, created_at = now()
        `;
      }
    }
    return res.status(200).json({ success: true, brief: composeBrief(playbook, facts), source, sector: key, canRefresh: isManager });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
