/**
 * Contact Deduplication API
 * Detects and merges duplicate contacts
 * Endpoint: /api/dedup.js
 * Call via: curl -X POST https://your-domain.vercel.app/api/dedup
 */

const { listContacts, getContact, updateContact } = require('../lib/ghlClient');

function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len2 + 1)
    .fill(null)
    .map(() => Array(len1 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[0][i] = i;
  for (let j = 0; j <= len2; j++) matrix[j][0] = j;

  for (let j = 1; j <= len2; j++) {
    for (let i = 1; i <= len1; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }

  return matrix[len2][len1];
}

function calculateSimilarity(str1, str2) {
  const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
  const maxLen = Math.max(str1.length, str2.length);
  return ((maxLen - distance) / maxLen) * 100;
}

async function findDuplicates() {
  const contacts = await listContacts({ limit: 100 });
  const duplicates = [];

  if (!contacts.data || contacts.data.length === 0) {
    return { duplicates: [], count: 0 };
  }

  // 1. Find exact email matches
  const emailMap = {};
  contacts.data.forEach((contact) => {
    if (contact.email) {
      if (!emailMap[contact.email]) {
        emailMap[contact.email] = [];
      }
      emailMap[contact.email].push(contact);
    }
  });

  Object.values(emailMap).forEach((group) => {
    if (group.length > 1) {
      const primary = group.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      const secondaries = group.filter((c) => c.id !== primary.id);
      duplicates.push({
        type: 'exact_email',
        primary: primary.id,
        secondaries: secondaries.map((c) => c.id),
        email: primary.email,
        confidence: 'high',
      });
    }
  });

  // 2. Find exact phone matches
  const phoneMap = {};
  contacts.data.forEach((contact) => {
    if (contact.phone) {
      if (!phoneMap[contact.phone]) {
        phoneMap[contact.phone] = [];
      }
      phoneMap[contact.phone].push(contact);
    }
  });

  Object.values(phoneMap).forEach((group) => {
    if (group.length > 1) {
      const primary = group.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      const secondaries = group.filter((c) => c.id !== primary.id);
      duplicates.push({
        type: 'exact_phone',
        primary: primary.id,
        secondaries: secondaries.map((c) => c.id),
        phone: primary.phone,
        confidence: 'high',
      });
    }
  });

  // 3. Find fuzzy name + company matches
  for (let i = 0; i < contacts.data.length; i++) {
    for (let j = i + 1; j < contacts.data.length; j++) {
      const c1 = contacts.data[i];
      const c2 = contacts.data[j];

      if (c1.companyName && c2.companyName && c1.companyName === c2.companyName) {
        const nameSimilarity = calculateSimilarity(
          `${c1.firstName} ${c1.lastName}`,
          `${c2.firstName} ${c2.lastName}`
        );

        if (nameSimilarity > 85) {
          const primary = new Date(c1.createdAt) > new Date(c2.createdAt) ? c1 : c2;
          const secondary = primary === c1 ? c2 : c1;

          duplicates.push({
            type: 'fuzzy_name_company',
            primary: primary.id,
            secondaries: [secondary.id],
            similarity: Math.round(nameSimilarity),
            confidence: 'medium',
          });
        }
      }
    }
  }

  return {
    duplicates,
    count: duplicates.length,
  };
}

async function mergeDuplicates(primaryId, secondaryId) {
  const primary = await getContact(primaryId);
  const secondary = await getContact(secondaryId);

  // Combine tags
  const combinedTags = Array.from(new Set([...(primary.tags || []), ...(secondary.tags || [])]));

  // Combine notes
  const primaryNotes = primary.notes || '';
  const secondaryNotes = secondary.notes || '';
  const combinedNotes = `${primaryNotes}\n\n[Merged from ${secondary.id}]\n${secondaryNotes}`;

  // Update primary with combined data
  await updateContact(primaryId, {
    tags: combinedTags,
    notes: combinedNotes,
  });

  // Mark secondary as merged (optional: could also delete)
  await updateContact(secondaryId, {
    notes: `MERGED INTO ${primaryId}`,
    tags: [...(secondary.tags || []), 'merged'],
  });

  console.log(`[Dedup] Merged ${secondaryId} into ${primaryId}`);
  return { primary: primaryId, secondary: secondaryId, status: 'merged' };
}

export default async function handler(req, res) {
  if (req.method === 'POST' && req.query.action === 'merge') {
    // Merge specific duplicates
    const { primary, secondary } = req.body;
    try {
      const result = await mergeDuplicates(primary, secondary);
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  } else {
    // Find duplicates
    try {
      const result = await findDuplicates();
      res.status(200).json(result);
    } catch (error) {
      console.error('[Dedup Error]:', error);
      res.status(500).json({ error: error.message });
    }
  }
}
