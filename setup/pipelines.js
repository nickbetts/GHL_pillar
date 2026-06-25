import { get } from '../client.js';
import { LOCATION_ID } from '../config.js';

const TARGET_PIPELINE = 'Pillar Sales Pipeline';

const REQUIRED_STAGES = [
  'Lead',
  'Contacted',
  'Research Stage',
  'High Intent',
  'Demo Scheduled',
  'Demo Complete',
  'Proposal',
  'Won',
  'Expansion',
  'Churn Risk',
];

export async function checkPipelines() {
  let pipelines = [];
  try {
    const data = await get('/opportunities/pipelines', { locationId: LOCATION_ID });
    pipelines = data?.pipelines ?? [];
  } catch (err) {
    return { ok: false, error: `Failed to fetch pipelines: ${err.message}` };
  }

  const found = pipelines.find(
    (p) => p.name?.toLowerCase() === TARGET_PIPELINE.toLowerCase()
  );

  if (found) {
    return {
      ok: true,
      exists: true,
      id: found.id,
      name: found.name,
      stages: found.stages?.map((s) => s.name) ?? [],
    };
  }

  return {
    ok: true,
    exists: false,
    allPipelines: pipelines.map((p) => ({ id: p.id, name: p.name })),
    instructions: buildInstructions(),
  };
}

function buildInstructions() {
  return [
    '',
    '  ┌─────────────────────────────────────────────────────────────┐',
    '  │  MANUAL STEP REQUIRED: Create the Pillar Sales Pipeline     │',
    '  └─────────────────────────────────────────────────────────────┘',
    '',
    '  GHL → Sub-Account → Opportunities → Pipelines → + New Pipeline',
    `  Name: "${TARGET_PIPELINE}"`,
    '',
    '  Add these stages in order:',
    ...REQUIRED_STAGES.map((s, i) => `    ${i + 1}. ${s}`),
    '',
    '  Mark "Won" as the Won stage and "Churn Risk" as the Lost stage.',
    '',
  ].join('\n');
}
