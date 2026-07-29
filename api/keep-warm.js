/**
 * Keep-warm ping: runs a trivial query so Neon's compute doesn't scale to zero
 * between calls. Keeps 3CX caller-ID lookups fast (no cold-start on the pop).
 * Triggered by a Vercel cron (see vercel.json).
 */

import { getSql } from './db.js';

export default async function handler(req, res) {
  try {
    const sql = getSql();
    await sql`SELECT 1`;
    return res.status(200).json({ ok: true, at: new Date().toISOString() });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
