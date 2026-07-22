export async function setupAutoAssignment() {
  const strategies = [
    {
      name: 'Round-robin',
      description: 'Distribute opportunities evenly across team',
    },
    {
      name: 'Load-balanced',
      description: 'Route to team member with fewest open deals',
    },
    {
      name: 'Service-based',
      description: 'Route by service line expertise',
      examples: [
        '1st Touch specialist → 1st-touch-interested',
        'Retargeting expert → retargeting-interested',
        'SEO specialist → seo-interested',
        'Meta specialist → paid-meta-interested',
      ],
    },
  ];

  return {
    ok: true,
    strategies,
    implementation: `
Implementation via OpportunityCreate webhook:
→ Extract opportunity fields: service packages, budget, urgency
→ Apply assignment strategy (default: load-balanced)
→ Query assigned team members, pick one with lowest load
→ Call PUT /opportunities/:id with assignedTo
→ Notify assigned account manager
    `,
  };
}
