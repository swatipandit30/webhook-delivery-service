import { DatabaseSync } from 'node:sqlite';

export function openQueue(path) {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS deliveries (
        sequence INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'delivered', 'failed'))
      );
      CREATE INDEX IF NOT EXISTS pending_deliveries
        ON deliveries (sequence) WHERE status = 'pending';
    `);
  } catch (error) {
    db.close();
    throw error;
  }

  const insert = db.prepare('INSERT INTO deliveries (id, payload) VALUES (?, ?)');
  const lookup = db.prepare('SELECT status FROM deliveries WHERE id = ?');
  const next = db.prepare("SELECT payload FROM deliveries WHERE status = 'pending' ORDER BY sequence LIMIT 1");
  const update = db.prepare('UPDATE deliveries SET status = ? WHERE id = ?');
  return {
    enqueue(event) {
      insert.run(event.id, JSON.stringify(event));
    },
    status(id) {
      return lookup.get(id)?.status;
    },
    next() {
      const row = next.get();
      return row ? JSON.parse(row.payload) : undefined;
    },
    complete(id, status) {
      update.run(status, id);
    },
    close() {
      db.close();
    },
  };
}
