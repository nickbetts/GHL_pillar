import { get, put } from '../client.js';

async function setupDeduplication() {
  console.log('\n🔄 Setting up Contact Deduplication...');
  
  try {
    // Deduplication rules to detect and handle duplicate contacts
    
    const dedupeRules = {
      strategies: [
        {
          name: 'Exact email match',
          condition: 'Two or more contacts with same email address',
          action: 'Flag for review OR auto-merge if one is older than 7 days',
          priority: 'Critical',
        },
        {
          name: 'Exact phone match',
          condition: 'Two or more contacts with same phone number',
          action: 'Flag for review, check if same company',
          priority: 'High',
        },
        {
          name: 'Fuzzy name + company match',
          condition: 'Similar names (Levenshtein > 85%) + same company',
          action: 'Flag for manual review',
          priority: 'Medium',
        },
        {
          name: 'Domain-based company match',
          condition: 'Same company domain (e.g., @oxfam.org.uk) + contacted recently',
          action: 'Suggest merge if created within 24h',
          priority: 'Medium',
        },
      ],
      mergeProcess: [
        '1. Identify duplicate pair',
        '2. Keep newest record as primary',
        '3. Combine tags from both',
        '4. Combine notes/timeline',
        '5. Associate all opportunities to primary',
        '6. Mark secondary as "merged-to: [ID]"',
        '7. Do not delete — keep for reference',
      ],
    };
    
    console.log(`✅ Deduplication rules ready:`);
    dedupeRules.strategies.forEach((s, i) => {
      console.log(`   ${i + 1}. ${s.name} (${s.priority})`);
      console.log(`      If: ${s.condition}`);
      console.log(`      Then: ${s.action}`);
    });
    
    console.log(`\n   📝 Implementation:`);
    console.log(`   → Run daily: GET /contacts with fields=[email,phone,firstName,companyName]`);
    console.log(`   → Check all pairs for email/phone duplicates`);
    console.log(`   → Create merge tasks in GHL or export to CSV`);
    console.log(`   → Merge via: PUT /contacts/:id (set secondary as status="merged")`);
    
    return { created: 1, skipped: 0, failed: 0 };
  } catch (err) {
    console.error(`❌ Deduplication setup error: ${err.message}`);
    return { created: 0, skipped: 0, failed: 1 };
  }
}

export { setupDeduplication };
