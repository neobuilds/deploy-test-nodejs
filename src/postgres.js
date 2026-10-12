import pg from 'pg';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS project (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'archived')),
  created_at  TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  updated_at  TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS task (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'todo'
              CHECK (status IN ('todo', 'in_progress', 'done')),
  priority    TEXT NOT NULL DEFAULT 'medium'
              CHECK (priority IN ('low', 'medium', 'high')),
  created_at  TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  updated_at  TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE INDEX IF NOT EXISTS idx_task_project ON task(project_id, status);
CREATE INDEX IF NOT EXISTS idx_task_status ON task(status);

CREATE TABLE IF NOT EXISTS seed_flag (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  seeded_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS heartbeat (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  checked_at  TEXT NOT NULL
);
`;

export async function openPostgres(connectionString) {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 3000, query_timeout: 5000 });
  pool.on('error', () => {});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(481903)');
    await client.query(SCHEMA);
    const seeded = await client.query('SELECT id FROM seed_flag WHERE id = 1');
    if (!seeded.rowCount) {
      const { rows } = await client.query("INSERT INTO project (name, description) VALUES ('Launch checklist', 'PostgreSQL demo'), ('Support triage', 'PostgreSQL demo') RETURNING id");
      await client.query("INSERT INTO task (project_id, title) VALUES ($1, 'Verify PostgreSQL persistence'), ($2, 'Complete acceptance')", [rows[0].id, rows[1].id]);
      await client.query("INSERT INTO seed_flag (id, seeded_at) VALUES (1, CURRENT_TIMESTAMP::text)");
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    await pool.end();
    throw error;
  } finally { client.release(); }

  function statement(original) {
    async function query(args, insert = false) {
      let sql = original.replaceAll("datetime('now')", 'CURRENT_TIMESTAMP::text');
      let values = args;
      let index = 0;
      if (args.length === 1 && args[0] && typeof args[0] === 'object') {
        values = [];
        const names = new Map();
        sql = sql.replace(/\$(project|status|priority|q)\b/g, (_, name) => {
          if (!names.has(name)) { names.set(name, values.length + 1); values.push(args[0][name]); }
          return '$' + names.get(name) + (name === 'project' ? '::integer' : '::text');
        });
      } else { sql = sql.replace(/\?/g, () => '$' + (++index)); }
      if (insert && /^INSERT INTO (project|task)\b/i.test(sql)) sql += ' RETURNING id';
      return pool.query(sql, values);
    }
    return {
      get: async (...args) => (await query(args)).rows[0],
      all: async (...args) => (await query(args)).rows,
      run: async (...args) => { const result = await query(args, true); return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id }; },
    };
  }
  return {
    prepare: statement,
    close: () => pool.end(),
    probe: async () => {
      try {
        const result = await pool.query("INSERT INTO heartbeat (id, checked_at) VALUES (1, CURRENT_TIMESTAMP::text) ON CONFLICT (id) DO UPDATE SET checked_at = EXCLUDED.checked_at RETURNING checked_at");
        return { ok: true, detail: result.rows[0].checked_at };
      } catch { return { ok: false, detail: 'PostgreSQL unavailable' }; }
    },
  };
}
