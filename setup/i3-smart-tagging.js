export async function setupSmartTagging() {
  const rules = [
    {
      name: 'High Budget Enterprise',
      condition: 'Marketing Budget = £1m+ AND Company Size = 1000+',
      tags: ['enterprise-budget', 'high-intent'],
    },
    {
      name: 'Fast Track Urgency',
      condition: 'Campaign Launch Timeline = Immediate AND High Purchase Intent',
      tags: ['fast-track', 'high-intent'],
    },
    {
      name: 'Multi-Service Interest',
      condition: 'Interested Service Line count >= 4',
      tags: ['high-intent'],
    },
    {
      name: 'Warm Referral',
      condition: 'Primary Acquisition Channel = Referral',
      tags: ['warm-referral', 'high-intent'],
    },
    {
      name: 'SaaS Buyer',
      condition: 'Industry Vertical = SaaS',
      tags: ['saas'],
    },
    {
      name: 'FinTech Buyer',
      condition: 'Industry Vertical = FinTech',
      tags: ['fintech'],
    },
    {
      name: 'Ecommerce Buyer',
      condition: 'Industry Vertical = Ecommerce',
      tags: ['ecommerce'],
    },
    {
      name: 'Agency Experienced',
      condition: 'Previous Agency Experience = Yes',
      tags: ['previous-agency-user'],
    },
    {
      name: 'Agency New',
      condition: 'Previous Agency Experience = No',
      tags: ['agency-virgin'],
    },
    {
      name: 'Engaged with Content',
      condition: 'Content Downloaded OR Webinar Attended',
      tags: ['content-downloaded', 'information-gathering'],
    },
  ];

  return {
    ok: true,
    rulesCount: rules.length,
    rules,
    implementation: `
Implementation via webhook:
→ Listen to ContactUpdate webhook
→ Evaluate field conditions
→ Call PUT /contacts/:id to add/remove tags
→ Re-runs whenever any tracked field changes
    `,
  };
}
