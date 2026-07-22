export async function setupLeadScoring() {
  const rules = [
    { condition: 'Marketing Budget £250k-1m', points: 25 },
    { condition: 'Marketing Budget £50k-250k', points: 15 },
    { condition: 'Campaign Launch Timeline = Immediate', points: 20 },
    { condition: 'Company Size 1000+', points: 15 },
    { condition: 'Interested Service Line = 3+ services', points: 20 },
    { condition: 'Primary Acquisition Channel = Referral', points: 15 },
    { condition: 'Previous Agency Experience = Yes', points: 10 },
    { condition: 'Content Downloaded', points: 10 },
  ];

  return {
    ok: true,
    rulesCount: rules.length,
    rules,
    implementation: `
Implementation: Listen to ContactUpdate webhook
→ Extract contact fields: Marketing Budget, Timeline, Company Size, etc.
→ Run scoring rules → Sum points → Update ICP Score field
→ Re-runs whenever any tracked field changes
    `,
  };
}
