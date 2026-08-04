/**
 * One-time (idempotent) DB init endpoint for the sales-queue staging store.
 *
 * Usage: GET /api/db-init with header x-init-secret: YOUR_CRON_SECRET
 * Protected by CRON_SECRET so it can't be triggered anonymously.
 */

import crypto from 'crypto';
import { initQueueTable } from './db.js';

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

export default async function handler(req, res) {
  const secret = req.headers?.['x-init-secret'];
  if (!process.env.CRON_SECRET || !timingSafeEqualStr(secret, process.env.CRON_SECRET)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const result = await initQueueTable();
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
