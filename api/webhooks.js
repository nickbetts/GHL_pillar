/**
 * Main Webhook Handler
 * Receives all GHL webhook events and routes to appropriate automations
 * Endpoint: /api/webhooks.js
 * Register webhook URL in GHL: Settings → Integrations → Webhooks
 * Target: https://your-vercel-domain.vercel.app/api/webhooks
 */

const {
  getContact,
  updateContact,
  createOpportunity,
  listOpportunities,
  updateOpportunity,
} = require('../lib/ghlClient');
const { calculateScore } = require('../lib/leadScoring');
const { getTagsToAdd } = require('../lib/smartTagging');

async function handleWebhook(webhook) {
  const { type, data } = webhook;

  console.log(`[Webhook] Received event: ${type}`);

  try {
    switch (type) {
      case 'ContactCreate':
      case 'ContactUpdate':
        return await handleContactEvent(data);

      case 'OpportunityCreate':
      case 'OpportunityUpdate':
        return await handleOpportunityEvent(data);

      case 'InboundMessage':
        return await handleInboundMessage(data);

      default:
        console.log(`[Webhook] Unhandled event type: ${type}`);
        return { status: 'skipped', reason: 'Unhandled event type' };
    }
  } catch (error) {
    console.error(`[Webhook Error] ${type}:`, error.message);
    throw error;
  }
}

async function handleContactEvent(data) {
  const contactId = data.contactId || data.id;
  if (!contactId) return { status: 'error', reason: 'No contact ID' };

  const contact = await getContact(contactId);
  const updates = {};

  // 1. Calculate lead score
  const scoringResult = calculateScore(contact);
  if (scoringResult.score !== contact['ICP Score']) {
    updates['ICP Score'] = scoringResult.score;
    console.log(`[Lead Scoring] ${contactId}: ${scoringResult.score} (${scoringResult.matchedRules.join(', ')})`);
  }

  // 2. Apply smart tagging
  const currentTags = contact.tags || [];
  const tagsToAdd = getTagsToAdd(contact, currentTags);
  if (tagsToAdd.length > 0) {
    const newTags = Array.from(new Set([...currentTags, ...tagsToAdd]));
    updates.tags = newTags;
    console.log(`[Smart Tagging] ${contactId}: Added tags: ${tagsToAdd.join(', ')}`);
  }

  // 3. Auto-create opportunity if tagged with high-intent
  if (tagsToAdd.includes('high-intent')) {
    const existingOpps = await listOpportunities({ contactId });
    if (!existingOpps.data || existingOpps.data.length === 0) {
      const oppData = {
        contactId,
        name: `${contact.companyName || 'New'} — ${contact.firstName} ${contact.lastName}`,
        pipelineId: process.env.GHL_PIPELINE_ID, // Will set this in .env
        stage: 'Lead',
        assignedTo: process.env.GHL_DEFAULT_OWNER, // Will set in .env
        customFields: {
          'Persona': contact['Governance Role'],
          'Org Size Band': contact['Annual Income Band'],
          'Lead Source Channel': contact['UTM Source'] || 'Direct',
        },
      };
      try {
        const newOpp = await createOpportunity(oppData);
        console.log(`[Opportunity Auto-Creator] ${contactId}: Created opportunity ${newOpp.id}`);
      } catch (e) {
        console.error(`[Opportunity Auto-Creator] Error:`, e.message);
      }
    }
  }

  // Apply updates
  if (Object.keys(updates).length > 0) {
    await updateContact(contactId, updates);
    return { status: 'success', updated: Object.keys(updates), scoringResult };
  }

  return { status: 'no_changes' };
}

async function handleOpportunityEvent(data) {
  const opportunityId = data.opportunityId || data.id;
  if (!opportunityId) return { status: 'error', reason: 'No opportunity ID' };

  const { stage, contactId } = data;

  // Auto-assignment: when opportunity created, assign to team member
  if (stage === 'Lead' && !data.assignedTo) {
    const contact = await getContact(contactId);
    const persona = contact['Governance Role'];
    
    let assignTo = process.env.GHL_DEFAULT_OWNER;
    
    // Simple role-based routing
    if (persona === 'Fundraising Director') {
      assignTo = process.env.GHL_FUNDRAISING_OWNER || assignTo;
    } else if (persona === 'Operations Manager') {
      assignTo = process.env.GHL_OPS_OWNER || assignTo;
    }

    if (assignTo) {
      await updateOpportunity(opportunityId, { assignedTo: assignTo });
      console.log(`[Auto-Assignment] ${opportunityId}: Assigned to ${assignTo}`);
    }
  }

  return { status: 'success' };
}

async function handleInboundMessage(data) {
  const contactId = data.contactId;
  const messageBody = data.body || '';

  if (!contactId) return { status: 'error', reason: 'No contact ID' };

  const updates = {};

  // If message contains booking intent, tag as demo-scheduled
  if (messageBody.toLowerCase().includes('book') || 
      messageBody.toLowerCase().includes('schedule') || 
      messageBody.toLowerCase().includes('demo')) {
    const contact = await getContact(contactId);
    const tags = contact.tags || [];
    
    if (!tags.includes('demo-scheduled')) {
      updates.tags = Array.from(new Set([...tags, 'demo-scheduled']));
      
      // Remove high-intent to exit nurture
      updates.tags = updates.tags.filter(t => t !== 'high-intent');
      
      console.log(`[Message Handler] ${contactId}: Tagged demo-scheduled, removed high-intent`);
    }
  }

  // If message contains STOP, opt out
  if (messageBody.toUpperCase().includes('STOP')) {
    const contact = await getContact(contactId);
    const tags = contact.tags || [];
    updates.tags = Array.from(new Set([...tags, 'opted-out-sms']));
    console.log(`[Message Handler] ${contactId}: Opted out of SMS`);
  }

  if (Object.keys(updates).length > 0) {
    await updateContact(contactId, updates);
  }

  return { status: 'success' };
}

export default async function handler(req, res) {
  // Verify webhook signature (implement this for security)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await handleWebhook(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('[Webhook Handler Error]:', error);
    res.status(500).json({ error: error.message });
  }
}
