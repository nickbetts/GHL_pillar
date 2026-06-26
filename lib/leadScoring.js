/**
 * Lead Scoring Automation
 * Calculates ICP Score (0-100) based on 12 scoring rules
 * Runs on: ContactCreate, ContactUpdate
 */

const SCORING_RULES = [
  {
    name: 'Annual Income £1m+',
    condition: (contact) => contact['Annual Income Band'] === '£1m+',
    score: 25,
  },
  {
    name: 'Annual Income £250k-£1m',
    condition: (contact) => contact['Annual Income Band'] === '£250k–£1m',
    score: 15,
  },
  {
    name: 'Decision Timeline Immediate',
    condition: (contact) => contact['Decision Timeline'] === 'Immediate',
    score: 20,
  },
  {
    name: 'Decision Timeline 1-3 months',
    condition: (contact) => contact['Decision Timeline'] === '1–3 months',
    score: 15,
  },
  {
    name: 'Budget Authority Yes',
    condition: (contact) => contact['Budget Authority'] === 'Yes',
    score: 20,
  },
  {
    name: 'Pain Points Compliance/Reporting',
    condition: (contact) => {
      const painPoints = contact['Primary Pain Points'] || '';
      return painPoints.includes('Compliance') || painPoints.includes('Reporting');
    },
    score: 10,
  },
  {
    name: 'Existing Customer',
    condition: (contact) => contact['Existing Customer'] === 'Yes',
    score: 30,
  },
  {
    name: 'Expansion Potential High',
    condition: (contact) => contact['Expansion Potential'] === 'High',
    score: 15,
  },
  {
    name: 'Content Downloaded',
    condition: (contact) => contact['Content Downloaded'] && contact['Content Downloaded'].trim() !== '',
    score: 10,
  },
  {
    name: 'Event Attended',
    condition: (contact) => contact['Event Attended'] && contact['Event Attended'].trim() !== '',
    score: 15,
  },
  {
    name: 'LinkedIn Profile Filled',
    condition: (contact) => contact['LinkedIn Profile URL'] && contact['LinkedIn Profile URL'].trim() !== '',
    score: 5,
  },
  {
    name: 'Target Sector Muslim',
    condition: (contact) => contact['Charity Sector'] === 'Muslim',
    score: 5,
  },
];

function calculateScore(contact) {
  let totalScore = 0;
  const matchedRules = [];

  SCORING_RULES.forEach((rule) => {
    try {
      if (rule.condition(contact)) {
        totalScore += rule.score;
        matchedRules.push(`${rule.name} (+${rule.score})`);
      }
    } catch (e) {
      // Skip rules that error
    }
  });

  const finalScore = Math.min(totalScore, 100);

  return {
    score: finalScore,
    matchedRules,
    totalScore,
  };
}

module.exports = {
  calculateScore,
  SCORING_RULES,
};
