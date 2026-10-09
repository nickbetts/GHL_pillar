/**
 * Proposal Hub — internal API (signed-in team members).
 *
 * Reps create proposals from opportunities using reusable block templates,
 * then share a token link with the client. The public side (unlock / accept /
 * sign) lives in api/proposal-public.js.
 *
 * All actions are POST { action: '...' } and require any signed-in role.
 */

import crypto from 'crypto';
import { getSql, ensureProposalTables } from './db.js';
import { resolveIdentity, hasMinRole, hashPassword } from './session.js';

const BLOCK_TYPES = ['heading', 'text', 'bullets', 'divider', 'options', 'timeline', 'comparison', 'investment'];

function money(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '—';
  return `£${num.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

function tokenContext(proposal) {
  return {
    client_name: proposal.client_name || 'there',
    client_company: proposal.client_company || 'your company',
    client_email: proposal.client_email || '',
    rep_name: proposal.owner_name || 'Your i3MEDIA contact',
    deal_type: proposal.deal_type || '—',
    mrr: proposal.mrr_value != null ? money(proposal.mrr_value) : '—',
    one_off: proposal.one_off_value != null ? money(proposal.one_off_value) : '—',
    date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    expiry_date: proposal.expires_at
      ? new Date(proposal.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : '—',
  };
}

function mergeTokens(text, ctx) {
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key) => (
    ctx[key.toLowerCase()] !== undefined ? ctx[key.toLowerCase()] : match
  ));
}

function cleanSide(input, ctx) {
  const side = input && typeof input === 'object' ? input : {};
  const clean = (value, max) => {
    let text = String(value ?? '').slice(0, max);
    if (ctx) text = mergeTokens(text, ctx);
    return text;
  };
  return {
    label: clean(side.label, 120),
    name: clean(side.name, 200),
    price: clean(side.price, 120),
    desc: clean(side.desc, 2000),
  };
}

function sanitizeBlocks(input, ctx = null) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 80).map((block) => {
    const type = BLOCK_TYPES.includes(block?.type) ? block.type : 'text';
    let text = String(block?.text || '').slice(0, 8000);
    if (ctx) text = mergeTokens(text, ctx);
    const out = { type, text };
    if (type === 'options') {
      out.data = { a: cleanSide(block?.data?.a, ctx), b: cleanSide(block?.data?.b, ctx) };
      out.recommended = ['a', 'b'].includes(block?.recommended) ? block.recommended : null;
    }
    return out;
  });
}

function cleanText(value, max = 300) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function newToken() {
  return crypto.randomBytes(9).toString('base64url');
}

function generatePassword() {
  return `stream-${crypto.randomBytes(3).toString('hex')}`;
}

function displayStatus(row) {
  if (row.status !== 'signed' && row.status !== 'accepted' && row.expires_at && new Date(row.expires_at) < new Date()) {
    return 'expired';
  }
  return row.status;
}

function mapProposal(row) {
  return {
    id: Number(row.id),
    token: row.token,
    leadId: row.lead_id == null ? null : Number(row.lead_id),
    templateId: row.template_id == null ? null : Number(row.template_id),
    title: row.title,
    clientName: row.client_name,
    clientCompany: row.client_company,
    clientEmail: row.client_email,
    dealType: row.deal_type,
    mrrValue: row.mrr_value == null ? null : Number(row.mrr_value),
    oneOffValue: row.one_off_value == null ? null : Number(row.one_off_value),
    status: displayStatus(row),
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    expiresAt: row.expires_at,
    firstViewedAt: row.first_viewed_at,
    lastViewedAt: row.last_viewed_at,
    viewCount: Number(row.view_count || 0),
    acceptedAt: row.accepted_at,
    acceptedByName: row.accepted_by_name,
    signedAt: row.signed_at,
    signedByName: row.signed_by_name,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    opportunityName: row.opportunity_name || null,
    opportunityCompany: row.opportunity_company || null,
    opportunityStage: row.opportunity_stage || null,
  };
}

async function logEvent(sql, proposalId, eventType, actorName, meta = null) {
  await sql`
    INSERT INTO proposal_events (proposal_id, event_type, actor_name, meta)
    VALUES (${proposalId}, ${eventType}, ${actorName}, ${meta ? JSON.stringify(meta) : null}::jsonb)
  `;
}

export default async function handler(req, res) {
  const identity = resolveIdentity(req);
  if (!identity) return res.status(401).json({ success: false, error: 'Not signed in' });
  if (!hasMinRole(identity, 'rep')) {
    return res.status(403).json({ success: false, error: 'You do not have access to Proposal Hub' });
  }
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  let sql;
  try {
    sql = getSql();
    await ensureProposalTables(sql);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  const body = req.body || {};
  const action = String(body.action || '');
  const isAdmin = hasMinRole(identity, 'admin');
  const ownerId = identity.ghlOwnerId || '';
  const ownerName = identity.name || identity.email || 'Unknown';

  try {
    // ── Opportunities a proposal can be built from ─────────────────────────
    if (action === 'list-opps') {
      const rows = await sql`
        SELECT id, name, company_name, owner, owner_id, opportunity_stage, deal_type, mrr_value, one_off_value, email
        FROM queue_leads
        WHERE status = 'qualified'
          AND archived_at IS NULL
          AND opportunity_stage IS NOT NULL
          AND opportunity_stage NOT IN ('won', 'lost')
        ORDER BY (opportunity_stage = 'proposal') DESC, updated_at DESC
        LIMIT 300
      `;
      return res.status(200).json({
        success: true,
        opportunities: rows.map((row) => ({
          id: Number(row.id),
          name: row.name,
          company: row.company_name,
          email: row.email,
          owner: row.owner,
          ownerId: row.owner_id,
          stage: row.opportunity_stage,
          dealType: row.deal_type,
          mrrValue: row.mrr_value == null ? null : Number(row.mrr_value),
          oneOffValue: row.one_off_value == null ? null : Number(row.one_off_value),
        })),
      });
    }

    // ── List proposals (everyone sees everything — it's a team tool) ───────
    if (action === 'list') {
      const rows = await sql`
        SELECT p.*, l.name AS opportunity_name, l.company_name AS opportunity_company, l.opportunity_stage
        FROM proposals p
        LEFT JOIN queue_leads l ON l.id = p.lead_id
        ORDER BY p.created_at DESC
        LIMIT 500
      `;
      return res.status(200).json({ success: true, proposals: rows.map(mapProposal) });
    }

    // ── Single proposal + its audit trail ──────────────────────────────────
    if (action === 'get') {
      const id = Number(body.id);
      if (!id) return res.status(400).json({ success: false, error: 'Proposal id required' });
      const rows = await sql`
        SELECT p.*, l.name AS opportunity_name, l.company_name AS opportunity_company, l.opportunity_stage
        FROM proposals p
        LEFT JOIN queue_leads l ON l.id = p.lead_id
        WHERE p.id = ${id}
      `;
      if (!rows.length) return res.status(404).json({ success: false, error: 'Proposal not found' });
      const events = await sql`
        SELECT event_type, actor_name, ip, created_at
        FROM proposal_events
        WHERE proposal_id = ${id}
        ORDER BY created_at ASC
        LIMIT 200
      `;
      const blocks = Array.isArray(rows[0].blocks) ? rows[0].blocks : [];
      return res.status(200).json({
        success: true,
        proposal: { ...mapProposal(rows[0]), blocks },
        events: events.map((event) => ({
          type: event.event_type,
          actor: event.actor_name,
          ip: event.ip,
          at: event.created_at,
        })),
      });
    }

    // ── Create from a template + opportunity ───────────────────────────────
    if (action === 'create') {
      const leadId = Number(body.leadId);
      const clientEmail = cleanText(body.clientEmail, 320);
      if (!leadId) return res.status(400).json({ success: false, error: 'Choose an opportunity' });
      if (!clientEmail || !clientEmail.includes('@')) {
        return res.status(400).json({ success: false, error: 'An approved client email is required' });
      }
      const password = cleanText(body.password, 120) || generatePassword();
      const expiryDays = Math.max(1, Math.min(90, Number(body.expiryDays) || 14));

      const leadRows = await sql`
        SELECT id, name, company_name, email, owner, owner_id, deal_type, mrr_value, one_off_value
        FROM queue_leads
        WHERE id = ${leadId} AND archived_at IS NULL
      `;
      if (!leadRows.length) return res.status(404).json({ success: false, error: 'Opportunity not found' });
      const lead = leadRows[0];

      let templateBlocks = [];
      let templateId = null;
      if (body.templateId) {
        const tplRows = await sql`SELECT id, blocks FROM proposal_templates WHERE id = ${Number(body.templateId)}`;
        if (tplRows.length) {
          templateId = Number(tplRows[0].id);
          templateBlocks = Array.isArray(tplRows[0].blocks) ? tplRows[0].blocks : [];
        }
      }
      if (!templateId) {
        const tplRows = await sql`SELECT id, blocks FROM proposal_templates ORDER BY is_default DESC, id ASC LIMIT 1`;
        if (tplRows.length) {
          templateId = Number(tplRows[0].id);
          templateBlocks = Array.isArray(tplRows[0].blocks) ? tplRows[0].blocks : [];
        }
      }

      const draft = {
        client_name: cleanText(body.clientName, 200) || lead.name,
        client_company: cleanText(body.clientCompany, 200) || lead.company_name,
        client_email: clientEmail,
        owner_name: ownerName,
        deal_type: lead.deal_type,
        mrr_value: lead.mrr_value,
        one_off_value: lead.one_off_value,
        expires_at: new Date(Date.now() + expiryDays * 86400000).toISOString(),
      };
      const blocks = sanitizeBlocks(templateBlocks, tokenContext(draft));
      const title = cleanText(body.title, 300) || `Proposal for ${draft.client_company || draft.client_name}`;
      const { hash, salt } = hashPassword(password);
      const token = newToken();

      const inserted = await sql`
        INSERT INTO proposals (
          token, lead_id, template_id, title, client_name, client_company, client_email,
          access_password_hash, access_password_salt, blocks, deal_type, mrr_value, one_off_value,
          status, owner_id, owner_name, expires_at, created_by_email
        ) VALUES (
          ${token}, ${leadId}, ${templateId}, ${title}, ${draft.client_name}, ${draft.client_company}, ${clientEmail},
          ${hash}, ${salt}, ${JSON.stringify(blocks)}::jsonb, ${lead.deal_type}, ${lead.mrr_value}, ${lead.one_off_value},
          'active', ${ownerId}, ${ownerName}, ${draft.expires_at}::timestamptz, ${identity.email}
        )
        RETURNING id
      `;
      const proposalId = Number(inserted[0].id);
      await logEvent(sql, proposalId, 'created', ownerName, { leadId, templateId });

      return res.status(200).json({ success: true, id: proposalId, token, password });
    }

    // ── Update an unsigned proposal ────────────────────────────────────────
    if (action === 'update') {
      const id = Number(body.id);
      if (!id) return res.status(400).json({ success: false, error: 'Proposal id required' });
      const rows = await sql`SELECT * FROM proposals WHERE id = ${id}`;
      if (!rows.length) return res.status(404).json({ success: false, error: 'Proposal not found' });
      const existing = rows[0];
      if (existing.signed_at) {
        return res.status(400).json({ success: false, error: 'Signed proposals are locked' });
      }
      if (!isAdmin && String(existing.owner_id || '') !== ownerId) {
        return res.status(403).json({ success: false, error: 'You can only edit your own proposals' });
      }

      const title = cleanText(body.title, 300) ?? existing.title;
      const clientName = cleanText(body.clientName, 200) ?? existing.client_name;
      const clientCompany = cleanText(body.clientCompany, 200) ?? existing.client_company;
      const clientEmail = cleanText(body.clientEmail, 320) ?? existing.client_email;
      const blocks = body.blocks !== undefined ? sanitizeBlocks(body.blocks) : existing.blocks;
      const expiryDays = body.expiryDays !== undefined ? Math.max(1, Math.min(90, Number(body.expiryDays) || 14)) : null;
      const newExpiry = expiryDays ? new Date(Date.now() + expiryDays * 86400000).toISOString() : existing.expires_at;

      let passwordSql = null;
      const newPassword = cleanText(body.password, 120);
      if (newPassword) passwordSql = hashPassword(newPassword);

      await sql`
        UPDATE proposals
        SET title = ${title},
            client_name = ${clientName},
            client_company = ${clientCompany},
            client_email = ${clientEmail},
            blocks = ${JSON.stringify(blocks)}::jsonb,
            expires_at = ${newExpiry}::timestamptz,
            access_password_hash = COALESCE(${passwordSql ? passwordSql.hash : null}, access_password_hash),
            access_password_salt = COALESCE(${passwordSql ? passwordSql.salt : null}, access_password_salt),
            updated_at = now()
        WHERE id = ${id}
      `;
      await logEvent(sql, id, 'updated', ownerName);
      return res.status(200).json({ success: true, id, password: newPassword || null });
    }

    // ── Delete (draft/active only; signed proposals are permanent records) ──
    if (action === 'delete') {
      const id = Number(body.id);
      if (!id) return res.status(400).json({ success: false, error: 'Proposal id required' });
      const rows = await sql`SELECT owner_id, signed_at, accepted_at FROM proposals WHERE id = ${id}`;
      if (!rows.length) return res.status(404).json({ success: false, error: 'Proposal not found' });
      if (rows[0].signed_at || rows[0].accepted_at) {
        return res.status(400).json({ success: false, error: 'Accepted or signed proposals cannot be deleted' });
      }
      if (!isAdmin && String(rows[0].owner_id || '') !== ownerId) {
        return res.status(403).json({ success: false, error: 'You can only delete your own proposals' });
      }
      await sql`DELETE FROM proposals WHERE id = ${id}`;
      return res.status(200).json({ success: true, id });
    }

    // ── Template library ───────────────────────────────────────────────────
    if (action === 'list-templates') {
      const rows = await sql`
        SELECT id, name, blocks, is_default, created_by, updated_at
        FROM proposal_templates
        ORDER BY is_default DESC, updated_at DESC
      `;
      return res.status(200).json({
        success: true,
        templates: rows.map((row) => ({
          id: Number(row.id),
          name: row.name,
          blocks: Array.isArray(row.blocks) ? row.blocks : [],
          isDefault: !!row.is_default,
          updatedAt: row.updated_at,
        })),
      });
    }

    if (action === 'save-template') {
      const name = cleanText(body.name, 200);
      if (!name) return res.status(400).json({ success: false, error: 'Template name required' });
      const blocks = sanitizeBlocks(body.blocks);
      const id = body.id ? Number(body.id) : null;
      const makeDefault = body.isDefault === true;
      if (makeDefault) await sql`UPDATE proposal_templates SET is_default = FALSE`;
      if (id) {
        const updated = await sql`
          UPDATE proposal_templates
          SET name = ${name}, blocks = ${JSON.stringify(blocks)}::jsonb,
              is_default = CASE WHEN ${makeDefault}::boolean THEN TRUE ELSE is_default END,
              updated_at = now()
          WHERE id = ${id}
          RETURNING id
        `;
        if (!updated.length) return res.status(404).json({ success: false, error: 'Template not found' });
        return res.status(200).json({ success: true, id });
      }
      const inserted = await sql`
        INSERT INTO proposal_templates (name, blocks, is_default, created_by)
        VALUES (${name}, ${JSON.stringify(blocks)}::jsonb, ${makeDefault}, ${identity.email})
        RETURNING id
      `;
      return res.status(200).json({ success: true, id: Number(inserted[0].id) });
    }

    if (action === 'delete-template') {
      const id = Number(body.id);
      if (!id) return res.status(400).json({ success: false, error: 'Template id required' });
      await sql`DELETE FROM proposal_templates WHERE id = ${id} AND is_default = FALSE`;
      return res.status(200).json({ success: true, id });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
