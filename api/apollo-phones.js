/**
 * Retired endpoint (direct-dial reveal webhook).
 * Disabled: unauthenticated and only ever wrote direct-dial numbers, which
 * are no longer used. Enrichment is office-phone-only now.
 */

export default async function handler(req, res) {
  return res.status(410).json({ error: 'gone', message: 'Apollo direct-dial webhook retired' });
}
