/**
 * Server-side click-to-call via the 3CX Call Control API.
 *
 * Fully automated: the PBX rings the rep's extension, then dials the lead.
 * No browser tab, no tel: handler.
 *
 * Config (Vercel env):
 *   THREECX_API_BASE      e.g. https://i3media.3cx.co.uk:5001
 *   THREECX_CLIENT_ID     Call Control API app client id
 *   THREECX_CLIENT_SECRET Call Control API app client secret
 *   THREECX_API_TOKEN     (optional) static bearer token instead of client creds
 *
 * Body: { number, extension }. Manager+ session required.
 */

import { resolveIdentity, hasMinRole } from './session.js';

function serverDialConfigured() {
  const base = process.env.THREECX_API_BASE;
  const hasCreds = process.env.THREECX_CLIENT_ID && process.env.THREECX_CLIENT_SECRET;
  return !!(base && (hasCreds || process.env.THREECX_API_TOKEN));
}

async function getToken(base) {
  if (process.env.THREECX_API_TOKEN) return process.env.THREECX_API_TOKEN;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.THREECX_CLIENT_ID,
    client_secret: process.env.THREECX_CLIENT_SECRET,
  });
  const res = await fetch(base.replace(/\/$/, '') + '/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token ${res.status}: ${text.slice(0, 160)}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error('no access_token in token response');
  return json.access_token;
}

async function makeCall(base, token, dn, number) {
  const root = base.replace(/\/$/, '');
  const destination = String(number).replace(/[^+0-9]/g, '');
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const payload = JSON.stringify({ reason: 'CRM click-to-call', destination, timeout: 30 });

  // Preferred v20 route.
  let r = await fetch(`${root}/callcontrol/${encodeURIComponent(dn)}/makecall`, { method: 'POST', headers: auth, body: payload });
  if (r.status !== 404) {
    const t = await r.text();
    return { ok: r.ok, status: r.status, body: t.slice(0, 300) };
  }

  // Fallback: originate from a specific registered device of the extension.
  const dr = await fetch(`${root}/callcontrol/${encodeURIComponent(dn)}/devices`, { headers: { Authorization: `Bearer ${token}` } });
  if (!dr.ok) return { ok: false, status: dr.status, body: 'makecall 404 and devices lookup failed' };
  const devices = await dr.json().catch(() => []);
  const device = Array.isArray(devices) ? devices[0] : (devices?.devices ? devices.devices[0] : null);
  const deviceId = device?.device_id || device?.deviceId || device?.dn || device?.id;
  if (!deviceId) return { ok: false, status: 404, body: 'no registered device for extension ' + dn };
  r = await fetch(`${root}/callcontrol/${encodeURIComponent(dn)}/devices/${encodeURIComponent(deviceId)}/makecall`, { method: 'POST', headers: auth, body: payload });
  const t = await r.text();
  return { ok: r.ok, status: r.status, body: t.slice(0, 300) };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const identity = resolveIdentity(req);
  if (!identity) return res.status(401).json({ success: false, error: 'Not signed in' });
  if (!hasMinRole(identity, 'manager')) return res.status(403).json({ success: false, error: 'Manager role required' });

  if (!serverDialConfigured()) return res.status(503).json({ success: false, error: 'Server dial not configured' });

  const { number, extension } = req.body || {};
  if (!number || !extension) return res.status(400).json({ success: false, error: 'number and extension required' });

  try {
    const base = process.env.THREECX_API_BASE;
    const token = await getToken(base);
    const result = await makeCall(base, token, String(extension), number);
    return res.status(result.ok ? 200 : 502).json({ success: result.ok, ...result });
  } catch (error) {
    return res.status(502).json({ success: false, error: error.message });
  }
}

