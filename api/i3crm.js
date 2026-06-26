const {
  listContacts,
  listOpportunities,
  createContact,
  createOpportunity,
  updateOpportunity,
  getContact,
  updateContact,
  ghlFetch,
  LOCATION_ID,
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

function uniqSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
}

function extractTopLevelFields(records) {
  const fieldSet = new Set();
  records.forEach((record) => {
    Object.keys(record || {}).forEach((key) => fieldSet.add(key));
  });
  return uniqSorted(Array.from(fieldSet));
}

function extractCustomFieldKeys(records) {
  const customSet = new Set();
  records.forEach((record) => {
    const cf = record?.customFields;
    if (cf && typeof cf === 'object' && !Array.isArray(cf)) {
      Object.keys(cf).forEach((k) => customSet.add(k));
    }
  });
  return uniqSorted(Array.from(customSet));
}

function derivePipelineStages(opportunities) {
  const fromData = uniqSorted((opportunities || []).map((o) => o?.stage));
  if (fromData.length > 0) return fromData;
  return ['Lead'];
}

function normalizeCustomFieldDefs(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.customFields)) return payload.customFields;
  if (Array.isArray(payload.fields)) return payload.fields;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function toFieldName(def) {
  return def?.name || def?.label || def?.fieldKey || def?.key || null;
}

function toFieldModel(def) {
  return String(def?.model || def?.object || def?.entity || def?.resource || def?.group || '').toLowerCase();
}

async function getConfiguredCustomFields() {
  const endpointCandidates = [
    `/opportunities/customFields?locationId=${LOCATION_ID}`,
    `/opportunities/custom-fields?locationId=${LOCATION_ID}`,
    `/customFields/opportunities?locationId=${LOCATION_ID}`,
    `/locations/${LOCATION_ID}/customFields`,
    `/custom-fields?locationId=${LOCATION_ID}`,
    `/customFields?locationId=${LOCATION_ID}`,
  ];

  for (const endpoint of endpointCandidates) {
    try {
      const raw = await ghlFetch(endpoint);
      const defs = normalizeCustomFieldDefs(raw);
      if (defs.length === 0) continue;

      const contactCustom = uniqSorted(defs
        .filter((d) => {
          const model = toFieldModel(d);
          return model.includes('contact') || model.includes('lead') || model === '';
        })
        .map(toFieldName));

      const opportunityCustom = uniqSorted(defs
        .filter((d) => {
          const model = toFieldModel(d);
          return model.includes('opportun') || model.includes('deal') || model === '';
        })
        .map(toFieldName));

      return {
        contactCustom,
        opportunityCustom,
        source: `ghl-config:${endpoint}`,
      };
    } catch (error) {
      // Try next endpoint candidate silently.
    }
  }

  return {
    contactCustom: [],
    opportunityCustom: [],
    source: 'fallback',
  };
}

function extractStageNamesFromUnknownShape(payload, targetPipelineId) {
  const candidates = [];

  if (!payload) return [];

  if (Array.isArray(payload)) {
    candidates.push(...payload);
  } else {
    if (Array.isArray(payload.pipelines)) candidates.push(...payload.pipelines);
    if (Array.isArray(payload.data)) candidates.push(...payload.data);
    if (payload.pipeline) candidates.push(payload.pipeline);
    if (payload.id || payload.stages || payload.pipelineStages || payload.opportunityStages) {
      candidates.push(payload);
    }
  }

  const normalized = candidates.find((p) => String(p?.id || p?._id || '') === String(targetPipelineId)) || candidates[0];
  if (!normalized) return [];

  const stageBuckets = [
    normalized.stages,
    normalized.pipelineStages,
    normalized.opportunityStages,
    normalized.data?.stages,
  ];

  const stages = stageBuckets.find((bucket) => Array.isArray(bucket)) || [];
  return uniqSorted(stages.map((s) => s?.name || s?.title || s?.stage || s?.label));
}

async function getConfiguredPipelineStages() {
  const targetPipelineId = process.env.GHL_PIPELINE_ID;

  const endpointCandidates = [
    targetPipelineId ? `/opportunities/pipelines/${targetPipelineId}?locationId=${LOCATION_ID}` : null,
    `/opportunities/pipelines?locationId=${LOCATION_ID}`,
    targetPipelineId ? `/pipelines/${targetPipelineId}?locationId=${LOCATION_ID}` : null,
    `/pipelines?locationId=${LOCATION_ID}`,
  ].filter(Boolean);

  for (const endpoint of endpointCandidates) {
    try {
      const raw = await ghlFetch(endpoint);
      const stages = extractStageNamesFromUnknownShape(raw, targetPipelineId);
      if (stages.length > 0) {
        return {
          stages,
          source: `ghl-config:${endpoint}`,
          pipelineId: targetPipelineId || null,
        };
      }
    } catch (error) {
      // Try next endpoint candidate silently.
    }
  }

  return {
    stages: [],
    source: 'fallback',
    pipelineId: targetPipelineId || null,
  };
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

  if (entity === 'schema') {
    const [contacts, opportunities] = await Promise.all([
      listContacts({ limit: String(limit) }),
      listOpportunities({ limit: String(limit) }),
    ]);

    const configuredPipeline = await getConfiguredPipelineStages();
    const configuredCustomFields = await getConfiguredCustomFields();
    const resolvedStages = configuredPipeline.stages.length > 0
      ? configuredPipeline.stages
      : derivePipelineStages(opportunities.data);

    const extractedContactCustom = extractCustomFieldKeys(contacts.data);
    const extractedOppCustom = extractCustomFieldKeys(opportunities.data);

    const mergedContactCustom = uniqSorted([
      ...configuredCustomFields.contactCustom,
      ...extractedContactCustom,
    ]);
    const mergedOppCustom = uniqSorted([
      ...configuredCustomFields.opportunityCustom,
      ...extractedOppCustom,
    ]);

    return {
      entity,
      stages: resolvedStages,
      stagesSource: configuredPipeline.stages.length > 0 ? configuredPipeline.source : 'derived-from-opportunities',
      pipelineId: configuredPipeline.pipelineId,
      contactFields: extractTopLevelFields(contacts.data),
      contactCustomFields: mergedContactCustom,
      contactCustomFieldsSource: configuredCustomFields.contactCustom.length > 0 ? configuredCustomFields.source : 'derived-from-contacts',
      opportunityFields: extractTopLevelFields(opportunities.data),
      opportunityCustomFields: mergedOppCustom,
      opportunityCustomFieldsSource: configuredCustomFields.opportunityCustom.length > 0 ? configuredCustomFields.source : 'derived-from-opportunities',
    };
  }

  throw new Error('Unsupported entity. Use contacts, opportunities, pipeline, activity, or schema.');
}

async function handleCreate(body) {
  const { action } = body || {};

  if (action === 'createContact') {
    const { firstName, lastName, email, phone, companyName, tags, fields } = body;

    if (!firstName || !lastName) {
      throw new Error('firstName and lastName are required');
    }

    const basePayload = {
      firstName,
      lastName,
      email,
      phone,
      companyName,
      tags: Array.isArray(tags) ? tags : [],
    };

    const created = await createContact({
      ...basePayload,
      ...(fields && typeof fields === 'object' ? fields : {}),
    });

    return { action, created };
  }

  if (action === 'createOpportunity') {
    const { contactId, name, stage, monetaryValue = 0, fields, customFields } = body;

    if (!contactId || !name) {
      throw new Error('contactId and name are required');
    }

    const contact = await getContact(contactId);

    const defaultStage = stage || 'Lead';
    const baseCustomFields = {
      Persona: contact['Governance Role'],
      'Org Size Band': contact['Annual Income Band'],
      'Lead Source Channel': contact['UTM Source'] || 'Direct',
    };

    const created = await createOpportunity({
      contactId,
      name,
      stage: defaultStage,
      monetaryValue: toNumber(monetaryValue, 0),
      pipelineId: process.env.GHL_PIPELINE_ID,
      assignedTo: process.env.GHL_DEFAULT_OWNER,
      customFields: {
        ...baseCustomFields,
        ...(customFields && typeof customFields === 'object' ? customFields : {}),
      },
      ...(fields && typeof fields === 'object' ? fields : {}),
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
