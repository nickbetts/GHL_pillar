/**
 * Smart Auto-Tagging Rules
 * 8 rules that auto-apply tags based on contact attributes
 * Runs on: ContactCreate, ContactUpdate
 */

const TAGGING_RULES = [
  {
    name: 'Revenue-based Persona',
    condition: (contact) =>
      contact['Annual Income Band'] === '£1m+' &&
      contact['Governance Role'] === 'Fundraising Director',
    tags: ['fundraising-director', 'org-500plus', 'high-intent'],
  },
  {
    name: 'Tech Stack Pain Point',
    condition: (contact) => {
      const painPoints = contact['Primary Pain Points'] || '';
      return painPoints.includes('Spreadsheets') || painPoints.includes('Tool sprawl');
    },
    tags: ['high-intent', 'consideration-stage'],
  },
  {
    name: 'Charity Sector Tagging',
    condition: (contact) => contact['Charity Sector'] === 'Muslim',
    tags: ['mosque-org'],
  },
  {
    name: 'Engagement Trigger',
    condition: (contact) => {
      const downloaded = contact['Content Downloaded'] || '';
      const attended = contact['Event Attended'] || '';
      return (downloaded.trim() !== '') || (attended.trim() !== '');
    },
    tags: ['retargeting-warm', 'consideration-stage'],
  },
  {
    name: 'Form Abandonment Follow-up',
    condition: (contact) => contact['Form Abandonment Flag'] === 'Yes',
    tags: ['retargeting-warm'],
  },
  {
    name: 'Expansion Opportunity',
    condition: (contact) =>
      contact['Existing Customer'] === 'Yes' &&
      contact['Expansion Potential'] === 'High',
    tags: ['expansion', 'customer'],
  },
  {
    name: 'Case Study Alignment',
    condition: (contact) =>
      contact['Case Study Candidate'] === 'Yes' &&
      contact['Annual Income Band'] === '£250k–£1m',
    tags: ['case-study-candidate', 'trust-sprint'],
  },
  {
    name: 'Ramadan Campaign',
    condition: (contact) =>
      contact['Islamic Calendar Relevance'] === 'Yes' &&
      contact['Charity Sector'] === 'Muslim',
    tags: ['ramadan-campaign', 'islamic-calendar-relevant'],
  },
];

function getTagsToAdd(contact, currentTags = []) {
  const tagsToAdd = new Set();

  TAGGING_RULES.forEach((rule) => {
    try {
      if (rule.condition(contact)) {
        rule.tags.forEach((tag) => {
          if (!currentTags.includes(tag)) {
            tagsToAdd.add(tag);
          }
        });
      }
    } catch (e) {
      // Skip rules that error
    }
  });

  return Array.from(tagsToAdd);
}

module.exports = {
  getTagsToAdd,
  TAGGING_RULES,
};
