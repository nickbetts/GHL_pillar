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
    if (Array.isArray(cf)) {
      cf.forEach((entry) => {
        const key = entry?.key || entry?.fieldKey || entry?.name || entry?.label || entry?.id;
        if (key) customSet.add(key);
      });
    } else if (cf && typeof cf === 'object') {
      Object.keys(cf).forEach((k) => customSet.add(k));
    }
  });
  return uniqSorted(Array.from(customSet));
}

function normalizeOutboundCustomFields(customFields) {
  if (Array.isArray(customFields)) return customFields;
  if (!customFields || typeof customFields !== 'object') return [];

  return Object.entries(customFields)
    .filter(([key, value]) => key && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => ({ key, fieldValue: value }));
}

function nowStamp() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
}

function extractEntityId(entity) {
  if (!entity || typeof entity !== 'object') return null;
  return entity.id || entity._id || entity.contact?.id || entity.opportunity?.id || entity.data?.id || null;
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

function extractStageEntriesFromUnknownShape(payload, targetPipelineId) {
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
  const stageEntries = stages
    .map((s) => ({
      id: s?.id || s?._id || s?.stageId || s?.pipelineStageId || null,
      name: s?.name || s?.title || s?.stage || s?.label || null,
    }))
    .filter((s) => s.name);

  const deduped = [];
  const seen = new Set();
  for (const stage of stageEntries) {
    const key = `${stage.id || 'none'}::${stage.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(stage);
  }

  return deduped.sort((a, b) => String(a.name).localeCompare(String(b.name)));
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
      const stageEntries = extractStageEntriesFromUnknownShape(raw, targetPipelineId);
      if (stageEntries.length > 0) {
        return {
          stages: stageEntries.map((s) => s.name),
          stageEntries,
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
    stageEntries: [],
    source: 'fallback',
    pipelineId: targetPipelineId || null,
  };
}

function findStageEntryByName(configuredPipeline, stageName) {
  const target = String(stageName || '').toLowerCase();
  if (!target) return null;
  return (configuredPipeline?.stageEntries || []).find((s) => String(s.name || '').toLowerCase() === target) || null;
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
      locationId: LOCATION_ID,
      contactFields: extractTopLevelFields(contacts.data),
      contactCustomFields: mergedContactCustom,
      contactCustomFieldsCount: mergedContactCustom.length,
      contactCustomFieldsSource: configuredCustomFields.contactCustom.length > 0 ? configuredCustomFields.source : 'derived-from-contacts',
      opportunityFields: extractTopLevelFields(opportunities.data),
      opportunityCustomFields: mergedOppCustom,
      opportunityCustomFieldsCount: mergedOppCustom.length,
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

    return {
      action,
      created,
      createdId: extractEntityId(created),
    };
  }

  if (action === 'createOpportunity') {
    const { contactId, name, stage, monetaryValue = 0, fields, customFields } = body;

    if (!contactId || !name) {
      throw new Error('contactId and name are required');
    }

    const contact = await getContact(contactId);
    const configuredPipeline = await getConfiguredPipelineStages();

    const defaultStage = stage || 'Lead';
    const stageEntry = findStageEntryByName(configuredPipeline, defaultStage);
    const baseCustomFields = {
      Persona: contact['Governance Role'],
      'Org Size Band': contact['Annual Income Band'],
      'Lead Source Channel': contact['UTM Source'] || 'Direct',
    };

    const extraFields = fields && typeof fields === 'object' ? { ...fields } : {};
    delete extraFields.stage;

    const created = await createOpportunity({
      contactId,
      name,
      monetaryValue: toNumber(monetaryValue, 0),
      pipelineId: process.env.GHL_PIPELINE_ID,
      assignedTo: process.env.GHL_DEFAULT_OWNER,
      status: 'open',
      ...(stageEntry?.id ? { pipelineStageId: stageEntry.id } : {}),
      customFields: normalizeOutboundCustomFields({
        ...baseCustomFields,
        ...(customFields && typeof customFields === 'object' ? customFields : {}),
      }),
      ...extraFields,
    });

    return {
      action,
      created,
      createdId: extractEntityId(created),
    };
  }

  if (action === 'seedDummyData') {
    const stamp = nowStamp();
    const seedTag = body?.seedTag || 'i3crm-seed';
    const baseEmail = body?.baseEmail || `i3crm-seed-${stamp}@example.org`;
    const locationId = body?.locationId || LOCATION_ID;
    const pipelineId = body?.pipelineId || process.env.GHL_PIPELINE_ID;
    const assignedTo = body?.ownerId || process.env.GHL_DEFAULT_OWNER;

    let createdContact;
    try {
      createdContact = await createContact({
        firstName: 'i3CRM',
        lastName: `Seed-${stamp}`,
        email: baseEmail,
        companyName: 'i3CRM Seed Org',
        locationId,
        tags: [seedTag, 'dummy-record'],
        ...(body?.contactFields && typeof body.contactFields === 'object' ? body.contactFields : {}),
      });
    } catch (error) {
      throw new Error(
        `seedDummyData blocked while creating contact for location ${locationId}: ${error.message}. `
        + 'Provide locationId with write access or update GHL token/location permissions.'
      );
    }

    const configuredPipeline = await getConfiguredPipelineStages();
    const stageList = configuredPipeline.stages.length > 0 ? configuredPipeline.stages : ['Lead'];
    const seedContactId = extractEntityId(createdContact);

    if (!seedContactId) {
      throw new Error('seedDummyData created contact response did not include an id');
    }

    const defaultOppCustom = {
      Persona: 'Seed Persona',
      'Org Size Band': '£250k–£1m',
      'Lead Source Channel': 'Seed',
      'Competitor Signal': 'None',
    };

    const createdOpportunities = [];
    const failedOpportunities = [];
    for (const stageName of stageList) {
      try {
        const stageEntry = findStageEntryByName(configuredPipeline, stageName);
        const created = await createOpportunity({
          contactId: seedContactId,
          name: `[SEED] ${stageName} ${stamp}`,
          locationId,
          monetaryValue: 1000,
          pipelineId,
          assignedTo,
          status: 'open',
          ...(stageEntry?.id ? { pipelineStageId: stageEntry.id } : {}),
          customFields: normalizeOutboundCustomFields({
            ...defaultOppCustom,
            ...(body?.opportunityCustomFields && typeof body.opportunityCustomFields === 'object'
              ? body.opportunityCustomFields
              : {}),
          }),
          ...(body?.opportunityFields && typeof body.opportunityFields === 'object' ? body.opportunityFields : {}),
        });
        const createdId = extractEntityId(created);
        createdOpportunities.push({
          id: createdId,
          stage: stageName,
        });
      } catch (error) {
        failedOpportunities.push({
          stage: stageName,
          error: error.message,
        });
      }
    }

    return {
      action,
      success: failedOpportunities.length === 0,
      seedTag,
      stagesSeeded: stageList.length,
      locationId,
      pipelineId,
      contact: {
        id: seedContactId,
        email: baseEmail,
      },
      opportunities: createdOpportunities,
      opportunitiesFailed: failedOpportunities,
    };
  }

  throw new Error('Unsupported action. Use createContact, createOpportunity, or seedDummyData.');
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
