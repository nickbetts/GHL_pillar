import { post, del } from '../client.js';
import { LOCATION_ID } from '../config.js';

// ---------------------------------------------------------------------------
// i3MEDIA Tag Taxonomy (v1)
// Agency-specific engagement, service, and urgency tracking
//
// Tags in GHL are created dynamically when applied to contacts.
// We prime the library by creating a seed contact with all tags, then deleting it.
// ---------------------------------------------------------------------------

const ALL_TAGS = [
  // Deal Stage
  'discovery',
  'qualified',
  'scoping',
  'proposal-sent',
  'negotiating',
  'won',
  'post-launch',
  'churn-risk',

  // Service Interest
  '1st-touch-interested',
  'retargeting-interested',
  'nurture-interested',
  'seo-interested',
  'meta-andromeda-interested',
  'trust-sprint-interested',
  'website-design-interested',
  'paid-google-interested',
  'paid-meta-interested',
  'organic-social-interested',
  'ai-interested',
  'copywriting-interested',

  // Industry
  'saas',
  'fintech',
  'b2b-services',
  'ecommerce',
  'healthcare',

  // Budget Tier
  'enterprise-budget',
  'mid-market',
  'smb-budget',

  // Urgency
  'fast-track',
  'standard-cycle',
  'research-phase',

  // Engagement Quality
  'high-intent',
  'information-gathering',
  'warm-referral',
  'cold-outreach',

  // Experience
  'previous-agency-user',
  'agency-virgin',

  // Engagement Signals
  'webinar-attended',
  'content-downloaded',
];

export async function primeTags() {
  // Create seed contact with all tags
  let contactId;
  try {
    const res = await post('/contacts/', {
      locationId: LOCATION_ID,
      firstName: '__i3_tag_seed__',
      lastName: 'DELETE_ME',
      email: `tag-seed-${Date.now()}@i3-setup.invalid`,
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

  // Delete seed contact immediately (tags remain in library)
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
