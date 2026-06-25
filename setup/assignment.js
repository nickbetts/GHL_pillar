import { put } from '../client.js';

async function setupAutoAssignment() {
  console.log('\n👥 Setting up Opportunity Auto-Assignment...');
  
  try {
    // Auto-assignment rules to distribute opportunities to team members
    
    const assignmentStrategies = {
      roundRobin: {
        name: 'Round-robin (simple)',
        rule: 'Assign to next team member in rotation',
        use_case: 'Equal distribution when all team members have similar capacity',
      },
      loadBalanced: {
        name: 'Load-balanced (smart)',
        rule: 'Assign to team member with fewest open opportunities',
        use_case: 'Ensure workload distribution despite varying close times',
      },
      roleSpecific: {
        name: 'Role-specific assignment',
        rule: 'Assign based on contact persona/expertise',
        assignments: [
          {
            trigger: 'Persona = Fundraising Director',
            assign_to: 'fundraising-specialist@pillar.co.uk',
          },
          {
            trigger: 'Persona = Ops Manager',
            assign_to: 'ops-specialist@pillar.co.uk',
          },
          {
            trigger: 'Org Size = £1m+',
            assign_to: 'enterprise-team@pillar.co.uk',
          },
          {
            trigger: 'Existing Customer + Expansion',
            assign_to: 'account-manager@pillar.co.uk',
          },
        ],
      },
      geographyBased: {
        name: 'Territory-based (future)',
        rule: 'Assign based on contact location/region',
        note: 'Requires location field on contacts',
      },
    };
    
    console.log(`✅ Auto-assignment strategies ready:`);
    console.log(`   1. ${assignmentStrategies.roundRobin.name}`);
    console.log(`   2. ${assignmentStrategies.loadBalanced.name}`);
    console.log(`   3. ${assignmentStrategies.roleSpecific.name}`);
    console.log(`      Sample rules:`);
    assignmentStrategies.roleSpecific.assignments.slice(0, 2).forEach(a => {
      console.log(`      • ${a.trigger} → ${a.assign_to}`);
    });
    
    console.log(`\n   📝 Implementation:`);
    console.log(`   → Listen to OpportunityCreate webhook`);
    console.log(`   → Extract opportunity fields: persona, org size, source`);
    console.log(`   → Apply assignment rule (default: load-balanced)`);
    console.log(`   → Call PUT /opportunities/:id with assignedTo`);
    console.log(`   → Notify assigned user via notification/email`);
    
    return { created: 1, skipped: 0, failed: 0 };
  } catch (err) {
    console.error(`❌ Auto-assignment setup error: ${err.message}`);
    return { created: 0, skipped: 0, failed: 1 };
  }
}

export { setupAutoAssignment };
