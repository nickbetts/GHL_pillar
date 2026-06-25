import { get, post } from '../client.js';
import { LOCATION_ID } from '../config.js';

// ---------------------------------------------------------------------------
// Field definitions
// GHL v3 dataTypes (confirmed from live API validation):
//   TEXT, LARGE_TEXT, NUMERICAL, PHONE, MONETORY, CHECKBOX,
//   SINGLE_OPTIONS, MULTIPLE_OPTIONS, FLOAT, TIME, DATE,
//   TEXTBOX_LIST, FILE_UPLOAD, SIGNATURE, RADIO
// For RADIO / SINGLE_OPTIONS / MULTIPLE_OPTIONS: provide `options` array
// ---------------------------------------------------------------------------

const CONTACT_FIELDS = [
  {
    name: 'Charity Registration Number',
    dataType: 'TEXT',
    placeholder: 'e.g. 1234567',
  },
  {
    name: 'Annual Income Band',
    dataType: 'RADIO',
    options: ['<£50k', '£50k–£250k', '£250k–£1m', '£1m+'],
  },
  {
    name: 'Charity Sector',
    dataType: 'SINGLE_OPTIONS',
    options: ['Muslim', 'Church', 'Animal', 'Community', 'Hospice', 'School', 'Membership', 'Other'],
  },
  {
    name: 'Current Tech Stack',
    dataType: 'LARGE_TEXT',
    placeholder: 'e.g. Salesforce, JustGiving, Mailchimp, spreadsheets…',
  },
  {
    name: 'Primary Pain Points',
    dataType: 'MULTIPLE_OPTIONS',
    options: ['Spreadsheets', 'Tool sprawl', 'Compliance', 'Reporting', 'Fundraising', 'Website'],
  },
  {
    name: 'Governance Role',
    dataType: 'SINGLE_OPTIONS',
    options: ['Founder', 'CEO', 'Operations Manager', 'Fundraising Director', 'Digital Lead', 'Volunteer'],
  },
  {
    name: 'Decision Timeline',
    dataType: 'RADIO',
    options: ['Immediate', '1–3 months', '3–6 months', '6+ months'],
  },
  {
    name: 'Budget Authority',
    dataType: 'RADIO',
    options: ['Yes', 'Partial', 'No'],
  },
  {
    name: 'LinkedIn Profile URL',
    dataType: 'TEXT',
    placeholder: 'https://linkedin.com/in/…',
  },
  {
    name: 'Content Downloaded',
    dataType: 'LARGE_TEXT',
    placeholder: 'List guides, reports, or assets downloaded',
  },
  {
    name: 'Event Attended',
    dataType: 'TEXT',
    placeholder: 'e.g. CIOF North West 2026',
  },
  {
    name: 'Form Abandonment Flag',
    dataType: 'RADIO',
    options: ['Yes', 'No'],
  },
  {
    name: 'Existing Customer',
    dataType: 'RADIO',
    options: ['Yes', 'No'],
  },
  {
    name: 'Expansion Potential',
    dataType: 'RADIO',
    options: ['Low', 'Medium', 'High'],
  },

  // --- Nurture & sequence tracking (v2 gap analysis) ---
  {
    name: 'Nurture Track',
    dataType: 'SINGLE_OPTIONS',
    options: ['High-Intent', 'Research-Stage', 'Warm-Proof', 'Customer-Expansion', 'Lapse-Reactivation'],
  },
  {
    name: 'Email Sequence Step',
    dataType: 'NUMERICAL',
    placeholder: 'e.g. 3',
  },

  // --- Attribution / UTM (v2 gap analysis) ---
  {
    name: 'UTM Source',
    dataType: 'TEXT',
    placeholder: 'e.g. google, linkedin, newsletter',
  },
  {
    name: 'UTM Medium',
    dataType: 'TEXT',
    placeholder: 'e.g. cpc, organic, email',
  },
  {
    name: 'UTM Campaign',
    dataType: 'TEXT',
    placeholder: 'e.g. ramadan-2026, bofu-competitor',
  },

  // --- Social proof & trust sprint (v2 gap analysis) ---
  {
    name: 'Case Study Candidate',
    dataType: 'RADIO',
    options: ['Yes', 'No'],
  },
  {
    name: 'Reference Customer',
    dataType: 'RADIO',
    options: ['Yes', 'No'],
  },
  {
    name: 'Review Status',
    dataType: 'SINGLE_OPTIONS',
    options: ['Not Asked', 'Asked', 'Submitted — G2', 'Submitted — Capterra', 'Published — G2', 'Published — Capterra'],
  },

  // --- Segmentation signals (v2 gap analysis) ---
  {
    name: 'Islamic Calendar Relevance',
    dataType: 'RADIO',
    options: ['Yes', 'No'],
  },
  {
    name: 'ICP Score',
    dataType: 'NUMERICAL',
    placeholder: '0–100',
  },
  // --- Form capture (v3 — matches website demo form) ---
  {
    name: 'Demo Priority',
    dataType: 'MULTIPLE_OPTIONS',
    options: [
      'Donor Management',
      'Donor Communications',
      'New Website',
      'Fundraising Tools',
      'Migrate from CRM',
      'Not Sure Yet',
    ],
  },];

const OPPORTUNITY_FIELDS = [
  {
    name: 'Lead Source Channel',
    dataType: 'SINGLE_OPTIONS',
    options: ['SEO Organic', 'Google Ads', 'LinkedIn Ads', 'LinkedIn Organic', 'LinkedIn Retargeting', 'Google Interception', 'Meta Retargeting', 'Events / PR', 'Referral'],
  },
  {
    name: 'Persona',
    dataType: 'SINGLE_OPTIONS',
    options: ['Ops Manager', 'Fundraising Director', 'Digital Lead', 'Founder', 'Volunteer-led', 'Faith Org'],
  },
  {
    name: 'Org Size Band',
    dataType: 'RADIO',
    options: ['<£50k', '£50k–£250k', '£250k–£1m', '£1m+'],
  },
  // --- Competitor intelligence (v2 gap analysis) ---
  {
    name: 'Competitor Displacing',
    dataType: 'SINGLE_OPTIONS',
    options: ['Spreadsheets', 'Salesforce NPSP', 'Donorfy', 'Beacon CRM', 'JustGiving', 'Enthuse', 'Other'],
  },
];

// ---------------------------------------------------------------------------
// Create logic
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
