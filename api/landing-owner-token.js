import { getSql, initAuthTables } from './db.js';
import { resolveIdentity, hasMinRole } from './session.js';
import { createOwnerToken, validOwner } from '../lib/landingOwnerToken.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const identity = resolveIdentity(req);
  if (!identity || !hasMinRole(identity, 'manager')) return res.status(401).json({ success: false, error: 'Manager access required' });
  try {
    await initAuthTables();
    const body = req.body || {};
    const sql = getSql();
    let ownerId = String(body.ownerId || '').trim();
    if (!ownerId && body.email) {
      const rows = await sql`SELECT ghl_owner_id FROM app_users WHERE lower(email) = lower(${String(body.email).trim()}) AND active = TRUE LIMIT 1`;
      ownerId = rows[0]?.ghl_owner_id || '';
    }
    if (!validOwner(ownerId)) return res.status(400).json({ success: false, error: 'Valid ownerId or rep email is required' });
    const token = createOwnerToken({ ownerId, leadId: body.leadId || null });
    return res.status(200).json({ success: true, token, url: `/financial-advisers?t=${token}` });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
