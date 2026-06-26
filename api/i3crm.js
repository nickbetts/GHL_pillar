const {
  listContacts,
  listOpportunities,
  createContact,
  createOpportunity,
  updateOpportunity,
  getContact,
  updateContact,
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

function containsCaseInsensitive(haystack, needle) {
  if (!needle) return true;
  return String(haystack || '').toLowerCase().includes(String(needle).toLowerCase());
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildActivityFeed(contacts, opportunities, limit) {
  const contactEvents = contacts.map((c) => ({
    type: 'contact',
    id: c.id,
    title: `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || 'Unknown Contact',
    detail: c.companyName || c.email || '',
    timestamp: c.updatedAt || c.createdAt || null,
  }));

  const opportunityEvents = opportunities.map((o) => ({
    type: 'opportunity',
    id: o.id,
    title: o.name || 'Unnamed Opportunity',
    detail: `Stage: ${o.stage || 'Unknown'}`,
    timestamp: o.updatedAt || o.createdAt || null,
  }));

  return [...contactEvents, ...opportunityEvents]
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .slice(0, limit);
}

async function handleRead(entity, limit, query = {}) {
  if (entity === 'contacts') {
    const contacts = await listContacts({ limit: String(limit) });
    let data = contacts.data;

    if (query.q) {
      data = data.filter((c) => {
        const fullName = `${c.firstName || ''} ${c.lastName || ''}`;
        return (
          containsCaseInsensitive(fullName, query.q) ||
          containsCaseInsensitive(c.email, query.q) ||
          containsCaseInsensitive(c.companyName, query.q)
        );
      });
    }

    if (query.company) {
      data = data.filter((c) => containsCaseInsensitive(c.companyName, query.company));
    }

    if (query.tag) {
      data = data.filter((c) => asArray(c.tags).some((t) => containsCaseInsensitive(t, query.tag)));
    }

    return {
      entity,
      count: data.length,
      data,
    };
  }

  if (entity === 'opportunities') {
    const opportunities = await listOpportunities({ limit: String(limit) });
    let data = opportunities.data;

    if (query.q) {
      data = data.filter((o) => containsCaseInsensitive(o.name, query.q));
    }

    if (query.stage) {
      data = data.filter((o) => String(o.stage || '').toLowerCase() === String(query.stage).toLowerCase());
    }

    if (query.assignedTo) {
      data = data.filter((o) => String(o.assignedTo || '') === String(query.assignedTo));
    }

    return {
      entity,
      count: data.length,
      data,
    };
  }

  if (entity === 'pipeline') {
    const opportunities = await listOpportunities({ limit: String(limit) });
    return {
      entity,
      ...buildPipelineSummary(opportunities.data),
    };
  }

  if (entity === 'activity') {
    const [contacts, opportunities] = await Promise.all([
      listContacts({ limit: String(limit) }),
      listOpportunities({ limit: String(limit) }),
    ]);

    return {
      entity,
      count: limit,
      data: buildActivityFeed(contacts.data, opportunities.data, limit),
    };
  }

  throw new Error('Unsupported entity. Use contacts, opportunities, pipeline, or activity.');
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

  if (action === 'appendContactNote') {
    const { contactId, note } = body;
    if (!contactId || !note) {
      throw new Error('contactId and note are required');
    }

    const contact = await getContact(contactId);
    const existingNotes = contact.notes || '';
    const stampedNote = `[i3CRM ${new Date().toISOString()}] ${note}`;
    const nextNotes = existingNotes ? `${existingNotes}\n\n${stampedNote}` : stampedNote;
    const updated = await updateContact(contactId, { notes: nextNotes });
    return { action, updated };
  }

  throw new Error('Unsupported update action. Use updateOpportunityStage or appendContactNote.');
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const entity = (req.query.entity || 'pipeline').toLowerCase();
      const limit = Math.min(toNumber(req.query.limit, 50), 100);
      const result = await handleRead(entity, limit, req.query || {});
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
