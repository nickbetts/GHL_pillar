/**
 * GET /api/stale-opportunities — open opportunities with no next step for 3+ days (team-wide).
 * Feeds the red banner shown across the CRM. Same banner for everyone so nothing sits unowned.
 */

import { getSql } from './db.js';
import { resolveIdentity } from './session.js';
import { findStaleOpportunities, STALE_DAYS } from '../lib/staleOpportunities.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!resolveIdentity(req)) return res.status(401).json({ success: false, error: 'Not signed in' });
  try {
    const items = await findStaleOpportunities(getSql(), { days: STALE_DAYS });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, days: STALE_DAYS, count: items.length, items: items.slice(0, 50) });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
