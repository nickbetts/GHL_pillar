import { post, del } from '../client.js';
import { LOCATION_ID } from '../config.js';

// ---------------------------------------------------------------------------
// Full Pillar tag taxonomy
// Tags in GHL are created dynamically when applied to contacts.
// We prime the library by creating a seed contact with all tags, then deleting it.
// ---------------------------------------------------------------------------

export const ALL_TAGS = [
  // Persona
  'ops-manager',
  'fundraising-director',
  'digital-lead',
  'founder',
  'volunteer-led',
  'faith-org',

  // Organisation type
  'mosque-org',
  'church-org',
  'animal-charity',
  'community-group',
  'hospice',
  'school',
  'membership-org',

  // Organisation size
  'org-1-50',
  'org-50-200',
  'org-200-500',
  'org-500plus',

  // Funnel stage
  '1st-touch',
  'retargeting-warm',
  'consideration-stage',
  'high-intent',
  'demo-scheduled',
  'customer',
  'expansion',
  'churn-risk',

  // Lead source channel
  'seo-organic',
  'google-ads-bofu',
  'linkedin-ads',
  'linkedin-organic',
  'linkedin-retargeting',
  'google-interception',
  'meta-retargeting',
  'events-pr',
  'referral',

  // Nurture tracks (v2 gap analysis)
  'nurture-high-intent',
  'nurture-research-stage',
  'nurture-warm-proof',
  'nurture-customer-expansion',
  'nurture-lapse-reactivation',

  // Social proof & trust sprint (v2 gap analysis)
  'case-study-candidate',
  'reference-customer',
  'trust-sprint',
  'reviewed-g2',
  'reviewed-capterra',

  // Campaign & event signals (v2 gap analysis)
  'event-intercept',
  'ramadan-campaign',

  // Competitor signals (v2 gap analysis)
  'competitor-salesforce',
  'competitor-donorfy',
  'competitor-beacon',
];

export async function primeTags() {
  // Create seed contact with all tags
  let contactId;
  try {
    const res = await post('/contacts/', {
      locationId: LOCATION_ID,
      firstName: '__pillar_tag_seed__',
      lastName: 'DELETE_ME',
      email: `tag-seed-${Date.now()}@pillar-setup.invalid`,
      tags: ALL_TAGS,
      source: 'api setup',
    });
    contactId = res?.contact?.id;
  } catch (err) {
    return { ok: false, error: `Failed to create seed contact: ${err.message}` };
  }

  if (!contactId) {
    return { ok: false, error: 'Seed contact created but no ID returned — tags may not be primed' };
  }

  // Delete seed contact immediately
  try {
    await del(`/contacts/${contactId}`);
  } catch {
    // Non-fatal — log but continue
    return {
      ok: true,
      warned: true,
      warning: `Tags primed (${ALL_TAGS.length} tags) but seed contact ${contactId} could not be auto-deleted. Delete it manually in GHL → Contacts.`,
    };
  }

  return { ok: true, count: ALL_TAGS.length };
}
