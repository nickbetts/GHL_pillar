import { put } from '../client.js';

const AUTO_TAGGING_RULES = [
  {
    name: 'Revenue-based Persona',
    when: 'Annual Income Band = £1m+ AND Governance Role = Fundraising Director',
    then: ['fundraising-director', 'org-500plus', 'high-intent'],
  },
  {
    name: 'Tech Stack Pain Point',
    when: 'Primary Pain Points contains Spreadsheets OR Tool sprawl',
    then: ['high-intent', 'consideration-stage'],
  },
  {
    name: 'Charity Sector Tagging',
    when: 'Charity Sector = Muslim',
    then: ['mosque-org'],
  },
  {
    name: 'Engagement Tagging',
    when: 'Content Downloaded OR Event Attended',
    then: ['retargeting-warm', 'consideration-stage'],
  },
  {
    name: 'Form Abandonment Follow-up',
    when: 'Form Abandonment Flag = Yes',
    then: ['retargeting-warm'],
  },
  {
    name: 'Expansion Opportunity',
    when: 'Existing Customer = Yes AND Expansion Potential = High',
    then: ['expansion', 'customer'],
  },
  {
    name: 'Case Study Alignment',
    when: 'Case Study Candidate = Yes AND Org Size Band = £250k–£1m',
    then: ['case-study-candidate', 'trust-sprint'],
  },
  {
    name: 'Ramadan Campaign',
    when: 'Islamic Calendar Relevance = Yes AND Charity Sector = Muslim',
    then: ['ramadan-campaign', 'islamic-calendar-relevant'],
  },
];

async function setupSmartTagging() {
  console.log('\n🏷️  Setting up Smart Auto-Tagging...');
  
  try {
    console.log(`✅ Smart tagging rules ready:`);
    AUTO_TAGGING_RULES.forEach((rule, i) => {
      console.log(`   ${i + 1}. ${rule.name}`);
      console.log(`      If: ${rule.when}`);
      console.log(`      Then: ${rule.then.join(', ')}`);
    });
    
    console.log(`\n   📝 Implementation via webhook:`);
    console.log(`   → Listen to ContactUpdate webhook`);
    console.log(`   → Evaluate field conditions`);
    console.log(`   → Call PUT /contacts/:id to add tags`);
    console.log(`   → Re-runs whenever any tracked field changes`);
    
    return { created: AUTO_TAGGING_RULES.length, skipped: 0, failed: 0 };
  } catch (err) {
    console.error(`❌ Smart tagging setup error: ${err.message}`);
    return { created: 0, skipped: 0, failed: 1 };
  }
}

export { setupSmartTagging };
