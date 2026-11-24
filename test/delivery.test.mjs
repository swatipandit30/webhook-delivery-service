import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { startDemo } from '../server.mjs';

test('delivers valid events and reports input and receiver failures', { timeout: 5000 }, async (context) => {
  const { api, receiver } = await startDemo(0, 0, 500);
  context.after(() => {
    api.close();
    receiver.close();
  });
  const send = (body) => fetch(`http://127.0.0.1:${api.address().port}/events`, {
    method: 'POST',
    body,
  });
  const event = JSON.stringify({ type: 'order.created', data: { orderId: '42' } });

  const origin = `http://127.0.0.1:${api.address().port}`;
  const getStatus = async (path) => (await (await fetch(origin + path)).json()).status;
  async function submitEvent() {
    const accepted = await send(event);
    assert.equal(accepted.status, 202);
    const body = await accepted.json();
    assert.equal(body.status, 'pending');
    const path = accepted.headers.get('location');
    assert.equal(path, `/events/${body.id}`);
    return path;
  }

  async function expectStatus(path, expected) {
    const deadline = Date.now() + 2500;
    let status;
    do {
      status = await getStatus(path);
      if (status === expected) return;
      await delay(25);
    } while (Date.now() < deadline);
    assert.equal(status, expected);
  }

  const path = await submitEvent();
  assert.equal(await getStatus(path), 'pending');
  await expectStatus(path, 'delivered');
  assert.equal((await fetch(origin + '/events/unknown')).status, 404);
  assert.equal((await send('{')).status, 400);
  assert.equal((await send(JSON.stringify({ type: 'order.created' }))).status, 400);
  assert.equal((await send('x'.repeat(17_000))).status, 413);

  await new Promise((resolve) => receiver.close(resolve));
  await expectStatus(await submitEvent(), 'failed');
});
