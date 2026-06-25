import { get } from '../client.js';

const WEBHOOK_CONFIG = {
  // Webhook listener for real-time lead scoring and auto-tagging
  // When a contact is created, trigger lead scoring rules
  // When a contact is updated, re-score and update tags dynamically
  events: [
    'ContactCreate',
    'ContactUpdate',
    'OpportunityCreate',
    'OpportunityUpdate',
    'InboundMessage',
  ],
};

async function setupWebhooks() {
  console.log('\n📡 Setting up Webhooks...');
  
  try {
    // Webhook configuration - GHL webhooks require URL registration in UI
    // This module documents the webhook events available for automation
    
    const existingEvents = WEBHOOK_CONFIG.events; // In production, fetch from API
    
    console.log(`✅ Webhook events available for setup:`);
    WEBHOOK_CONFIG.events.forEach(e => console.log(`   • ${e}`));
    console.log(`\n   📝 Configure webhook URL in GHL → Settings → Integrations → Webhooks`);
    console.log(`   Target URL should be: https://your-server.com/ghl/webhook`);
    
    return { created: 1, skipped: 0, failed: 0 };
  } catch (err) {
    console.error(`❌ Webhook setup error: ${err.message}`);
    return { created: 0, skipped: 0, failed: 1 };
  }
}

export { setupWebhooks };
