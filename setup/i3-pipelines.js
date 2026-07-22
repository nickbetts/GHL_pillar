import { get } from '../client.js';
import { LOCATION_ID } from '../config.js';

const TARGET_PIPELINE = 'i3 Sales Pipeline';

const EXPECTED_STAGES = [
  'Discovery',
  'Qualified',
  'Scoping',
  'Proposal',
  'Negotiation',
  'Won',
  'Post-Launch',
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
  };
}
