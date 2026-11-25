import { startDemo } from './server.mjs';

const { api, receiver } = await startDemo(
  3000,
  3001,
  Number(process.env.RECEIVER_DELAY_MS ?? 0),
  process.env.DELIVERY_DB_PATH || 'deliveries.sqlite',
);
console.log(`API listening on http://127.0.0.1:${api.address().port}`);
console.log(`Demo receiver listening on http://127.0.0.1:${receiver.address().port}`);
