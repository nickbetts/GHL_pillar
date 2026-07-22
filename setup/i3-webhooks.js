export async function setupWebhooks() {
  return {
    ok: true,
    message: 'Webhook configuration ready',
    events: [
      'ContactCreate',
      'ContactUpdate',
      'OpportunityCreate',
      'OpportunityUpdate',
      'InboundMessage',
    ],
    instructions: `
Configure webhook URL in GHL → Settings → Integrations → Webhooks
Target URL should be: https://your-server.com/api/webhooks

Events to enable:
  • ContactCreate — New lead added
  • ContactUpdate — Contact info or tags changed
  • OpportunityCreate — New opportunity created
  • OpportunityUpdate — Opportunity moved in pipeline
  • InboundMessage — Client replies via email/SMS
    `,
  };
}
