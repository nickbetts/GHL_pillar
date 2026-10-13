/**
 * Public proposal API — the client-facing side of Proposal Hub.
 *
 * GET  /api/proposal-public?p=TOKEN          → minimal meta for the gate screen
 * POST { action: 'unlock', token, email, password }  → full proposal content
 * POST { action: 'accept', token, email, password, name }
 * POST { action: 'sign',   token, email, password, name, signatureImage }
 *
 * Content is only released after the approved email + password check passes.
 * Every step is written to proposal_events (with IP + user agent), giving the
 * same audit trail DocuSign would: viewed → accepted → signed.
 */

import { getSql, ensureProposalTables } from './db.js';
import { verifyPassword, resolveIdentity } from './session.js';
import { tokenContext, sanitizeBlocks } from '../lib/proposalBlocks.js';
import { sanitizeStyle, getCurrentStyle } from '../lib/proposalStyle.js';
import { sendProposalStageEmail } from '../lib/proposal-emails.js';

// Signed proposals keep the style they were signed under; others follow the live style guide.
const styleFor = async (sql, row) => (row.style ? sanitizeStyle(row.style) : getCurrentStyle(sql));

function clientIp(req) {
  const fwd = String(req.headers?.['x-forwarded-for'] || '');
  return (fwd.split(',')[0] || '').trim() || req.socket?.remoteAddress || null;
}

function isExpired(row) {
  return row.expires_at && new Date(row.expires_at) < new Date()
    && row.status !== 'signed' && row.status !== 'accepted';
}

function publicMeta(row) {
  return {
    title: row.title,
    status: isExpired(row) ? 'expired' : row.status,
    stage: row.stage || 'proposal',
    repName: row.owner_name || 'i3MEDIA',
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    signedAt: row.signed_at,
    signedByName: row.signed_by_name,
    contractSignedAt: row.contract_signed_at,
    questionnaireCompletedAt: row.questionnaire_completed_at,
  };
}

async function loadAuthedProposal(sql, body) {
  const token = String(body.token || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!token || !email) return { error: { code: 400, message: 'Email and password are required' } };
  const rows = await sql`SELECT * FROM proposals WHERE token = ${token}`;
  if (!rows.length) return { error: { code: 404, message: 'Proposal not found' } };
  const proposal = rows[0];
  if (String(proposal.client_email || '').trim().toLowerCase() !== email) {
    return { error: { code: 403, message: 'That email is not approved for this proposal', proposal } };
  }
  if (proposal.access_password_hash) {
    const ok = verifyPassword(password, proposal.access_password_hash, proposal.access_password_salt);
    if (!ok) return { error: { code: 403, message: 'Incorrect password', proposal } };
  }
  return { proposal };
}

async function logEvent(sql, proposalId, eventType, req, actorName = null, meta = null) {
  await sql`
    INSERT INTO proposal_events (proposal_id, event_type, actor_name, ip, user_agent, meta)
    VALUES (
      ${proposalId}, ${eventType}, ${actorName},
      ${clientIp(req)}, ${String(req.headers?.['user-agent'] || '').slice(0, 500) || null},
      ${meta ? JSON.stringify(meta) : null}::jsonb
    )
  `;
}

async function repProfile(sql, ownerId, email = '') {
  const id = String(ownerId || '');
  const mail = String(email || '');
  if (!id && !mail) return null;
  const rows = await sql`
    SELECT name, email, avatar, avatar_color
    FROM app_users
    WHERE (${id}::text <> '' AND ghl_owner_id = ${id})
       OR (${mail}::text <> '' AND LOWER(email) = LOWER(${mail}))
    ORDER BY (ghl_owner_id = ${id}) DESC NULLS LAST
    LIMIT 1
  `;
  if (!rows.length) return null;
  return {
    name: rows[0].name,
    email: rows[0].email,
    avatar: rows[0].avatar || null,
    avatarColor: rows[0].avatar_color || null,
  };
}

// Sample client so any template can be previewed exactly as a client would see it.
// Open to everyone (no auth) so it can be shared as a demo link.
function sampleClient() {
  return {
    client_name: 'Alex Morgan',
    client_company: 'Northwind Engineering Ltd',
    client_email: 'alex.morgan@northwind-example.co.uk',
    deal_type: 'Hybrid',
    mrr_value: 250,
    one_off_value: 8000,
    expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
  };
}

function sampleSelection(blocks) {
  const options = {};
  (blocks || []).forEach((b, i) => { if (b.type === 'options' && b.selectable) options[String(i)] = 'b'; });
  return { options, addons: {}, summary: 'Brand Uplift (£12,000) + Support retainer: 5 hours / month (£550 / mo)' };
}

async function exampleResponse(sql, identity, templateId, stage = 'proposal') {
  const templates = await sql`SELECT id, name, blocks, is_default FROM proposal_templates ORDER BY is_default DESC, id ASC`;
  if (!templates.length) return null;
  const picked = templates.find((tpl) => String(tpl.id) === String(templateId)) || templates[0];
  const repName = identity?.name || identity?.email || 'i3MEDIA';
  const sample = { ...sampleClient(), owner_name: repName };
  const rep = await repProfile(sql, identity?.ghlOwnerId, identity?.email);
  const blocks = sanitizeBlocks(picked.blocks, tokenContext(sample));
  const selection = sampleSelection(blocks);
  const accepted = stage !== 'proposal';
  const proposal = {
    title: `${sample.client_company}: ${picked.name}`,
    status: accepted ? 'accepted' : 'viewed',
    repName,
    expiresAt: sample.expires_at,
    clientName: sample.client_name,
    clientCompany: sample.client_company,
    clientEmail: sample.client_email,
    dealType: sample.deal_type,
    mrrValue: sample.mrr_value,
    oneOffValue: sample.one_off_value,
    blocks,
    createdAt: new Date().toISOString(),
    reference: 'PROP-EXAMPLE',
    acceptedAt: accepted ? new Date(Date.now() - 86400000).toISOString() : null,
    acceptedByName: accepted ? sample.client_name : null,
    selection: accepted ? selection : null,
  };
  let questions = null;
  if (['contract', 'questionnaire', 'complete'].includes(stage)) {
    const termsRow = await sql`SELECT blocks FROM proposal_contract_terms WHERE id = 1`;
    const terms = Array.isArray(termsRow[0]?.blocks) ? termsRow[0].blocks : [];
    proposal.contractBlocks = [
      { type: 'heading', text: `Contract: ${proposal.title}` },
      { type: 'text', text: `Between i3MEDIA Ltd and ${sample.client_company}.\n\nProposal: ${proposal.title} (PROP-EXAMPLE)\nSelected work: ${selection.summary}\n\nThe small print below applies to this engagement.` },
      ...sanitizeBlocks(terms, { ...tokenContext(sample), proposal_title: proposal.title, proposal_ref: 'PROP-EXAMPLE', selection_summary: selection.summary }),
    ];
    proposal.contractSentAt = new Date(Date.now() - 43200000).toISOString();
  }
  if (['questionnaire', 'complete'].includes(stage)) {
    proposal.contractSignedAt = new Date(Date.now() - 21600000).toISOString();
    proposal.contractSignedByName = sample.client_name;
    if (stage === 'questionnaire') {
      const qRow = await sql`SELECT questions FROM proposal_questionnaire WHERE id = 1`;
      questions = Array.isArray(qRow[0]?.questions) ? qRow[0].questions : [];
    }
  }
  if (stage === 'complete') proposal.questionnaireCompletedAt = new Date(Date.now() - 3600000).toISOString();
  return {
    success: true,
    teamPreview: !!identity,
    team: !!identity,
    example: true,
    stage,
    stages: ['proposal', 'contract', 'questionnaire', 'complete'],
    activeTemplateId: Number(picked.id),
    style: await getCurrentStyle(sql),
    templates: templates.map((tpl) => ({ id: Number(tpl.id), name: tpl.name, isDefault: !!tpl.is_default })),
    proposal,
    questions,
    rep: rep || { name: repName, email: identity?.email || null, avatar: null, avatarColor: null },
  };
}

// Full-flow handover sample for the studio page demo link.
async function exampleHandover(sql, identity) {
  const tplRows = await sql`SELECT blocks FROM proposal_templates ORDER BY is_default DESC, id ASC LIMIT 1`;
  const sample = sampleClient();
  const blocks = sanitizeBlocks(Array.isArray(tplRows[0]?.blocks) ? tplRows[0].blocks : [], tokenContext(sample));
  const selection = sampleSelection(blocks);
  const qRow = await sql`SELECT questions FROM proposal_questionnaire WHERE id = 1`;
  const questions = Array.isArray(qRow[0]?.questions) ? qRow[0].questions : [];
  const rep = await repProfile(sql, identity?.ghlOwnerId, identity?.email);
  return {
    success: true,
    ready: true,
    example: true,
    style: await getCurrentStyle(sql),
    proposal: {
      title: `${sample.client_company}: Website proposal`,
      reference: 'PROP-EXAMPLE',
      clientName: sample.client_name,
      clientCompany: sample.client_company,
      clientEmail: sample.client_email,
      repName: rep?.name || 'i3MEDIA',
      repEmail: rep?.email || null,
      createdAt: new Date(Date.now() - 172800000).toISOString(),
      proposalSignedAt: new Date(Date.now() - 129600000).toISOString(),
      contractSignedAt: new Date(Date.now() - 86400000).toISOString(),
      questionnaireCompletedAt: new Date(Date.now() - 43200000).toISOString(),
      stage: 'complete',
      scope: handoverBlocks(blocks, selection),
      qa: questions.map((q) => ({ q: q.q, a: q.type === 'yesno' ? 'Yes' : 'Answered by the client during onboarding.' })),
    },
  };
}

async function listComments(sql, proposalId) {
  const rows = await sql`
    SELECT id, block_index, author_name, body, created_at
    FROM proposal_comments
    WHERE proposal_id = ${proposalId}
    ORDER BY created_at ASC
    LIMIT 500
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    blockIndex: Number(row.block_index),
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at,
  }));
}

// Content for contract/questionnaire/complete stages on the same client link.
// silent=true skips view tracking (team previews never touch client metrics).
async function stagePayload(sql, proposal, stage, req, silent = false) {
  const rep = await repProfile(sql, proposal.owner_id);
  const base = {
    title: proposal.title,
    status: 'signed',
    repName: proposal.owner_name || 'i3MEDIA',
    expiresAt: proposal.expires_at,
    clientName: proposal.client_name,
    clientCompany: proposal.client_company,
    clientEmail: proposal.client_email,
    createdAt: proposal.created_at,
    reference: `PROP-${proposal.id}`,
    signedAt: proposal.signed_at,
    signedByName: proposal.signed_by_name,
    contractSignedAt: proposal.contract_signed_at,
    contractSignedByName: proposal.contract_signed_by_name,
    questionnaireCompletedAt: proposal.questionnaire_completed_at,
  };
  const style = await styleFor(sql, proposal);
  if (stage === 'contract') {
    if (!silent) {
      const firstContractView = !proposal.contract_viewed_at;
      await sql`UPDATE proposals SET contract_viewed_at = COALESCE(contract_viewed_at, now()), updated_at = now() WHERE id = ${proposal.id}`;
      if (firstContractView) await logEvent(sql, proposal.id, 'contract_viewed', req);
    }
    return {
      success: true,
      stage,
      style,
      proposal: { ...base, selection: proposal.selection || null, contractBlocks: Array.isArray(proposal.contract_blocks) ? proposal.contract_blocks : [] },
      rep,
    };
  }
  if (stage === 'questionnaire') {
    const qRows = await sql`SELECT questions FROM proposal_questionnaire WHERE id = 1`;
    return { success: true, stage, style, proposal: base, questions: Array.isArray(qRows[0]?.questions) ? qRows[0].questions : [], rep };
  }
  return { success: true, stage, style, proposal: base, rep };
}

// Studio handover never includes prices, contract terms or signatures.
function handoverBlocks(blocks, selection) {
  const out = [];
  (blocks || []).forEach((b, i) => {
    if (b.type === 'investment') return;
    if (b.type === 'options') {
      const pick = selection?.options?.[String(i)];
      const chosen = pick ? b.data?.[pick] : null;
      if (chosen?.name) out.push({ type: 'text', text: `Chosen option: ${chosen.name}${chosen.desc ? `. ${chosen.desc}` : ''}` });
      return;
    }
    if (b.type === 'addons') {
      const chosen = new Set(selection?.addons?.[String(i)] || []);
      const names = String(b.text || '').split('\n').map((l) => l.trim()).filter(Boolean)
        .map((l, li) => ({ locked: l.startsWith('!'), name: l.split('|')[0].replace(/^!/, '').trim(), li }))
        .filter((it) => it.locked || chosen.has(it.li))
        .map((it) => it.name);
      if (names.length) out.push({ type: 'bullets', text: names.join('\n') });
      return;
    }
    if (b.type === 'comparison') {
      const kept = String(b.text || '').split('\n').filter((l) => !l.includes('£'));
      if (kept.length > 1) out.push({ type: 'comparison', text: kept.join('\n') });
      return;
    }
    if (typeof b.text === 'string' && b.text.includes('£')) return;
    out.push({ type: b.type, text: b.text });
  });
  return out;
}

async function handoverPayload(sql, p) {
  const rep = await repProfile(sql, p.owner_id);
  const ready = (p.stage || 'proposal') === 'complete';
  return {
    success: true,
    ready,
    style: await styleFor(sql, p),
    proposal: {
      title: p.title,
      reference: `PROP-${p.id}`,
      clientName: p.client_name,
      clientCompany: p.client_company,
      clientEmail: p.client_email,
      repName: p.owner_name,
      repEmail: rep?.email || null,
      createdAt: p.created_at,
      proposalSignedAt: p.signed_at,
      contractSignedAt: p.contract_signed_at,
      questionnaireCompletedAt: p.questionnaire_completed_at,
      stage: p.stage || 'proposal',
      scope: handoverBlocks(Array.isArray(p.blocks) ? p.blocks : [], p.selection),
      qa: ready && Array.isArray(p.questionnaire_answers) ? p.questionnaire_answers : [],
    },
  };
}

export default async function handler(req, res) {
  let sql;
  try {
    sql = getSql();
    await ensureProposalTables(sql);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  try {
    // ── Gate screen meta (no sensitive content) ────────────────────────────
    if (req.method === 'GET') {
      if (req.query?.example) {
        const staff = resolveIdentity(req);
        if (req.query.example === 'handover') {
          return res.status(200).json(await exampleHandover(sql, staff));
        }
        const stage = ['proposal', 'contract', 'questionnaire', 'complete'].includes(req.query?.stage) ? req.query.stage : 'proposal';
        const example = await exampleResponse(sql, staff, req.query?.tpl, stage);
        if (!example) return res.status(404).json({ success: false, error: 'No templates yet. Create one in the template editor' });
        return res.status(200).json(example);
      }

      // Studio handover: token link, sanitized, no pricing or contract content.
      const handoverToken = String(req.query?.h || '').trim();
      if (handoverToken) {
        const rows = await sql`SELECT * FROM proposals WHERE handover_token = ${handoverToken}`;
        if (!rows.length) return res.status(404).json({ success: false, error: 'Handover not found' });
        return res.status(200).json(await handoverPayload(sql, rows[0]));
      }

      const token = String(req.query?.p || '').trim();
      if (!token) return res.status(400).json({ success: false, error: 'Missing proposal link' });
      const rows = await sql`SELECT * FROM proposals WHERE token = ${token}`;
      if (!rows.length) return res.status(404).json({ success: false, error: 'This proposal link is invalid or has been removed' });
      const row = rows[0];

      // Signed-in team members get the full layout instantly as a preview —
      // no gate, and the client's view tracking stays untouched.
      const identity = resolveIdentity(req);
      if (identity) {
        if ((row.stage || 'proposal') !== 'proposal') {
          const payload = await stagePayload(sql, row, row.stage, req, true);
          const comments = await listComments(sql, row.id);
          return res.status(200).json({ ...payload, teamPreview: true, comments });
        }
        const rep = await repProfile(sql, row.owner_id);
        const comments = await listComments(sql, row.id);
        return res.status(200).json({
          success: true,
          teamPreview: true,
          comments,
          style: await styleFor(sql, row),
          proposal: {
            ...publicMeta(row),
            clientName: row.client_name,
            clientCompany: row.client_company,
            clientEmail: row.client_email,
            dealType: row.deal_type,
            mrrValue: row.mrr_value == null ? null : Number(row.mrr_value),
            oneOffValue: row.one_off_value == null ? null : Number(row.one_off_value),
            blocks: Array.isArray(row.blocks) ? row.blocks : [],
            createdAt: row.created_at,
            reference: `PROP-${row.id}`,
          },
          rep,
        });
      }

      return res.status(200).json({ success: true, style: await styleFor(sql, row), proposal: publicMeta(row) });
    }

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
    const body = req.body || {};
    const action = String(body.action || '');

    // ── Unlock: email + password gate, releases content, logs the view ─────
    if (action === 'unlock') {
      const { proposal, error } = await loadAuthedProposal(sql, body);
      if (error) {
        if (error.proposal) {
          await logEvent(sql, error.proposal.id, 'unlock_failed', req, String(body.email || '').slice(0, 200));
        }
        return res.status(error.code).json({ success: false, error: error.message });
      }
      const stage = proposal.stage || 'proposal';
      if (stage !== 'proposal') {
        return res.status(200).json(await stagePayload(sql, proposal, stage, req));
      }
      if (isExpired(proposal)) {
        return res.status(410).json({ success: false, error: 'This proposal has expired. Ask your contact to send a fresh link' });
      }

      const firstView = !proposal.first_viewed_at;
      await sql`
        UPDATE proposals
        SET first_viewed_at = COALESCE(first_viewed_at, now()),
            last_viewed_at = now(),
            view_count = view_count + 1,
            status = CASE WHEN status = 'active' THEN 'viewed' ELSE status END,
            updated_at = now()
        WHERE id = ${proposal.id}
      `;
      await logEvent(sql, proposal.id, firstView ? 'viewed' : 'viewed_again', req);

      const rep = await repProfile(sql, proposal.owner_id);
      const comments = await listComments(sql, proposal.id);
      return res.status(200).json({
        success: true,
        comments,
        style: await styleFor(sql, proposal),
        proposal: {
          ...publicMeta({ ...proposal, status: proposal.status === 'active' ? 'viewed' : proposal.status }),
          clientName: proposal.client_name,
          clientCompany: proposal.client_company,
          clientEmail: proposal.client_email,
          dealType: proposal.deal_type,
          mrrValue: proposal.mrr_value == null ? null : Number(proposal.mrr_value),
          oneOffValue: proposal.one_off_value == null ? null : Number(proposal.one_off_value),
          blocks: Array.isArray(proposal.blocks) ? proposal.blocks : [],
          createdAt: proposal.created_at,
          reference: `PROP-${proposal.id}`,
        },
        rep,
      });
    }

    // ── Accept: records the choice + intent; the signature happens on the contract ──
    if (action === 'accept') {
      const { proposal, error } = await loadAuthedProposal(sql, body);
      if (error) return res.status(error.code).json({ success: false, error: error.message });
      if (proposal.signed_at) return res.status(400).json({ success: false, error: 'Already signed' });
      if ((proposal.stage || 'proposal') !== 'proposal') {
        return res.status(400).json({ success: false, error: 'The proposal is already accepted' });
      }
      if (isExpired(proposal)) return res.status(410).json({ success: false, error: 'This proposal has expired' });

      // Rule: every selectable options block marked required must have a choice.
      const blocksArr = Array.isArray(proposal.blocks) ? proposal.blocks : [];
      const sel = body.selection && typeof body.selection === 'object' ? body.selection : null;
      const missingChoice = blocksArr.some((b, i) => b.type === 'options' && b.selectable === true && b.required !== false
        && !['a', 'b'].includes(sel?.options?.[String(i)]));
      if (missingChoice) {
        return res.status(400).json({ success: false, error: 'Choose your option before accepting' });
      }
      const cleanSel = sel ? JSON.stringify({
        options: sel.options && typeof sel.options === 'object' ? sel.options : {},
        addons: sel.addons && typeof sel.addons === 'object' ? sel.addons : {},
        summary: String(sel.summary || '').slice(0, 600),
      }) : null;

      const name = String(body.name || '').trim().slice(0, 200) || proposal.client_name || 'Client';
      if (!proposal.accepted_at) {
        await sql`
          UPDATE proposals
          SET accepted_at = now(), accepted_by_name = ${name},
              selection = COALESCE(${cleanSel}::jsonb, selection),
              status = 'accepted', updated_at = now()
          WHERE id = ${proposal.id}
        `;
        await logEvent(sql, proposal.id, 'accepted', req, name);
      }
      return res.status(200).json({ success: true, acceptedAt: new Date().toISOString() });
    }

    // ── Sign: typed name + drawn signature + consent, full audit stamp ──────
    if (action === 'sign') {
      const { proposal, error } = await loadAuthedProposal(sql, body);
      if (error) return res.status(error.code).json({ success: false, error: error.message });
      if (proposal.signed_at) return res.status(400).json({ success: false, error: 'Already signed' });
      if (isExpired(proposal)) return res.status(410).json({ success: false, error: 'This proposal has expired' });

      const name = String(body.name || '').trim().slice(0, 200);
      if (!name) return res.status(400).json({ success: false, error: 'Please type your full name to sign' });
      if (body.consent !== true) {
        return res.status(400).json({ success: false, error: 'Please confirm you agree to sign electronically' });
      }
      let signature = String(body.signatureImage || '');
      if (!signature.startsWith('data:image/png;base64,')) {
        return res.status(400).json({ success: false, error: 'Please draw your signature' });
      }
      if (signature.length > 300_000) signature = signature.slice(0, 300_000);

      // Rule: every selectable options block marked required must have a choice.
      const blocksArr = Array.isArray(proposal.blocks) ? proposal.blocks : [];
      const sel = body.selection && typeof body.selection === 'object' ? body.selection : null;
      const missingChoice = blocksArr.some((b, i) => b.type === 'options' && b.selectable === true && b.required !== false
        && !['a', 'b'].includes(sel?.options?.[String(i)]));
      if (missingChoice) {
        return res.status(400).json({ success: false, error: 'Choose your option before signing' });
      }
      const cleanSel = sel ? JSON.stringify({
        options: sel.options && typeof sel.options === 'object' ? sel.options : {},
        addons: sel.addons && typeof sel.addons === 'object' ? sel.addons : {},
        summary: String(sel.summary || '').slice(0, 600),
      }) : null;

      const ip = clientIp(req);
      const ua = String(req.headers?.['user-agent'] || '').slice(0, 500) || null;
      const frozenStyle = JSON.stringify(await styleFor(sql, proposal));
      await sql`
        UPDATE proposals
        SET accepted_at = COALESCE(accepted_at, now()),
            accepted_by_name = COALESCE(accepted_by_name, ${name}),
            signed_at = now(),
            signed_by_name = ${name},
            signature_image = ${signature},
            signer_ip = ${ip},
            signer_user_agent = ${ua},
            style = COALESCE(style, ${frozenStyle}::jsonb),
            selection = COALESCE(${cleanSel}::jsonb, selection),
            status = 'signed',
            updated_at = now()
        WHERE id = ${proposal.id}
      `;
      if (!proposal.accepted_at) await logEvent(sql, proposal.id, 'accepted', req, name);
      await logEvent(sql, proposal.id, 'signed', req, name, cleanSel ? { selection: JSON.parse(cleanSel).summary } : null);

      return res.status(200).json({
        success: true,
        signedAt: new Date().toISOString(),
        signedByName: name,
        signerIp: ip,
      });
    }

    // ── Comment: client remarks anchored to a content block ────────────────
    if (action === 'comment') {
      const { proposal, error } = await loadAuthedProposal(sql, body);
      if (error) return res.status(error.code).json({ success: false, error: error.message });
      const text = String(body.body || '').trim().slice(0, 1000);
      if (!text) return res.status(400).json({ success: false, error: 'Comment text is required' });
      const blockIndex = Number.isInteger(Number(body.blockIndex)) ? Math.max(-1, Math.min(500, Number(body.blockIndex))) : -1;
      const author = proposal.client_name || proposal.client_email;
      const inserted = await sql`
        INSERT INTO proposal_comments (proposal_id, block_index, author_name, author_email, body)
        VALUES (${proposal.id}, ${blockIndex}, ${author}, ${proposal.client_email}, ${text})
        RETURNING id, created_at
      `;
      await logEvent(sql, proposal.id, 'commented', req, author, { blockIndex, body: text.slice(0, 300) });
      return res.status(200).json({
        success: true,
        comment: { id: Number(inserted[0].id), blockIndex, authorName: author, body: text, createdAt: inserted[0].created_at },
      });
    }

    // ── Sign contract: second signature; the deal is won right here ────────
    if (action === 'sign-contract') {
      const { proposal, error } = await loadAuthedProposal(sql, body);
      if (error) return res.status(error.code).json({ success: false, error: error.message });
      if ((proposal.stage || 'proposal') !== 'contract') {
        return res.status(400).json({ success: false, error: 'This proposal is not at the contract stage' });
      }
      if (proposal.contract_signed_at) return res.status(400).json({ success: false, error: 'Contract already signed' });

      const name = String(body.name || '').trim().slice(0, 200);
      if (!name) return res.status(400).json({ success: false, error: 'Please type your full name to sign' });
      if (body.consent !== true) {
        return res.status(400).json({ success: false, error: 'Please confirm you agree to sign electronically' });
      }
      let signature = String(body.signatureImage || '');
      if (!signature.startsWith('data:image/png;base64,')) {
        return res.status(400).json({ success: false, error: 'Please draw your signature' });
      }
      if (signature.length > 300_000) signature = signature.slice(0, 300_000);

      const ip = clientIp(req);
      const ua = String(req.headers?.['user-agent'] || '').slice(0, 500) || null;
      await sql`
        UPDATE proposals
        SET contract_signed_at = now(),
            contract_signed_by_name = ${name},
            contract_signature_image = ${signature},
            contract_signer_ip = ${ip},
            contract_signer_user_agent = ${ua},
            stage = 'questionnaire',
            updated_at = now()
        WHERE id = ${proposal.id}
      `;
      await logEvent(sql, proposal.id, 'contract_signed', req, name);
      const rep = await repProfile(sql, proposal.owner_id);
      try {
        await sendProposalStageEmail({
          type: 'contract_signed',
          to: proposal.client_email,
          toName: name,
          repName: proposal.owner_name,
          repEmail: rep?.email || '',
          title: proposal.title,
          link: `https://${req.headers?.host || 'ghl-pillar.vercel.app'}/proposal?p=${proposal.token}`,
        });
      } catch { await logEvent(sql, proposal.id, 'email_failed', req, null, { kind: 'contract_signed' }); }

      // Contract signed = the deal is won: move the opportunity and fire the frenzy.
      if (proposal.lead_id) {
        const wonRows = await sql`
          UPDATE queue_leads
          SET opportunity_stage = 'won', won_at = COALESCE(won_at, now()), updated_at = now(), last_touch_at = now()
          WHERE id = ${proposal.lead_id} AND archived_at IS NULL AND COALESCE(opportunity_stage, '') <> 'won'
          RETURNING id
        `;
        if (wonRows.length) {
          await sql`
            INSERT INTO point_frenzies (lead_id, lead_name, triggered_by_owner_id, triggered_by_name, ends_at)
            VALUES (${proposal.lead_id}, ${proposal.client_company || proposal.client_name || null}, ${proposal.owner_id || null}, ${proposal.owner_name || 'A teammate'}, now() + interval '48 hours')
          `;
          await logEvent(sql, proposal.id, 'auto_won', req, null, { leadId: proposal.lead_id });
        }
      }

      return res.status(200).json({
        success: true,
        signedAt: new Date().toISOString(),
        signedByName: name,
        signerIp: ip,
      });
    }

    // ── Onboarding questionnaire: last step before the studio handover ──────
    if (action === 'answer-questionnaire') {
      const { proposal, error } = await loadAuthedProposal(sql, body);
      if (error) return res.status(error.code).json({ success: false, error: error.message });
      if ((proposal.stage || 'proposal') !== 'questionnaire') {
        return res.status(400).json({ success: false, error: 'This proposal is not at the onboarding stage' });
      }
      if (proposal.questionnaire_completed_at) {
        return res.status(400).json({ success: false, error: 'The questionnaire is already completed' });
      }
      const qRows = await sql`SELECT questions FROM proposal_questionnaire WHERE id = 1`;
      const questions = Array.isArray(qRows[0]?.questions) ? qRows[0].questions : [];
      const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
      for (let i = 0; i < questions.length; i += 1) {
        if (questions[i].required && !String(answers[String(i)] || '').trim()) {
          return res.status(400).json({ success: false, error: `Question ${i + 1} needs an answer` });
        }
      }
      const qa = questions.map((q, i) => ({ q: String(q.q || ''), a: String(answers[String(i)] || '').trim().slice(0, 4000) }));
      await sql`
        UPDATE proposals
        SET questionnaire_answers = ${JSON.stringify(qa)}::jsonb,
            questionnaire_completed_at = now(),
            stage = 'complete',
            updated_at = now()
        WHERE id = ${proposal.id}
      `;
      await logEvent(sql, proposal.id, 'questionnaire_completed', req, proposal.client_name || proposal.client_email);
      const repQ = await repProfile(sql, proposal.owner_id);
      try {
        await sendProposalStageEmail({
          type: 'onboarding_done',
          to: proposal.client_email,
          toName: proposal.client_name,
          repName: proposal.owner_name,
          repEmail: repQ?.email || '',
          title: proposal.title,
          link: `https://${req.headers?.host || 'ghl-pillar.vercel.app'}/proposal?p=${proposal.token}`,
        });
      } catch { await logEvent(sql, proposal.id, 'email_failed', req, null, { kind: 'onboarding_done' }); }
      return res.status(200).json({ success: true, completedAt: new Date().toISOString() });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
