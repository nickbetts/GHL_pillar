/** Pitch Sites storage. Every change here is additive (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS). */

let ready = null;
export function ensurePitchTables(sql) {
  if (!ready) {
    ready = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS pitch_sites (
          id                BIGSERIAL PRIMARY KEY,
          slug              TEXT NOT NULL UNIQUE,
          owner_id          TEXT,
          owner_name        TEXT,
          created_by_email  TEXT,
          lead_id           BIGINT,
          client_name       TEXT NOT NULL,
          source_url        TEXT NOT NULL,
          status            TEXT NOT NULL DEFAULT 'crawled',
          brand             JSONB NOT NULL DEFAULT '{}'::jsonb,
          brief             JSONB,
          design            JSONB,
          pages             JSONB NOT NULL DEFAULT '{}'::jsonb,
          audit             JSONB,
          share             JSONB NOT NULL DEFAULT '{}'::jsonb,
          version           INTEGER NOT NULL DEFAULT 0,
          error             TEXT,
          unlocked_at       TIMESTAMPTZ,
          expires_at        TIMESTAMPTZ,
          shared_at         TIMESTAMPTZ,
          first_viewed_at   TIMESTAMPTZ,
          last_viewed_at    TIMESTAMPTZ,
          view_count        INTEGER NOT NULL DEFAULT 0,
          build_started_at  TIMESTAMPTZ,
          built_at          TIMESTAMPTZ,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
          archived_at       TIMESTAMPTZ
        )`;
      await sql`CREATE INDEX IF NOT EXISTS pitch_sites_owner_idx ON pitch_sites (owner_id, created_at DESC) WHERE archived_at IS NULL`;
      await sql`CREATE INDEX IF NOT EXISTS pitch_sites_lead_idx ON pitch_sites (lead_id) WHERE lead_id IS NOT NULL`;
      await sql`
        CREATE TABLE IF NOT EXISTS pitch_site_steps (
          id           BIGSERIAL PRIMARY KEY,
          site_id      BIGINT NOT NULL,
          seq          INTEGER NOT NULL,
          key          TEXT NOT NULL,
          kind         TEXT NOT NULL,
          page         TEXT,
          section_key  TEXT,
          label        TEXT,
          status       TEXT NOT NULL DEFAULT 'pending',
          attempts     INTEGER NOT NULL DEFAULT 0,
          error        TEXT,
          started_at   TIMESTAMPTZ,
          finished_at  TIMESTAMPTZ,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`CREATE INDEX IF NOT EXISTS pitch_site_steps_site_idx ON pitch_site_steps (site_id, seq)`;
      await sql`
        CREATE TABLE IF NOT EXISTS pitch_site_versions (
          id          BIGSERIAL PRIMARY KEY,
          site_id     BIGINT NOT NULL,
          version     INTEGER NOT NULL,
          note        TEXT,
          design      JSONB,
          pages       JSONB,
          created_by  TEXT,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`CREATE INDEX IF NOT EXISTS pitch_site_versions_site_idx ON pitch_site_versions (site_id, version DESC)`;
      await sql`
        CREATE TABLE IF NOT EXISTS pitch_site_visits (
          id            BIGSERIAL PRIMARY KEY,
          site_id       BIGINT NOT NULL,
          visitor       TEXT NOT NULL,
          visit_key     TEXT NOT NULL UNIQUE,
          started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          seconds       INTEGER NOT NULL DEFAULT 0,
          max_depth     INTEGER NOT NULL DEFAULT 0,
          pages         JSONB NOT NULL DEFAULT '{}'::jsonb,
          device        TEXT,
          referrer      TEXT
        )`;
      await sql`CREATE INDEX IF NOT EXISTS pitch_site_visits_site_idx ON pitch_site_visits (site_id, started_at DESC)`;
      await sql`
        CREATE TABLE IF NOT EXISTS pitch_site_events (
          id          BIGSERIAL PRIMARY KEY,
          site_id     BIGINT NOT NULL,
          kind        TEXT NOT NULL,
          visitor     TEXT,
          actor_email TEXT,
          meta        JSONB,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`CREATE INDEX IF NOT EXISTS pitch_site_events_site_idx ON pitch_site_events (site_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS pitch_site_events_kind_idx ON pitch_site_events (kind, created_at DESC)`;
      await sql`
        CREATE TABLE IF NOT EXISTS pitch_slot_claims (
          owner_id    TEXT NOT NULL,
          slot        TIMESTAMPTZ NOT NULL,
          claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (owner_id, slot)
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS pitch_site_assets (
          id          BIGSERIAL PRIMARY KEY,
          site_id     BIGINT NOT NULL,
          key         TEXT NOT NULL,
          mime        TEXT NOT NULL,
          data        BYTEA NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (site_id, key)
        )`;
    })().catch((error) => { ready = null; throw error; });
  }
  return ready;
}

export const SITE_COLUMNS = 'id, slug, owner_id, owner_name, created_by_email, lead_id, client_name, source_url, status, brand, brief, design, pages, audit, share, version, error, unlocked_at, expires_at, shared_at, first_viewed_at, last_viewed_at, view_count, build_started_at, built_at, created_at, updated_at';

export async function loadSiteBySlug(sql, slug) {
  const rows = await sql`
    SELECT id, slug, owner_id, owner_name, created_by_email, lead_id, client_name, source_url, status, brand, brief, design, pages, audit, share,
           version, error, unlocked_at, expires_at, shared_at, first_viewed_at, last_viewed_at, view_count, build_started_at, built_at, created_at, updated_at
    FROM pitch_sites WHERE slug = ${slug} AND archived_at IS NULL LIMIT 1`;
  return rows[0] || null;
}

export async function loadSiteById(sql, id) {
  const rows = await sql`
    SELECT id, slug, owner_id, owner_name, created_by_email, lead_id, client_name, source_url, status, brand, brief, design, pages, audit, share,
           version, error, unlocked_at, expires_at, shared_at, first_viewed_at, last_viewed_at, view_count, build_started_at, built_at, created_at, updated_at
    FROM pitch_sites WHERE id = ${id} AND archived_at IS NULL LIMIT 1`;
  return rows[0] || null;
}

export async function logPitchEvent(sql, { siteId, kind, visitor = null, actorEmail = null, meta = null }) {
  await sql`
    INSERT INTO pitch_site_events (site_id, kind, visitor, actor_email, meta)
    VALUES (${siteId}, ${kind}, ${visitor}, ${actorEmail}, ${meta ? JSON.stringify(meta) : null})`;
}

/** A note on the linked lead's timeline (what reps see on the contact). Never blocks the caller. */
export async function addLeadNote(sql, site, note) {
  if (!site?.lead_id || !note) return;
  try {
    await sql`
      INSERT INTO lead_notes (lead_id, note, owner_id, owner_name, source)
      VALUES (${site.lead_id}, ${note}, ${site.owner_id || null}, ${site.owner_name || null}, 'pitch-site')`;
  } catch { /* timeline is best-effort */ }
}

export async function saveAsset(sql, siteId, key, mime, bytes) {
  await sql`
    INSERT INTO pitch_site_assets (site_id, key, mime, data) VALUES (${siteId}, ${key}, ${mime}, decode(${Buffer.from(bytes).toString('base64')}, 'base64'))
    ON CONFLICT (site_id, key) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, created_at = now()`;
}

export async function loadAsset(sql, siteId, key) {
  const rows = await sql`SELECT mime, encode(data, 'base64') AS d FROM pitch_site_assets WHERE site_id = ${siteId} AND key = ${key} LIMIT 1`;
  return rows[0] ? { mime: rows[0].mime, data: Buffer.from(rows[0].d, 'base64') } : null;
}
