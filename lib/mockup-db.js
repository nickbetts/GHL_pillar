/** Mockups storage: sites, versioned files and byte chunks, kept in Postgres. Additive tables only. */

let ready = null;

export function ensureMockupTables(sql) {
  if (!ready) {
    ready = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS mockup_sites (
          id BIGSERIAL PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          folder_name TEXT,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          live_version INTEGER NOT NULL DEFAULT 0,
          pending_version INTEGER NOT NULL DEFAULT 0,
          entry_path TEXT NOT NULL DEFAULT 'index.html',
          file_count INTEGER NOT NULL DEFAULT 0,
          total_bytes BIGINT NOT NULL DEFAULT 0,
          view_count INTEGER NOT NULL DEFAULT 0,
          last_viewed_at TIMESTAMPTZ,
          created_by_name TEXT,
          created_by_email TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS mockup_files (
          id BIGSERIAL PRIMARY KEY,
          site_id BIGINT NOT NULL REFERENCES mockup_sites(id) ON DELETE CASCADE,
          version INTEGER NOT NULL,
          path TEXT NOT NULL,
          mime TEXT NOT NULL,
          size BIGINT NOT NULL DEFAULT 0,
          chunks INTEGER NOT NULL DEFAULT 0,
          complete BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (site_id, version, path)
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS mockup_chunks (
          file_id BIGINT NOT NULL REFERENCES mockup_files(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          data BYTEA NOT NULL,
          PRIMARY KEY (file_id, seq)
        )`;
      await sql`CREATE TABLE IF NOT EXISTS mockup_attempts (id BIGSERIAL PRIMARY KEY, site_id BIGINT NOT NULL, ip TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
      await sql`CREATE INDEX IF NOT EXISTS mockup_attempts_idx ON mockup_attempts (site_id, ip, created_at DESC)`;
    })().catch((error) => { ready = null; throw error; });
  }
  return ready;
}
