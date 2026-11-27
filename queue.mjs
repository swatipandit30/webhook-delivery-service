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
      CREATE TABLE IF NOT EXISTS delivery_attempts (
        event_id TEXT NOT NULL REFERENCES deliveries(id),
        number INTEGER NOT NULL,
        finished_at INTEGER NOT NULL,
        http_status INTEGER,
        outcome TEXT NOT NULL,
        retry_at INTEGER,
        PRIMARY KEY (event_id, number)
      );
    `);
  } catch (error) {
    db.close();
    throw error;
  }

  const insert = db.prepare('INSERT INTO deliveries (id, payload) VALUES (?, ?)');
  const lookup = db.prepare('SELECT status, payload FROM deliveries WHERE id = ?');
  const recent = db.prepare(`
    SELECT id, status, json_extract(payload, '$.type') AS type,
           json_extract(payload, '$.replayOf') AS replayOf
    FROM deliveries ORDER BY sequence DESC LIMIT 50
  `);
  const next = db.prepare(`
    SELECT deliveries.payload, COALESCE(attempt.number, 0) + 1 AS number
    FROM deliveries
    LEFT JOIN delivery_attempts AS attempt ON attempt.event_id = deliveries.id
      AND attempt.number = (SELECT MAX(number) FROM delivery_attempts WHERE event_id = deliveries.id)
    WHERE deliveries.status = 'pending' AND COALESCE(attempt.retry_at, 0) <= ?
    ORDER BY deliveries.sequence LIMIT 1
  `);
  const history = db.prepare(`
    SELECT number, finished_at AS finishedAt, http_status AS httpStatus,
           outcome, retry_at AS retryAt
    FROM delivery_attempts WHERE event_id = ? ORDER BY number
  `);
  const record = db.prepare(`
    INSERT INTO delivery_attempts (event_id, number, finished_at, http_status, outcome, retry_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare('UPDATE deliveries SET status = ? WHERE id = ?');
  return {
    enqueue(event) {
      insert.run(event.id, JSON.stringify(event));
    },
    status(id) {
      return lookup.get(id)?.status;
    },
    recent() {
      return recent.all();
    },
    replay(sourceId, id) {
      const source = lookup.get(sourceId);
      if (!source) return 'missing';
      if (source.status !== 'failed') return 'conflict';

      const original = JSON.parse(source.payload);
      const event = {
        id,
        type: original.type,
        data: original.data,
        replayOf: sourceId,
        originalEventId: original.originalEventId ?? sourceId,
      };
      insert.run(id, JSON.stringify(event));
      return 'queued';
    },
    attempts(id) {
      return history.all(id);
    },
    next() {
      const row = next.get(Date.now());
      return row ? { event: JSON.parse(row.payload), number: row.number } : undefined;
    },
    complete(id, number, finishedAt, httpStatus, outcome, retryAt) {
      db.exec('BEGIN');
      try {
        record.run(id, number, finishedAt, httpStatus, outcome, retryAt);
        update.run(retryAt === null ? outcome : 'pending', id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}
