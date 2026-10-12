import test from 'node:test';
import assert from 'node:assert/strict';

test('PostgreSQL stores parameterized CRUD and reports dependency failure', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const { openPostgres } = await import('../src/postgres.js');
  const db = await openPostgres(process.env.TEST_DATABASE_URL);
  try {
    const row = await db.prepare('INSERT INTO project (name, description, status) VALUES (?, ?, ?)').run("quoted ' project", 'integration', 'active');
    const id = Number(row.lastInsertRowid);
    assert.equal((await db.prepare('SELECT * FROM project WHERE id = ?').get(id)).name, "quoted ' project");
    await db.prepare('UPDATE project SET name = ? WHERE id = ?').run('updated', id);
    assert.equal((await db.prepare('SELECT * FROM project WHERE id = ?').get(id)).name, 'updated');
    assert.equal((await db.probe()).ok, true);
    assert.equal((await db.prepare('DELETE FROM project WHERE id = ?').run(id)).changes, 1);
    assert.equal(await db.prepare('SELECT * FROM project WHERE id = ?').get(id), undefined);
  } finally { await db.close(); }
  assert.equal((await db.probe()).ok, false);
});
