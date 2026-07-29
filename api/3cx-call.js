/**
 * Server-side click-to-call via the 3CX Call Control API.
 *
 * Rings the agent's extension, then dials the lead — no browser tel: handler
 * needed. Dormant until configured:
 *   THREECX_API_BASE   e.g. https://yourpbx.3cx.eu
 *   THREECX_API_TOKEN  bearer token for the Call Control API
 *   THREECX_MAKECALL_PATH  optional, default /callcontrol/%ext%/makecall
 *
 * Body: { number, extension }. Manager+ session required.
 */

import { resolveIdentity, hasMinRole } from './session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const identity = resolveIdentity(req);
  if (!identity) return res.status(401).json({ success: false, error: 'Not signed in' });
  if (!hasMinRole(identity, 'manager')) return res.status(403).json({ success: false, error: 'Manager role required' });

  const base = process.env.THREECX_API_BASE;
  const token = process.env.THREECX_API_TOKEN;
  if (!base || !token) {
    return res.status(503).json({ success: false, error: 'Server dial not configured' });
  }

  const { number, extension } = req.body || {};
  if (!number || !extension) {
    return res.status(400).json({ success: false, error: 'number and extension required' });
  }

  const pathTpl = process.env.THREECX_MAKECALL_PATH || '/callcontrol/%ext%/makecall';
  const url = base.replace(/\/$/, '') + pathTpl.replace('%ext%', encodeURIComponent(String(extension)));
  const destination = String(number).replace(/[^+0-9]/g, '');

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination }),
    });
    const text = await r.text();
    return res.status(r.ok ? 200 : 502).json({ success: r.ok, status: r.status, body: text.slice(0, 300) });
  } catch (error) {
    return res.status(502).json({ success: false, error: error.message });
  }
}
