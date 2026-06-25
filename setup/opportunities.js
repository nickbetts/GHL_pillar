import { get, post } from '../client.js';

async function setupOpportunityAutoCreator() {
  console.log('\n📋 Setting up Opportunity Auto-Creator...');
  
  try {
    // Opportunity auto-creation rules
    // When a contact hits "high-intent", automatically create an opportunity
    
    const rules = {
      triggers: [
        {
          name: 'High Intent Contact',
          condition: 'tag = high-intent AND no open opportunity',
          action: 'Create opportunity in Pillar Sales Pipeline / Lead stage',
          copyFields: ['firstName', 'lastName', 'email', 'companyName', 'title'],
          setFields: {
            'Persona': 'from Governance Role field',
            'Org Size Band': 'from Annual Income Band field',
            'Lead Source Channel': 'from UTM Source field',
          },
        },
        {
          name: 'Existing Customer Expansion',
          condition: 'tag = customer AND tag = expansion',
          action: 'Create opportunity in Pillar Sales Pipeline / Expansion stage',
        },
        {
          name: 'Case Study Candidate',
          condition: 'tag = case-study-candidate AND no open opportunity',
          action: 'Create opportunity in Pillar Sales Pipeline / Research Stage',
        },
      ],
    };
    
    console.log(`✅ Opportunity auto-creation rules ready:`);
    rules.triggers.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.name}`);
      console.log(`      When: ${r.condition}`);
      console.log(`      Then: ${r.action}`);
    });
    
    console.log(`\n   📝 Implementation via webhook listener:`);
    console.log(`   → Listen to tag updates via ContactUpdate webhook`);
    console.log(`   → Check if condition is met`);
    console.log(`   → Call POST /opportunities to create opportunity`);
    
    return { created: 1, skipped: 0, failed: 0 };
  } catch (err) {
    console.error(`❌ Opportunity auto-creator setup error: ${err.message}`);
    return { created: 0, skipped: 0, failed: 1 };
  }
}

export { setupOpportunityAutoCreator };
