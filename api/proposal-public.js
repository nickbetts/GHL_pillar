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
import { verifyPassword } from './session.js';

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
    repName: row.owner_name || 'i3MEDIA',
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    signedAt: row.signed_at,
    signedByName: row.signed_by_name,
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

async function repProfile(sql, ownerId) {
  if (!ownerId) return null;
  const rows = await sql`
    SELECT name, email, avatar, avatar_color
    FROM app_users
    WHERE ghl_owner_id = ${ownerId}
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
      const token = String(req.query?.p || '').trim();
      if (!token) return res.status(400).json({ success: false, error: 'Missing proposal link' });
      const rows = await sql`SELECT * FROM proposals WHERE token = ${token}`;
      if (!rows.length) return res.status(404).json({ success: false, error: 'This proposal link is invalid or has been removed' });
      return res.status(200).json({ success: true, proposal: publicMeta(rows[0]) });
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
      if (isExpired(proposal)) {
        return res.status(410).json({ success: false, error: 'This proposal has expired — ask your contact to send a fresh link' });
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
      return res.status(200).json({
        success: true,
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

    // ── Accept: records intent, then the client signs ──────────────────────
    if (action === 'accept') {
      const { proposal, error } = await loadAuthedProposal(sql, body);
      if (error) return res.status(error.code).json({ success: false, error: error.message });
      if (proposal.signed_at) return res.status(400).json({ success: false, error: 'Already signed' });
      if (isExpired(proposal)) return res.status(410).json({ success: false, error: 'This proposal has expired' });

      const name = String(body.name || '').trim().slice(0, 200) || proposal.client_name || 'Client';
      if (!proposal.accepted_at) {
        await sql`
          UPDATE proposals
          SET accepted_at = now(), accepted_by_name = ${name}, status = 'accepted', updated_at = now()
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

      const ip = clientIp(req);
      const ua = String(req.headers?.['user-agent'] || '').slice(0, 500) || null;
      await sql`
        UPDATE proposals
        SET accepted_at = COALESCE(accepted_at, now()),
            accepted_by_name = COALESCE(accepted_by_name, ${name}),
            signed_at = now(),
            signed_by_name = ${name},
            signature_image = ${signature},
            signer_ip = ${ip},
            signer_user_agent = ${ua},
            status = 'signed',
            updated_at = now()
        WHERE id = ${proposal.id}
      `;
      if (!proposal.accepted_at) await logEvent(sql, proposal.id, 'accepted', req, name);
      await logEvent(sql, proposal.id, 'signed', req, name);

      return res.status(200).json({
        success: true,
        signedAt: new Date().toISOString(),
        signedByName: name,
        signerIp: ip,
      });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
