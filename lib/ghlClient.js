/**
 * Shared GHL API client for Vercel serverless functions
 * Handles authentication and common API operations
 */

const TOKEN = process.env.GHL_TOKEN;
const LOCATION_ID = process.env.GHL_LOCATION_ID;

async function ghlFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('https://services.leadconnectorhq.com/')
    ? endpoint
    : `https://services.leadconnectorhq.com${endpoint}`;
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
    const error = (await response.text()).slice(0, 500)
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
    throw new Error(`GHL API error (${response.status}): ${error}`);
  }

  return response.json();
}

async function getContact(contactId) {
  return ghlFetch(`/contacts/${contactId}`);
}

async function createContact(data) {
  return ghlFetch('/contacts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
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
  const endpointCandidates = [
    '/opportunities',
    '/opportunities/',
    data?.pipelineId ? `/opportunities/pipelines/${data.pipelineId}/opportunities` : null,
    data?.pipelineId ? `/pipelines/${data.pipelineId}/opportunities` : null,
    '/opportunities/upsert',
  ].filter(Boolean);

  const errors = [];

  for (const endpoint of endpointCandidates) {
    try {
      return await ghlFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    } catch (error) {
      const msg = String(error?.message || error);
      errors.push({ endpoint, message: msg });

      const retryable = /GHL API error \((404|405)\)/.test(msg);
      if (!retryable) {
        throw error;
      }
    }
  }

  throw new Error(`Opportunity create failed across endpoints: ${JSON.stringify(errors)}`);
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

function nextPageUrl(response) {
  return response?.meta?.nextPageUrl
    || response?.meta?.next_page_url
    || response?.nextPageUrl
    || response?.next_page_url
    || null;
}

async function listAll(firstPage, extract, maxPages = 100) {
  let page = firstPage;
  const data = [...extract(page)];
  let next = nextPageUrl(page);
  let pages = 1;
  while (next && pages < maxPages) {
    page = await ghlFetch(next);
    data.push(...extract(page));
    next = nextPageUrl(page);
    pages += 1;
  }
  if (next) throw new Error(`GHL pagination exceeded ${maxPages} pages`);
  return { data, meta: page?.meta || null, pages };
}

async function listAllContacts(filters = {}) {
  const params = new URLSearchParams({ locationId: LOCATION_ID, limit: 100, ...filters });
  const first = await ghlFetch(`/contacts?${params.toString()}`);
  return listAll(first, (page) => page.contacts || page.data || []);
}

async function listAllOpportunities(filters = {}) {
  const params = new URLSearchParams({ locationId: LOCATION_ID, limit: 100, ...filters });
  const first = await ghlFetch(`/opportunities/search?${params.toString()}`);
  return listAll(first, (page) => page.opportunities || page.data || []);
}

export {
  ghlFetch,
  getContact,
  createContact,
  updateContact,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
  listContacts,
  listOpportunities,
  listAllContacts,
  listAllOpportunities,
  LOCATION_ID,
};
