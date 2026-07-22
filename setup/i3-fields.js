import { get, post } from '../client.js';
import { LOCATION_ID } from '../config.js';

// ---------------------------------------------------------------------------
// i3MEDIA Contact & Opportunity Field Definitions (v1)
// Optimized for B2B agency client management and campaign tracking
// ---------------------------------------------------------------------------

const CONTACT_FIELDS = [
  // ── Company Profile ──────────────────────────────────────────────────
  {
    name: 'Company Size Band',
    dataType: 'SINGLE_OPTIONS',
    options: ['1-50', '51-200', '201-1000', '1000+'],
  },
  {
    name: 'Industry Vertical',
    dataType: 'SINGLE_OPTIONS',
    options: ['SaaS', 'FinTech', 'B2B Services', 'Ecommerce', 'Healthcare', 'Other'],
  },
  {
    name: 'Estimated Annual Revenue',
    dataType: 'SINGLE_OPTIONS',
    options: ['£0-500k', '£500k-5m', '£5m-50m', '£50m+'],
  },
  {
    name: 'Marketing Budget Range',
    dataType: 'SINGLE_OPTIONS',
    options: ['£10k-50k', '£50k-250k', '£250k-1m', '£1m+'],
  },

  // ── Campaign Engagement ──────────────────────────────────────────────
  {
    name: 'Primary Acquisition Channel',
    dataType: 'SINGLE_OPTIONS',
    options: ['Organic', 'Paid Ads', 'Events', 'Referral', 'Inbound'],
  },
  {
    name: 'Interested Service Line',
    dataType: 'MULTIPLE_OPTIONS',
    options: ['1st Touch', 'Retargeting', 'Nurture', 'SEO', 'Meta Andromeda', 'Trust Sprint'],
  },
  {
    name: 'Campaign Launch Timeline',
    dataType: 'SINGLE_OPTIONS',
    options: ['Immediate', '1-3 months', '3-6 months', '6+ months'],
  },
  {
    name: 'Previous Agency Experience',
    dataType: 'RADIO',
    options: ['Yes', 'No'],
  },
  {
    name: 'Key Pain Point',
    dataType: 'SINGLE_OPTIONS',
    options: ['Lead quality', 'Volume', 'Conversion rate', 'Brand awareness', 'Competitor pressure'],
  },

  // ── Engagement Tracking ──────────────────────────────────────────────
  {
    name: 'Webinar/Event Attendance',
    dataType: 'TEXT',
    placeholder: 'Event name + date',
  },
  {
    name: 'Content Downloaded',
    dataType: 'MULTIPLE_OPTIONS',
    options: ['Whitepaper', 'Case Study', 'ROI Calculator', 'Other'],
  },

  // ── Execution Flags ──────────────────────────────────────────────────
  {
    name: 'Assigned Account Manager',
    dataType: 'TEXT',
    placeholder: 'Team member name',
  },
  {
    name: 'Project Status',
    dataType: 'SINGLE_OPTIONS',
    options: ['Discovery', 'Scoping', 'In Progress', 'Post-Launch', 'Paused'],
  },
  {
    name: 'Next Milestone',
    dataType: 'TEXT',
    placeholder: 'e.g. Proposal, Kickoff, Content Review, Launch, Review Call',
  },
  {
    name: 'Expected Contract Value',
    dataType: 'NUMERICAL',
    placeholder: 'Amount in GBP (e.g. 25000)',
  },
];

const OPPORTUNITY_FIELDS = [
  {
    name: 'Service Packages',
    dataType: 'MULTIPLE_OPTIONS',
    options: ['Website Design', 'Paid Google', 'Paid Meta', 'Organic Social', 'SEO', 'AI', 'Copywriting'],
  },
  {
    name: 'Contract Length',
    dataType: 'SINGLE_OPTIONS',
    options: ['3 months', '6 months', '12 months', 'Other'],
  },
  {
    name: 'Strategic Goal',
    dataType: 'LARGE_TEXT',
    placeholder: 'e.g. Generate 50+ MQLs/month, Increase conversion by 20%, etc.',
  },
  {
    name: 'Integration Required',
    dataType: 'SINGLE_OPTIONS',
    options: ['HubSpot', 'Salesforce', 'Marketo', 'None'],
  },
  {
    name: 'Apollo Deal ID',
    dataType: 'TEXT',
    placeholder: 'Auto-populated from Apollo sync',
  },
];

// ---------------------------------------------------------------------------
// Implementation Functions
// ---------------------------------------------------------------------------

async function getExistingFields(model) {
  const data = await get(`/locations/${LOCATION_ID}/customFields`, { model });
  return data?.customFields ?? [];
}

async function createFields(definitions, model) {
  const existing = await getExistingFields(model);
  const existingNames = new Set(existing.map((f) => f.name.toLowerCase()));

  const results = { created: [], skipped: [], failed: [] };

  for (const def of definitions) {
    if (existingNames.has(def.name.toLowerCase())) {
      results.skipped.push(def.name);
      continue;
    }

    try {
      await post(`/locations/${LOCATION_ID}/customFields`, {
        ...def,
        model,
        position: 0,
      });
      results.created.push(def.name);
    } catch (err) {
      results.failed.push({ name: def.name, error: err.message });
    }
  }

  return results;
}

export async function setupContactFields() {
  return createFields(CONTACT_FIELDS, 'contact');
}

export async function setupOpportunityFields() {
  return createFields(OPPORTUNITY_FIELDS, 'opportunity');
}
