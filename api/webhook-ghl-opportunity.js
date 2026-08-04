/**
 * GHL Webhook Handler: Opportunity Stage Changes
 * Listens for opportunity updates and syncs stage changes back to Apollo
 * 
 * Configure in GHL:
 * Settings → Integrations → Webhooks
 * URL: https://your-domain.vercel.app/api/webhook-ghl-opportunity
 * Event: Opportunity Updated
 */

import { get } from '../client.js';
import { updateDeal } from './apollo-client.js';
import { getSql, markWebhookProcessed } from './db.js';
import { verifyBodySize, verifyWebhookSecret } from './webhook-security.js';

/**
 * Map GHL opportunity stages back to Apollo deal statuses
 */
function mapGHLStageToApollo(ghlStage) {
  const stageMap = {
    'discovery': 'open',
    'qualified': 'qualified',
    'scoping': 'open',
    'proposal': 'negotiating',
    'negotiation': 'negotiating',
    'won': 'won',
    'post-launch': 'won',
    'churn risk': 'lost',
  };

  return stageMap[ghlStage?.toLowerCase()] || 'open';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.ENABLE_GHL_INBOUND_WEBHOOKS !== 'true') {
    return res.status(410).json({ error: 'GHL inbound webhooks are disabled' });
  }

  const verification = verifyWebhookSecret(req, {
    envName: 'GHL_WEBHOOK_SECRET',
    headers: ['x-webhook-secret', 'authorization'],
  });
  if (!verification.ok) {
    return res.status(verification.status).json({ error: verification.error });
  }
  const bodySize = verifyBodySize(req);
  if (!bodySize.ok) return res.status(bodySize.status).json({ error: bodySize.error });

  const deliveryId = req.body?.webhookId || req.headers?.['x-wh-message-id'] || null;
  if (deliveryId) {
    const fresh = await markWebhookProcessed(getSql(), 'ghl-opportunity', deliveryId);
    if (!fresh) return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    const { opportunity, type } = req.body;

    // Only process stage changes
    if (type !== 'OpportunityStatusUpdate') {
      return res.status(200).json({ received: true });
    }

    const opportunityId = opportunity?.id;
    const newStage = opportunity?.stage;

    if (!opportunityId || !newStage) {
      console.warn('⚠️ Webhook missing required fields');
      return res.status(400).json({ error: 'Missing opportunityId or stage' });
    }

    console.log(`📥 GHL webhook: Opportunity ${opportunityId} → Stage: ${newStage}`);

    // Fetch the opportunity to get Apollo Deal ID from custom fields
    const fullOpportunity = await get(`/opportunities/${opportunityId}`, {
      locationId: process.env.GHL_LOCATION_ID,
    });

    const apolloDealId = fullOpportunity?.opportunity?.customFields?.find(
      (f) => f.name === 'apolloDealId' || f.id?.includes('apollo')
    )?.value;

    if (!apolloDealId) {
      console.warn(`⚠️ No Apollo Deal ID found for opportunity ${opportunityId}`);
      return res.status(200).json({
        synced: false,
        reason: 'No Apollo Deal ID in opportunity',
      });
    }

    // Map stage to Apollo status
    const apolloStatus = mapGHLStageToApollo(newStage);

    console.log(`🔄 Syncing: GHL stage "${newStage}" → Apollo status "${apolloStatus}"`);

    // Update Apollo deal
    const result = await updateDeal(apolloDealId, {
      status: apolloStatus,
    });

    console.log(`✅ Apollo deal ${apolloDealId} updated to ${apolloStatus}`);

    return res.status(200).json({
      synced: true,
      apolloDealId,
      newStatus: apolloStatus,
      result,
    });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    return res.status(500).json({
      error: error.message,
    });
  }
}
