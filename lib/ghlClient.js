/**
 * Shared GHL API client for Vercel serverless functions
 * Handles authentication and common API operations
 */

const TOKEN = process.env.GHL_TOKEN;
const LOCATION_ID = process.env.GHL_LOCATION_ID;

async function ghlFetch(endpoint, options = {}) {
  const url = `https://services.leadconnectorhq.com${endpoint}`;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'Version': 'v3',
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GHL API error (${response.status}): ${error}`);
  }

  return response.json();
}

async function getContact(contactId) {
  return ghlFetch(`/contacts/${contactId}`);
}

async function updateContact(contactId, data) {
  return ghlFetch(`/contacts/${contactId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

async function getOpportunity(opportunityId) {
  return ghlFetch(`/opportunities/${opportunityId}`);
}

async function createOpportunity(data) {
  return ghlFetch('/opportunities', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

async function updateOpportunity(opportunityId, data) {
  return ghlFetch(`/opportunities/${opportunityId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

async function listContacts(filters = {}) {
  const params = new URLSearchParams({
    locationId: LOCATION_ID,
    ...filters,
  });
  const response = await ghlFetch(`/contacts?${params.toString()}`);
  return {
    data: response.contacts || response.data || [],
    meta: response.meta || null,
    raw: response,
  };
}

async function listOpportunities(filters = {}) {
  const params = new URLSearchParams({
    locationId: LOCATION_ID,
    ...filters,
  });
  const response = await ghlFetch(`/opportunities/search?${params.toString()}`);
  return {
    data: response.opportunities || response.data || [],
    meta: response.meta || null,
    raw: response,
  };
}

module.exports = {
  ghlFetch,
  getContact,
  updateContact,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
  listContacts,
  listOpportunities,
  LOCATION_ID,
};
