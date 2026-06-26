/**
 * Apollo B2B Enrichment API
 * Looks up company/person data from Apollo and syncs to GHL
 * Runs on: ContactCreate
 * Endpoint: /api/apollo.js
 */

const { getContact, updateContact } = require('../lib/ghlClient');

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

async function lookupInApollo(email, companyName) {
  if (!APOLLO_API_KEY) {
    console.log('[Apollo] No API key configured');
    return null;
  }

  try {
    const response = await fetch('https://api.apolloio.com/v1/contacts/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({
        api_key: APOLLO_API_KEY,
        email_to_match: email,
        ...(companyName && { company: companyName }),
      }),
    });

    if (!response.ok) {
      console.error(`[Apollo] Error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.contacts?.[0] || null;
  } catch (error) {
    console.error('[Apollo] Lookup failed:', error.message);
    return null;
  }
}

function mapApolloToGHL(apolloData) {
  const updates = {};

  // Map Apollo fields to GHL custom fields
  if (apolloData.linkedin_url) {
    updates['LinkedIn Profile URL'] = apolloData.linkedin_url;
  }

  if (apolloData.title) {
    updates.title = apolloData.title;
  }

  // Map company revenue to income band
  if (apolloData.organization?.annual_revenue) {
    const revenue = apolloData.organization.annual_revenue;
    if (revenue > 1000000) {
      updates['Annual Income Band'] = '£1m+';
    } else if (revenue > 250000) {
      updates['Annual Income Band'] = '£250k–£1m';
    } else if (revenue > 50000) {
      updates['Annual Income Band'] = '£50k–£250k';
    } else {
      updates['Annual Income Band'] = '<£50k';
    }
  }

  // Map employee count to org size
  if (apolloData.organization?.employee_count) {
    const empCount = apolloData.organization.employee_count;
    if (empCount > 500) {
      updates['Org Size Band'] = '£1m+';
    } else if (empCount > 200) {
      updates['Org Size Band'] = '£250k–£1m';
    } else if (empCount > 50) {
      updates['Org Size Band'] = '£50k–£250k';
    } else {
      updates['Org Size Band'] = '<£50k';
    }
  }

  return updates;
}

function calculateApolloBonus(apolloData) {
  let bonus = 0;
  const industry = apolloData.organization?.industry?.toLowerCase?.() || '';

  // C-level/VP + revenue > £1m → +20 ICP
  if (
    apolloData.title &&
    (apolloData.title.match(/VP|C-level|Chief|President|Director/) &&
      apolloData.organization?.annual_revenue > 1000000)
  ) {
    bonus += 20;
  }

  // Company size 50–200 + industry = non-profit → +15 ICP
  if (
    apolloData.organization?.employee_count >= 50 &&
    apolloData.organization?.employee_count <= 200 &&
    industry.includes('non-profit')
  ) {
    bonus += 15;
  }

  return bonus;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { contactId } = req.body;
  if (!contactId) {
    return res.status(400).json({ error: 'No contact ID provided' });
  }

  try {
    const contact = await getContact(contactId);
    if (!contact.email || !contact.companyName) {
      return res.status(200).json({ status: 'skipped', reason: 'Missing email or company' });
    }

    // Look up in Apollo
    const apolloData = await lookupInApollo(contact.email, contact.companyName);
    if (!apolloData) {
      return res.status(200).json({ status: 'not_found' });
    }

    // Map Apollo fields to GHL
    const updates = mapApolloToGHL(apolloData);
    
    // Calculate ICP bonus
    const icpBonus = calculateApolloBonus(apolloData);
    if (icpBonus > 0) {
      const currentScore = contact['ICP Score'] || 0;
      updates['ICP Score'] = Math.min(currentScore + icpBonus, 100);
    }

    // Apply updates
    await updateContact(contactId, updates);

    console.log(`[Apollo Enrichment] ${contactId}: Updated with Apollo data (bonus: +${icpBonus})`);

    res.status(200).json({
      status: 'enriched',
      updates,
      icpBonus,
      apolloData: {
        linkedin_url: apolloData.linkedin_url,
        title: apolloData.title,
        company: apolloData.organization?.name,
        revenue: apolloData.organization?.annual_revenue,
        employees: apolloData.organization?.employee_count,
      },
    });
  } catch (error) {
    console.error('[Apollo Error]:', error);
    res.status(500).json({ error: error.message });
  }
}
