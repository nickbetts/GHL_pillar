// Temporary diagnostic with STATIC imports so Vercel bundles the real deps.
import { checkAuth } from './auth.js';
import { getSql } from './db.js';
import * as apolloClient from './apollo-client.js';
import * as ghlClient from '../client.js';

export default async function handler(req, res) {
  const out = {
    env: {
      GHL_TOKEN: !!process.env.GHL_TOKEN,
      GHL_LOCATION_ID: !!process.env.GHL_LOCATION_ID,
      DATABASE_URL: !!process.env.DATABASE_URL,
      QUEUE_PASSWORD: !!process.env.QUEUE_PASSWORD,
      GHL_QUALIFIED_STAGE_ID: !!process.env.GHL_QUALIFIED_STAGE_ID,
      GHL_CONVERTED_STAGE_ID: !!process.env.GHL_CONVERTED_STAGE_ID,
    },
  };
  try { out.checkAuth = typeof checkAuth; } catch (e) { out.checkAuth = 'ERR ' + e.message; }
  try { out.apolloExports = Object.keys(apolloClient); } catch (e) { out.apollo = 'ERR ' + e.message; }
  try { out.ghlExports = Object.keys(ghlClient); } catch (e) { out.ghl = 'ERR ' + e.message; }
  try {
    const sql = getSql();
    const r = await sql`SELECT 1 AS ok`;
    out.db = r[0];
  } catch (e) {
    out.db = 'ERR ' + e.message;
  }
  res.status(200).json(out);
}
