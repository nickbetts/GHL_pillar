// Temporary diagnostic with STATIC imports so Vercel bundles the real deps.
import { checkAuth } from './auth.js';
import { getSql } from './db.js';
import * as apolloClient from './apollo-client.js';

export default async function handler(req, res) {
  const out = {
    marker: 'bisect-no-root-import',
    env: {
      GHL_TOKEN: !!process.env.GHL_TOKEN,
      DATABASE_URL: !!process.env.DATABASE_URL,
      QUEUE_PASSWORD: !!process.env.QUEUE_PASSWORD,
    },
  };
  try { out.checkAuth = typeof checkAuth; } catch (e) { out.checkAuth = 'ERR ' + e.message; }
  try { out.apolloExports = Object.keys(apolloClient); } catch (e) { out.apollo = 'ERR ' + e.message; }
  try {
    const sql = getSql();
    const r = await sql`SELECT 1 AS ok`;
    out.db = r[0];
  } catch (e) {
    out.db = 'ERR ' + e.message;
  }
  res.status(200).json(out);
}
