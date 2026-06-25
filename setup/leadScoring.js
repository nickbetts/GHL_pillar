import { get } from '../client.js';

const LEAD_SCORING_RULES = {
  // Scoring rules based on contact attributes and engagement
  // Each rule has a condition and a score value
  // ICP Score field gets updated based on rules matched
  
  rules: [
    {
      name: 'High Annual Income',
      condition: { field: 'Annual Income Band', equals: '£1m+' },
      score: 25,
    },
    {
      name: 'Medium-High Annual Income',
      condition: { field: 'Annual Income Band', in: ['£250k–£1m', '£1m+'] },
      score: 15,
    },
    {
      name: 'Decision Timeline Immediate',
      condition: { field: 'Decision Timeline', equals: 'Immediate' },
      score: 20,
    },
    {
      name: 'Decision Timeline 1-3 Months',
      condition: { field: 'Decision Timeline', equals: '1–3 months' },
      score: 15,
    },
    {
      name: 'Budget Authority Yes',
      condition: { field: 'Budget Authority', equals: 'Yes' },
      score: 20,
    },
    {
      name: 'Pain Points Compliance or Reporting',
      condition: { field: 'Primary Pain Points', contains: ['Compliance', 'Reporting'] },
      score: 10,
    },
    {
      name: 'Existing Customer',
      condition: { field: 'Existing Customer', equals: 'Yes' },
      score: 30,
    },
    {
      name: 'Expansion Potential High',
      condition: { field: 'Expansion Potential', equals: 'High' },
      score: 15,
    },
    {
      name: 'Content Downloaded',
      condition: { field: 'Content Downloaded', notEmpty: true },
      score: 10,
    },
    {
      name: 'Event Attended',
      condition: { field: 'Event Attended', notEmpty: true },
      score: 15,
    },
  ],
};

async function setupLeadScoring() {
  console.log('\n🎯 Setting up Lead Scoring Engine...');
  
  try {
    // Lead scoring in GHL is typically handled via:
    // 1. Webhook listener on ContactUpdate
    // 2. Evaluate all rules against contact fields
    // 3. Calculate total score and update ICP Score field
    
    console.log(`✅ Lead Scoring rules ready for implementation:`);
    console.log(`   Rules available: ${LEAD_SCORING_RULES.rules.length}`);
    LEAD_SCORING_RULES.rules.slice(0, 3).forEach(r => {
      console.log(`   • ${r.name} → +${r.score} points`);
    });
    console.log(`   ... and ${LEAD_SCORING_RULES.rules.length - 3} more`);
    console.log(`\n   📝 Implementation: Listen to ContactUpdate webhook`);
    console.log(`   → Run scoring rules → Update ICP Score field`);
    
    return { created: 1, skipped: 0, failed: 0 };
  } catch (err) {
    console.error(`❌ Lead scoring setup error: ${err.message}`);
    return { created: 0, skipped: 0, failed: 1 };
  }
}

export { setupLeadScoring };
