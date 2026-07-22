/**
 * Vercel Cron Job: Sync Apollo Deals to GHL
 * Triggered automatically on schedule (configure in vercel.json)
 * 
 * Usage:
 * - Set up in vercel.json with cron expression
 * - Example: every 4 hours = "0 */4 * * *"
 * - Test: curl https://your-domain.vercel.app/api/cron-sync-apollo
 */

import { syncApolloDeals } from './sync-apollo-deals.js';

export default async function handler(req, res) {
  // Verify this is from Vercel's cron service (optional but recommended)
  const authToken = req.headers.authorization;
  if (authToken !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('⏰ Cron job triggered: Apollo → GHL sync');

    const result = await syncApolloDeals();

    return res.status(200).json({
      success: true,
      data: result,
      message: result.summary,
    });
  } catch (error) {
    console.error('❌ Cron job failed:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
