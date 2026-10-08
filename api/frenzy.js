/**
 * GET /api/frenzy — current Double Point Frenzy state for the signed-in team.
 *
 * A frenzy window opens for 48h when a rep moves an opportunity to Won
 * (see api/apollo-sales-queue.js 'set-opportunity-stage'). While a window is
 * open, all leaderboard points earned by anyone count double.
 *
 * Returns the latest active window plus serverNow so clients can render a
 * countdown without trusting their local clock.
 */

import { getSql, ensurePointFrenzyTable } from './db.js';
import { resolveIdentity } from './session.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const identity = resolveIdentity(req);
  if (!identity) {
    return res.status(401).json({ success: false, error: 'Not signed in' });
  }

  try {
    const sql = getSql();
    await ensurePointFrenzyTable(sql);
    const rows = await sql`
      SELECT triggered_by_name, lead_name, started_at, ends_at
      FROM point_frenzies
      WHERE ends_at > now()
      ORDER BY ends_at DESC
      LIMIT 1
    `;
    const frenzy = rows[0] || null;
    return res.status(200).json({
      success: true,
      active: !!frenzy,
      serverNow: new Date().toISOString(),
      frenzy: frenzy ? {
        triggeredByName: frenzy.triggered_by_name,
        leadName: frenzy.lead_name,
        startedAt: frenzy.started_at,
        endsAt: frenzy.ends_at,
      } : null,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
