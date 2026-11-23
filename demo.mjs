import { startDemo } from './server.mjs';

const { api, receiver } = await startDemo();
console.log(`API listening on http://127.0.0.1:${api.address().port}`);
console.log(`Demo receiver listening on http://127.0.0.1:${receiver.address().port}`);
