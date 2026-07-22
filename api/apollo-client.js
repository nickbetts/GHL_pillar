/**
 * Apollo.io API Client
 * Handles authentication and API calls to fetch deals and contact data
 */

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const APOLLO_BASE_URL = 'https://api.apollo.io/v1';

async function apolloFetch(endpoint, options = {}) {
  const url = `${APOLLO_BASE_URL}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': APOLLO_API_KEY,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Apollo API error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Fetch all open deals from Apollo
 * @param {Object} filters - Optional filters (status, date range, etc.)
 * @returns {Array} Array of deals
 */
async function getDeals(filters = {}) {
  const payload = {
    max_results: 100,
    person_titles: [],
    // Status filters - only pull open deals
    statuses: filters.statuses || ['open', 'qualified', 'negotiating'],
    ...filters,
  };

  const data = await apolloFetch('/deals/search', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return data?.deals ?? [];
}

/**
 * Get a single deal by ID
 */
async function getDeal(dealId) {
  const data = await apolloFetch(`/deals/${dealId}`);
  return data?.deal;
}

/**
 * Update an Apollo deal status
 * @param {string} dealId - Apollo deal ID
 * @param {Object} updates - Updates object with status, etc.
 */
async function updateDeal(dealId, updates = {}) {
  const payload = {
    ...updates,
  };

  const data = await apolloFetch(`/deals/${dealId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

  return data?.deal ?? data;
}

/**
 * Get contact details from a deal
 */
async function getContact(emailOrId) {
  const data = await apolloFetch('/contacts/search', {
    method: 'POST',
    body: JSON.stringify({
      q_fields: ['email', 'id'],
      q_all_terms: [emailOrId],
    }),
  });

  return data?.contacts?.[0];
}

/**
 * Enrich contact data with company information
 */
function enrichContactData(apolloDeal) {
  return {
    firstName: apolloDeal.contact?.first_name,
    lastName: apolloDeal.contact?.last_name,
    email: apolloDeal.contact?.email,
    phone: apolloDeal.contact?.phone_number,
    title: apolloDeal.contact?.title,
    companyName: apolloDeal.company?.name,
    source: 'Apollo Deals',
    // Map Apollo fields to custom fields
    customFields: {
      'Company Size Band': mapCompanySize(apolloDeal.company?.num_employees),
      'Industry Vertical': apolloDeal.company?.industry || 'Other',
      'Estimated Annual Revenue': mapRevenue(apolloDeal.company?.annual_revenue),
    },
  };
}

/**
 * Enrich opportunity data from Apollo deal
 */
function enrichOpportunityData(apolloDeal) {
  return {
    name: apolloDeal.name || `Deal: ${apolloDeal.company?.name}`,
    stage: mapDealStage(apolloDeal.status),
    monetaryValue: parseFloat(apolloDeal.value) || 0,
    customFields: {
      'Strategic Goal': apolloDeal.description || '',
      'Integration Required': 'None',
    },
    tags: generateTags(apolloDeal),
  };
}

/**
 * Map Apollo company size to GHL bands
 */
function mapCompanySize(employeeCount) {
  if (!employeeCount) return null;
  if (employeeCount <= 50) return '1-50';
  if (employeeCount <= 200) return '51-200';
  if (employeeCount <= 1000) return '201-1000';
  return '1000+';
}

/**
 * Map Apollo revenue to GHL bands
 */
function mapRevenue(revenueStr) {
  if (!revenueStr) return null;
  const revenue = parseInt(revenueStr, 10);
  if (revenue <= 500000) return '£0-500k';
  if (revenue <= 5000000) return '£500k-5m';
  if (revenue <= 50000000) return '£5m-50m';
  return '£50m+';
}

/**
 * Map Apollo deal status to GHL pipeline stages
 */
function mapDealStage(apolloStatus) {
  const statusMap = {
    'open': 'Discovery',
    'qualified': 'Qualified',
    'proposal': 'Proposal',
    'negotiating': 'Negotiation',
    'won': 'Won',
    'lost': 'Churn Risk',
    'closed': 'Won',
  };
  return statusMap[apolloStatus?.toLowerCase()] || 'Discovery';
}

/**
 * Generate GHL tags based on Apollo deal data
 */
function generateTags(apolloDeal) {
  const tags = ['warm-referral']; // All Apollo deals are warm leads

  // Tag by company size
  const size = apolloDeal.company?.num_employees;
  if (size >= 1000) tags.push('enterprise-budget');
  else if (size >= 200) tags.push('mid-market');
  else tags.push('smb-budget');

  // Tag by industry
  const industry = (apolloDeal.company?.industry || '').toLowerCase();
  if (industry.includes('saas')) tags.push('saas');
  else if (industry.includes('fintech') || industry.includes('finance')) tags.push('fintech');
  else if (industry.includes('ecommerce')) tags.push('ecommerce');
  else if (industry.includes('healthcare')) tags.push('healthcare');

  // Tag by deal status
  if (apolloDeal.status === 'qualified') tags.push('high-intent');
  if (apolloDeal.status === 'negotiating') tags.push('negotiating');
  if (apolloDeal.status === 'won') tags.push('won');

  return tags;
}

export {
  apolloFetch,
  getDeals,
  getDeal,
  updateDeal,
  getContact,
  enrichContactData,
  enrichOpportunityData,
  mapDealStage,
  generateTags,
};
