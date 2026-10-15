/**
 * Public proposal API — the client-facing side of Proposal Hub.
 *
 * GET  /api/proposal-public?p=TOKEN          → minimal meta for the gate screen
 * POST { action: 'send-code',   token, email }        → emails a 6-digit code to the approved address
 * POST { action: 'verify-code', token, email, code }  → returns a signed client session
 * POST { action: 'unlock', token, session }            → full proposal content
 * POST { action: 'accept', token, session, name }
 * POST { action: 'sign',   token, session, name, signatureImage }
 *
 * Content is only released to a signed session, which is only issued after the
 * approved email address proves itself with a one-time code.
 * Every step is written to proposal_events (with IP + user agent), giving the
 * same audit trail DocuSign would: viewed → accepted → signed.
 */

import crypto from 'crypto';
import { getSql, ensureProposalTables } from './db.js';
import { resolveIdentity, createProposalSession, verifyProposalSession } from './session.js';
import { tokenContext, sanitizeBlocks, variableDefaults } from '../lib/proposalBlocks.js';
import { sanitizeStyle, getCurrentStyle } from '../lib/proposalStyle.js';
import { sendProposalStageEmail, sendProposalCodeEmail } from '../lib/proposal-emails.js';
import {
  generateCode, hashCode, codeMatches, cleanCode, maskEmail, looksLikeEmail,
  CODE_TTL_MINUTES, CODE_MAX_ATTEMPTS, CODE_RESEND_SECONDS, CODES_PER_HOUR,
} from '../lib/proposalLogin.js';
import { buildContractBlocks, resolveTemplateVersion } from '../lib/proposalContract.js';
import { renderContractDoc } from '../lib/contractEngine.js';

const STAGES = ['proposal', 'contract', 'questionnaire', 'complete'];
const stagesFor = (skipOnboarding) => (skipOnboarding ? STAGES.filter((s) => s !== 'questionnaire') : STAGES);

// Signed proposals keep the style they were signed under; others follow the live style guide.
const styleFor = async (sql, row) => (row.style ? sanitizeStyle(row.style) : getCurrentStyle(sql));

function clientIp(req) {
  const fwd = String(req.headers?.['x-forwarded-for'] || '');
  return (fwd.split(',')[0] || '').trim() || req.socket?.remoteAddress || null;
}

function describeUa(ua) {
  const s = String(ua || '');
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\/|CriOS\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Unknown browser';
  const os = /iPhone|iPad|iPod/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}

// Device ID: client-reported traits plus request headers, hashed here so the client can't supply it. The IP is kept out so the ID survives a network change.
function deviceRecord(input, req) {
  const d = input && typeof input === 'object' ? input : {};
  const str = (v, n) => String(v ?? '').slice(0, n);
  const num = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  const ua = String(req.headers?.['user-agent'] || '').slice(0, 500);
  const acceptLanguage = str(req.headers?.['accept-language'], 120);
  const traits = {
    platform: str(d.platform, 60), languages: str(d.languages, 120), timezone: str(d.timezone, 60), screen: str(d.screen, 30),
    pixelRatio: num(d.pixelRatio), colorDepth: num(d.colorDepth), cores: num(d.cores), memory: num(d.memory), touch: num(d.touch),
    canvas: str(d.canvas, 64), gpu: str(d.gpu, 160),
  };
  const id = crypto.createHash('sha256').update(JSON.stringify([traits, ua, acceptLanguage])).digest('hex');
  const summary = describeUa(ua);
  return { id, device: { ...traits, userAgent: ua, acceptLanguage, summary }, label: `${summary} · ID ${id.slice(0, 12).toUpperCase()}` };
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
    skipOnboarding: !!row.skip_onboarding,
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
  const expired = { code: 401, sessionExpired: true, message: 'Please confirm your email to open this proposal' };
  if (!token) return { error: { code: 400, message: 'Missing proposal link' } };
  const rows = await sql`SELECT * FROM proposals WHERE token = ${token}`;
  if (!rows.length) return { error: { code: 404, message: 'Proposal not found' } };
  const proposal = rows[0];
  const session = verifyProposalSession(String(body.session || ''));
  const approved = String(proposal.client_email || '').trim().toLowerCase();
  if (!session || session.p !== String(proposal.id) || !approved || session.e !== approved) return { error: expired };
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

// Sample clients so any template can be previewed exactly as a client would see it.
const SAMPLE_CLIENTS = {
  northwind: {
    label: 'Northwind Engineering (website)',
    client_name: 'Alex Morgan',
    client_company: 'Northwind Engineering Ltd',
    client_email: 'alex.morgan@northwind-example.co.uk',
    deal_type: 'Hybrid',
    mrr_value: 250,
    one_off_value: 8000,
    templateName: null,
    title: null,
  },
  alhasanaat: {
    label: 'Al Hasanaat Foundation (charity marketing)',
    client_name: 'Huma Ali',
    client_company: 'Al Hasanaat Foundation',
    client_email: 'huma.ali@alhasanaat-example.org',
    deal_type: 'Retainer',
    mrr_value: 2500,
    one_off_value: 0,
    templateName: 'Charity | Marketing Only',
    title: 'Al Hasanaat Foundation: Charity Marketing Retainer',
    client_story: 'Al Hasanaat started in 2011, when Maulana Ali Anwar Qasmi saw the poverty in Bihar and decided to do something about it. Today the Foundation works across India, Uganda, Nepal and Gaza, and helped around 250,000 people in 2024.\n\nMost of what you do is Sadaqah Jariyah: water wells and hand pumps, masjids, Qur\'ans, and young people sponsored to become Hafiz. These are gifts that carry on rewarding the donor long after they give. Nearly 1,000 water projects and more than 1,000 Hafiz sponsored is a strong story, and it\'s exactly what Muslim donors look for online.',
  },
  joinhands: {
    label: 'Join Hands (Pillar startup charity)',
    client_name: 'Azhar Nawaz',
    client_company: 'Join Hands',
    client_email: 'azhar.nawaz@joinhands-example.org',
    deal_type: 'Subscription',
    mrr_value: 299,
    one_off_value: 4999,
    templateName: 'Pillar | Lite',
    title: 'Join Hands: Pillar Lite',
    client_story: 'Join Hands is a brand-new charity being set up to support underprivileged people in Pakistan, Bangladesh, the Middle East and the UK. You need a robust, engaging website and donation platform that is ready to take gifts from day one.',
  },
};

function sampleClient(key) {
  const picked = SAMPLE_CLIENTS[key] ? key : 'northwind';
  return { key: picked, ...SAMPLE_CLIENTS[picked], expires_at: new Date(Date.now() + 14 * 86400000).toISOString() };
}

const sampleClientList = () => Object.entries(SAMPLE_CLIENTS).map(([key, c]) => ({ key, label: c.label }));

function sampleSelection(blocks) {
  const options = {};
  const parts = [];
  (blocks || []).forEach((b, i) => {
    if (b.type !== 'options' || !b.selectable) return;
    const side = b.recommended || 'b';
    const o = b.data?.[side] || b.data?.b;
    options[String(i)] = b.data?.[side] ? side : 'b';
    if (o?.name) parts.push(`${o.name}${o.price ? ` (${o.price})` : ''}`);
  });
  return { options, addons: {}, summary: parts.join(' + ') };
}

async function exampleResponse(sql, identity, templateId, stage = 'proposal', clientKey = 'northwind') {
  const templates = await sql`SELECT id, name, blocks, is_default, contract_terms, skip_onboarding, variables, contract_id, contract_pin, services FROM proposal_templates ORDER BY is_default DESC, id ASC`;
  if (!templates.length) return null;
  const wanted = templates.find((tpl) => String(tpl.id) === String(templateId));
  const matched = !SAMPLE_CLIENTS[clientKey] && wanted && Object.keys(SAMPLE_CLIENTS).find((k) => SAMPLE_CLIENTS[k].templateName === wanted.name);
  const sample = { ...sampleClient(matched || clientKey), owner_name: identity?.name || identity?.email || 'i3MEDIA' };
  const picked = templates.find((tpl) => String(tpl.id) === String(templateId))
    || (sample.templateName && templates.find((tpl) => tpl.name === sample.templateName))
    || templates[0];
  const repName = sample.owner_name;
  sample.variables = variableDefaults(picked.variables);
  const skipOnboarding = !!picked.skip_onboarding;
  if (skipOnboarding && stage === 'questionnaire') stage = 'complete';
  const rep = await repProfile(sql, identity?.ghlOwnerId, identity?.email);
  const blocks = sanitizeBlocks(picked.blocks, tokenContext(sample));
  const selection = sampleSelection(blocks);
  const accepted = stage !== 'proposal';
  const proposal = {
    title: sample.title && picked.name === sample.templateName ? sample.title : `${sample.client_company}: ${picked.name}`,
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
    skipOnboarding,
  };
  let questions = null;
  if (['contract', 'questionnaire', 'complete'].includes(stage)) {
    const intro = { type: 'contractIntro', data: { title: proposal.title, client: sample.client_company, ref: 'PROP-EXAMPLE', date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) } };
    const tokens = { ...tokenContext(sample), proposal_title: proposal.title, proposal_ref: 'PROP-EXAMPLE', selection_summary: selection.summary };
    const version = await resolveTemplateVersion(sql, picked.contract_id, picked.contract_pin);
    if (version) {
      const services = Array.isArray(picked.services) ? picked.services : [];
      proposal.contractBlocks = [intro, ...renderContractDoc(version.doc, { services, variables: sample.variables, selection: selection.summary, tokens }).blocks];
    } else {
      const termsRow = await sql`SELECT blocks FROM proposal_contract_terms WHERE id = 1`;
      const terms = Array.isArray(picked.contract_terms) && picked.contract_terms.length
        ? picked.contract_terms
        : (Array.isArray(termsRow[0]?.blocks) ? termsRow[0].blocks : []);
      proposal.contractBlocks = [intro, ...sanitizeBlocks(terms, tokens)];
    }
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
  if (stage === 'complete' && !skipOnboarding) proposal.questionnaireCompletedAt = new Date(Date.now() - 3600000).toISOString();
  return {
    success: true,
    teamPreview: !!identity,
    team: !!identity,
    example: true,
    stage,
    stages: stagesFor(skipOnboarding),
    clients: sampleClientList(),
    activeClient: sample.key,
    activeTemplateId: Number(picked.id),
    style: await getCurrentStyle(sql),
    templates: templates.map((tpl) => ({ id: Number(tpl.id), name: tpl.name, isDefault: !!tpl.is_default })),
    proposal,
    questions,
    rep: rep || { name: repName, email: identity?.email || null, avatar: null, avatarColor: null },
  };
}

// Full-flow handover sample for the studio page demo link.
async function exampleHandover(sql, identity, clientKey = 'northwind') {
  const sample = sampleClient(clientKey);
  const tplRows = sample.templateName
    ? await sql`SELECT name, blocks, skip_onboarding, variables FROM proposal_templates WHERE name = ${sample.templateName} LIMIT 1`
    : await sql`SELECT name, blocks, skip_onboarding, variables FROM proposal_templates ORDER BY is_default DESC, id ASC LIMIT 1`;
  const skipOnboarding = !!tplRows[0]?.skip_onboarding;
  sample.variables = variableDefaults(tplRows[0]?.variables);
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
      title: sample.title || `${sample.client_company}: Website proposal`,
      reference: 'PROP-EXAMPLE',
      clientName: sample.client_name,
      clientCompany: sample.client_company,
      clientEmail: sample.client_email,
      repName: rep?.name || 'i3MEDIA',
      repEmail: rep?.email || null,
      createdAt: new Date(Date.now() - 172800000).toISOString(),
      proposalSignedAt: new Date(Date.now() - 129600000).toISOString(),
      contractSignedAt: new Date(Date.now() - 86400000).toISOString(),
      questionnaireCompletedAt: skipOnboarding ? null : new Date(Date.now() - 43200000).toISOString(),
      skipOnboarding,
      stage: 'complete',
      scope: handoverBlocks(blocks, selection),
      qa: skipOnboarding ? [] : questions.map((q) => ({ q: q.q, a: q.type === 'yesno' ? 'Yes' : 'Answered by the client during onboarding.' })),
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
    blocks: Array.isArray(proposal.blocks) ? proposal.blocks : [],
    contractSignedAt: proposal.contract_signed_at,
    contractSignedByName: proposal.contract_signed_by_name,
    contractSignatureImage: proposal.contract_signature_image || null,
    contractSignerIp: proposal.contract_signer_ip || null,
    contractHash: proposal.contract_signed_hash ? proposal.contract_signed_hash.slice(0, 16).toUpperCase() : null,
    contractSignerDeviceId: proposal.contract_signer_fingerprint ? proposal.contract_signer_fingerprint.slice(0, 12).toUpperCase() : null,
    contractSignerDevice: proposal.contract_signer_device?.summary || null,
    questionnaireCompletedAt: proposal.questionnaire_completed_at,
    skipOnboarding: !!proposal.skip_onboarding,
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

// A proposal row dressed up as if it had reached a later stage, for team previews only.
async function previewRow(sql, row, stage) {
  const blocks = Array.isArray(row.blocks) ? row.blocks : [];
  const selection = row.selection || sampleSelection(blocks);
  const contractBlocks = Array.isArray(row.contract_blocks) && row.contract_blocks.length
    ? row.contract_blocks
    : await buildContractBlocks(sql, row, selection.summary);
  const now = new Date().toISOString();
  const signed = stage === 'questionnaire' || stage === 'complete';
  return {
    ...row,
    selection,
    contract_blocks: contractBlocks,
    signed_at: row.signed_at || now,
    contract_signed_at: signed ? (row.contract_signed_at || now) : null,
    contract_signed_by_name: signed ? (row.contract_signed_by_name || row.client_name) : null,
    questionnaire_completed_at: stage === 'complete' && !row.skip_onboarding ? (row.questionnaire_completed_at || now) : row.questionnaire_completed_at,
  };
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
      skipOnboarding: !!p.skip_onboarding,
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
          return res.status(200).json(await exampleHandover(sql, staff, String(req.query?.client || '')));
        }
        const stage = ['proposal', 'contract', 'questionnaire', 'complete'].includes(req.query?.stage) ? req.query.stage : 'proposal';
        const example = await exampleResponse(sql, staff, req.query?.tpl, stage, String(req.query?.client || ''));
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
        const realStage = row.stage || 'proposal';
        const asked = STAGES.includes(req.query?.stage) ? req.query.stage : realStage;
        const stage = row.skip_onboarding && asked === 'questionnaire' ? 'complete' : asked;
        const stages = stagesFor(row.skip_onboarding);
        if (stage !== 'proposal') {
          const source = stage === realStage ? row : await previewRow(sql, row, stage);
          const payload = await stagePayload(sql, source, stage, req, true);
          const comments = await listComments(sql, row.id);
          return res.status(200).json({ ...payload, teamPreview: true, stages, comments });
        }
        const rep = await repProfile(sql, row.owner_id);
        const comments = await listComments(sql, row.id);
        return res.status(200).json({
          success: true,
          teamPreview: true,
          stage: 'proposal',
          stages,
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

    // ── Send code: emails a one-time code, but only to the approved address ──────────
    if (action === 'send-code') {
      const token = String(body.token || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      if (!looksLikeEmail(email)) return res.status(400).json({ success: false, error: 'Enter a valid email address' });
      const rows = token ? await sql`SELECT * FROM proposals WHERE token = ${token}` : [];
      if (!rows.length) return res.status(404).json({ success: false, error: 'This proposal link is invalid or has been removed' });
      const proposal = rows[0];
      const reply = { success: true, sentTo: maskEmail(email), resendIn: CODE_RESEND_SECONDS, expiresIn: CODE_TTL_MINUTES * 60 };

      // The reply is identical for a wrong address, so this can't be used to discover who a proposal is for.
      if (String(proposal.client_email || '').trim().toLowerCase() !== email) {
        await logEvent(sql, proposal.id, 'code_rejected', req, email.slice(0, 200));
        return res.status(200).json(reply);
      }

      const recent = await sql`SELECT created_at FROM proposal_login_codes WHERE proposal_id = ${proposal.id} AND created_at > now() - interval '1 hour' ORDER BY created_at DESC`;
      const wait = recent[0] ? CODE_RESEND_SECONDS - Math.floor((Date.now() - new Date(recent[0].created_at).getTime()) / 1000) : 0;
      // A code went out moments ago (a double tap or reload): keep it valid instead of replacing it.
      if (wait > 0) return res.status(200).json({ ...reply, resendIn: wait });
      if (recent.length >= CODES_PER_HOUR) return res.status(429).json({ success: false, error: 'Too many codes requested. Please try again in a little while', retryAfter: 600 });

      const code = generateCode();
      await sql`UPDATE proposal_login_codes SET used_at = now() WHERE proposal_id = ${proposal.id} AND used_at IS NULL`;
      const inserted = await sql`
        INSERT INTO proposal_login_codes (proposal_id, email, code_hash, expires_at)
        VALUES (${proposal.id}, ${email}, ${hashCode(proposal.id, code)}, now() + ${`${CODE_TTL_MINUTES} minutes`}::interval)
        RETURNING id
      `;
      const rep = await repProfile(sql, proposal.owner_id);
      let delivery;
      try {
        delivery = await sendProposalCodeEmail({ to: proposal.client_email, toName: proposal.client_name, code, title: proposal.title, repEmail: rep?.email || '', link: `https://${req.headers?.host || 'ghl-pillar.vercel.app'}/proposal?p=${proposal.token}`, minutes: CODE_TTL_MINUTES });
      } catch { delivery = { sent: false, reason: 'failed' }; }
      if (!delivery.sent) {
        // Without a mail provider (local development only) the code is handed back so the flow can still be tried.
        if (!process.env.VERCEL && process.env.NODE_ENV !== 'production' && delivery.reason === 'not configured') return res.status(200).json({ ...reply, devCode: code });
        await sql`UPDATE proposal_login_codes SET used_at = now() WHERE id = ${inserted[0].id}`;
        await logEvent(sql, proposal.id, 'email_failed', req, null, { kind: 'login_code' });
        return res.status(502).json({ success: false, error: 'We could not send your code just now. Please try again, or ask your i3MEDIA contact for help' });
      }
      await logEvent(sql, proposal.id, 'code_sent', req, email.slice(0, 200));
      return res.status(200).json(reply);
    }

    // ── Verify code: the only way to get a session ──────────────────────────────────
    if (action === 'verify-code') {
      const token = String(body.token || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const code = cleanCode(body.code);
      const rows = token ? await sql`SELECT * FROM proposals WHERE token = ${token}` : [];
      if (!rows.length) return res.status(404).json({ success: false, error: 'This proposal link is invalid or has been removed' });
      const proposal = rows[0];
      if (code.length !== 6) return res.status(400).json({ success: false, error: 'Enter all 6 digits' });

      const found = await sql`
        SELECT id, code_hash, attempts FROM proposal_login_codes
        WHERE proposal_id = ${proposal.id} AND email = ${email} AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1
      `;
      if (!found.length) return res.status(400).json({ success: false, expired: true, error: 'That code has expired. Ask for a new one' });
      const row = found[0];
      if (row.attempts >= CODE_MAX_ATTEMPTS) {
        await sql`UPDATE proposal_login_codes SET used_at = now() WHERE id = ${row.id}`;
        return res.status(429).json({ success: false, expired: true, error: 'Too many wrong tries. Ask for a new code' });
      }
      if (!codeMatches(proposal.id, code, row.code_hash)) {
        const left = CODE_MAX_ATTEMPTS - (row.attempts + 1);
        await sql`UPDATE proposal_login_codes SET attempts = attempts + 1, used_at = CASE WHEN attempts + 1 >= ${CODE_MAX_ATTEMPTS} THEN now() ELSE used_at END WHERE id = ${row.id}`;
        await logEvent(sql, proposal.id, 'code_failed', req, email.slice(0, 200));
        return res.status(400).json({ success: false, expired: left <= 0, error: left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left` : 'Too many wrong tries. Ask for a new code' });
      }
      await sql`UPDATE proposal_login_codes SET used_at = now() WHERE id = ${row.id}`;
      await logEvent(sql, proposal.id, 'code_verified', req, email.slice(0, 200));
      return res.status(200).json({ success: true, session: createProposalSession({ proposalId: proposal.id, email }), email });
    }

    // ── Unlock: needs a signed session, releases content, logs the view ─────────
    if (action === 'unlock') {
      const { proposal, error } = await loadAuthedProposal(sql, body);
      if (error) {
        return res.status(error.code).json({ success: false, error: error.message, sessionExpired: !!error.sessionExpired });
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
      if (error) return res.status(error.code).json({ success: false, error: error.message, sessionExpired: !!error.sessionExpired });
      if (proposal.signed_at) return res.status(400).json({ success: false, error: 'Already signed' });
      if ((proposal.stage || 'proposal') !== 'proposal') {
        return res.status(400).json({ success: false, error: 'The proposal is already accepted' });
      }
      if (isExpired(proposal)) return res.status(410).json({ success: false, error: 'This proposal has expired' });

      // Rule: every selectable options block marked required must have a choice.
      const blocksArr = Array.isArray(proposal.blocks) ? proposal.blocks : [];
      const sel = body.selection && typeof body.selection === 'object' ? body.selection : null;
      const missingChoice = blocksArr.some((b, i) => b.type === 'options' && b.selectable === true && b.required !== false
        && !['a', 'b', 'c'].includes(sel?.options?.[String(i)]));
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
        // Accepting takes the client straight to the contract: generate it now.
        const selSummary = (cleanSel ? JSON.parse(cleanSel).summary : '') || proposal.selection?.summary || 'the selected option in the proposal';
        const contractBlocks = await buildContractBlocks(sql, proposal, selSummary);
        await sql`
          UPDATE proposals
          SET accepted_at = now(), accepted_by_name = ${name},
              selection = COALESCE(${cleanSel}::jsonb, selection),
              status = 'accepted', stage = 'contract',
              contract_blocks = ${JSON.stringify(contractBlocks)}::jsonb, contract_sent_at = now(),
              updated_at = now()
          WHERE id = ${proposal.id}
        `;
        await logEvent(sql, proposal.id, 'accepted', req, name);
        await logEvent(sql, proposal.id, 'contract_sent', req, name);
        try {
          const rep = await repProfile(sql, proposal.owner_id);
          await sendProposalStageEmail({
            type: 'contract_ready',
            to: proposal.client_email,
            toName: name,
            repName: proposal.owner_name,
            repEmail: rep?.email || '',
            title: proposal.title,
            link: `https://${req.headers?.host || 'ghl-pillar.vercel.app'}/proposal?p=${proposal.token}`,
            selection: selSummary,
          });
        } catch { await logEvent(sql, proposal.id, 'email_failed', req, null, { kind: 'contract_ready' }); }
      }
      return res.status(200).json({ success: true, acceptedAt: new Date().toISOString(), stage: 'contract' });
    }

    // ── Sign: typed name + drawn signature + consent, full audit stamp ──────
    if (action === 'sign') {
      const { proposal, error } = await loadAuthedProposal(sql, body);
      if (error) return res.status(error.code).json({ success: false, error: error.message, sessionExpired: !!error.sessionExpired });
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
        && !['a', 'b', 'c'].includes(sel?.options?.[String(i)]));
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
      const dev = deviceRecord(body.device, req);
      await sql`
        UPDATE proposals
        SET accepted_at = COALESCE(accepted_at, now()),
            accepted_by_name = COALESCE(accepted_by_name, ${name}),
            signed_at = now(),
            signed_by_name = ${name},
            signature_image = ${signature},
            signer_ip = ${ip},
            signer_user_agent = ${ua},
            signer_device = ${JSON.stringify(dev.device)}::jsonb,
            signer_fingerprint = ${dev.id},
            style = COALESCE(style, ${frozenStyle}::jsonb),
            selection = COALESCE(${cleanSel}::jsonb, selection),
            status = 'signed',
            updated_at = now()
        WHERE id = ${proposal.id}
      `;
      if (!proposal.accepted_at) await logEvent(sql, proposal.id, 'accepted', req, name);
      await logEvent(sql, proposal.id, 'signed', req, name, cleanSel ? { selection: JSON.parse(cleanSel).summary, device: dev.label } : { device: dev.label });

      return res.status(200).json({
        success: true,
        signedAt: new Date().toISOString(),
        signedByName: name,
        signerIp: ip,
        deviceId: dev.id.slice(0, 12).toUpperCase(),
      });
    }

    // ── Comment: client remarks anchored to a content block ────────────────
    if (action === 'comment') {
      const { proposal, error } = await loadAuthedProposal(sql, body);
      if (error) return res.status(error.code).json({ success: false, error: error.message, sessionExpired: !!error.sessionExpired });
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
      if (error) return res.status(error.code).json({ success: false, error: error.message, sessionExpired: !!error.sessionExpired });
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
      const dev = deviceRecord(body.device, req);
      await sql`
        UPDATE proposals
        SET contract_signed_at = now(),
            contract_signed_by_name = ${name},
            contract_signature_image = ${signature},
            contract_signer_ip = ${ip},
            contract_signer_user_agent = ${ua},
            contract_signer_device = ${JSON.stringify(dev.device)}::jsonb,
            contract_signer_fingerprint = ${dev.id},
            contract_signed_hash = ${crypto.createHash('sha256').update(JSON.stringify(proposal.contract_blocks || [])).digest('hex')},
            stage = ${proposal.skip_onboarding ? 'complete' : 'questionnaire'},
            updated_at = now()
        WHERE id = ${proposal.id}
      `;
      await logEvent(sql, proposal.id, 'contract_signed', req, name, { device: dev.label });
      const rep = await repProfile(sql, proposal.owner_id);
      try {
        await sendProposalStageEmail({
          type: proposal.skip_onboarding ? 'contract_signed_final' : 'contract_signed',
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
        deviceId: dev.id.slice(0, 12).toUpperCase(),
      });
    }

    // ── Update selection: allowed until the contract is signed ─────────────
    if (action === 'update-selection') {
      const { proposal, error } = await loadAuthedProposal(sql, body);
      if (error) return res.status(error.code).json({ success: false, error: error.message, sessionExpired: !!error.sessionExpired });
      if ((proposal.stage || 'proposal') !== 'contract') {
        return res.status(400).json({ success: false, error: 'Selections can only change at the contract stage' });
      }
      if (proposal.contract_signed_at) {
        return res.status(400).json({ success: false, error: 'The contract is signed, so the selection is locked' });
      }
      const blocksArr = Array.isArray(proposal.blocks) ? proposal.blocks : [];
      const sel = body.selection && typeof body.selection === 'object' ? body.selection : null;
      const missingChoice = blocksArr.some((b, i) => b.type === 'options' && b.selectable === true && b.required !== false
        && !['a', 'b', 'c'].includes(sel?.options?.[String(i)]));
      if (missingChoice) {
        return res.status(400).json({ success: false, error: 'Choose your option before continuing' });
      }
      const cleanSel = JSON.stringify({
        options: sel?.options && typeof sel.options === 'object' ? sel.options : {},
        addons: sel?.addons && typeof sel.addons === 'object' ? sel.addons : {},
        summary: String(sel?.summary || '').slice(0, 600),
      });
      await sql`UPDATE proposals SET selection = ${cleanSel}::jsonb, updated_at = now() WHERE id = ${proposal.id}`;
      await logEvent(sql, proposal.id, 'selection_updated', req, proposal.client_name || proposal.client_email, { summary: sel?.summary || '' });
      return res.status(200).json({ success: true });
    }

    // ── Onboarding questionnaire: last step before the studio handover ──────
    if (action === 'answer-questionnaire') {
      const { proposal, error } = await loadAuthedProposal(sql, body);
      if (error) return res.status(error.code).json({ success: false, error: error.message, sessionExpired: !!error.sessionExpired });
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
