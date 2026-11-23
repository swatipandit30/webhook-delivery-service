import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startDemo } from '../server.mjs';

test('delivers valid events and reports input and receiver failures', async (context) => {
  const { api, receiver } = await startDemo(0, 0);
  context.after(() => {
    api.close();
    receiver.close();
  });
  const send = (body) => fetch(`http://127.0.0.1:${api.address().port}/events`, {
    method: 'POST',
    body,
  });
  const event = JSON.stringify({ type: 'order.created', data: { orderId: '42' } });

  const delivered = await send(event);
  assert.equal(delivered.status, 201);
  assert.equal((await delivered.json()).status, 'delivered');
  assert.equal((await send('{')).status, 400);
  assert.equal((await send(JSON.stringify({ type: 'order.created' }))).status, 400);
  assert.equal((await send('x'.repeat(17_000))).status, 413);

  await new Promise((resolve) => receiver.close(resolve));
  assert.equal((await send(event)).status, 502);
});
