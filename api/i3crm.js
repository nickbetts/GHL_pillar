const {
  listContacts,
  listOpportunities,
  createContact,
  createOpportunity,
  updateOpportunity,
  getContact,
} = require('../lib/ghlClient');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildPipelineSummary(opportunities) {
  const stages = {};

  for (const opp of opportunities) {
    const stage = opp.stage || 'Unknown';
    const value = toNumber(opp.monetaryValue, 0);

    if (!stages[stage]) {
      stages[stage] = { stage, count: 0, value: 0 };
    }

    stages[stage].count += 1;
    stages[stage].value += value;
  }

  const ordered = Object.values(stages).sort((a, b) => b.count - a.count);
  const totalValue = ordered.reduce((sum, s) => sum + s.value, 0);
  const totalCount = ordered.reduce((sum, s) => sum + s.count, 0);

  return {
    totalCount,
    totalValue,
    stages: ordered,
  };
}

async function handleRead(entity, limit) {
  if (entity === 'contacts') {
    const contacts = await listContacts({ limit: String(limit) });
    return {
      entity,
      count: contacts.data.length,
      data: contacts.data,
    };
  }

  if (entity === 'opportunities') {
    const opportunities = await listOpportunities({ limit: String(limit) });
    return {
      entity,
      count: opportunities.data.length,
      data: opportunities.data,
    };
  }

  if (entity === 'pipeline') {
    const opportunities = await listOpportunities({ limit: String(limit) });
    return {
      entity,
      ...buildPipelineSummary(opportunities.data),
    };
  }

  throw new Error('Unsupported entity. Use contacts, opportunities, or pipeline.');
}

async function handleCreate(body) {
  const { action } = body || {};

  if (action === 'createContact') {
    const { firstName, lastName, email, phone, companyName, tags } = body;

    if (!firstName || !lastName) {
      throw new Error('firstName and lastName are required');
    }

    const created = await createContact({
      firstName,
      lastName,
      email,
      phone,
      companyName,
      tags: Array.isArray(tags) ? tags : [],
    });

    return { action, created };
  }

  if (action === 'createOpportunity') {
    const { contactId, name, stage = 'Lead', monetaryValue = 0 } = body;

    if (!contactId || !name) {
      throw new Error('contactId and name are required');
    }

    const contact = await getContact(contactId);

    const created = await createOpportunity({
      contactId,
      name,
      stage,
      monetaryValue: toNumber(monetaryValue, 0),
      pipelineId: process.env.GHL_PIPELINE_ID,
      assignedTo: process.env.GHL_DEFAULT_OWNER,
      customFields: {
        Persona: contact['Governance Role'],
        'Org Size Band': contact['Annual Income Band'],
        'Lead Source Channel': contact['UTM Source'] || 'Direct',
      },
    });

    return { action, created };
  }

  throw new Error('Unsupported action. Use createContact or createOpportunity.');
}

async function handleUpdate(body) {
  const { action } = body || {};

  if (action === 'updateOpportunityStage') {
    const { opportunityId, stage } = body;
    if (!opportunityId || !stage) {
      throw new Error('opportunityId and stage are required');
    }

    const updated = await updateOpportunity(opportunityId, { stage });
    return { action, updated };
  }

  throw new Error('Unsupported update action. Use updateOpportunityStage.');
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const entity = (req.query.entity || 'pipeline').toLowerCase();
      const limit = Math.min(toNumber(req.query.limit, 50), 100);
      const result = await handleRead(entity, limit);
      return res.status(200).json(result);
    }

    if (req.method === 'POST') {
      const result = await handleCreate(req.body || {});
      return res.status(200).json(result);
    }

    if (req.method === 'PATCH') {
      const result = await handleUpdate(req.body || {});
      return res.status(200).json(result);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[i3CRM API Error]:', error);
    return res.status(500).json({ error: error.message });
  }
}
