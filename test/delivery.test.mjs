import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openQueue } from '../queue.mjs';
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

test('resumes a pending delivery from disk and retains its final status', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'webhook-delivery-'));
  const path = join(directory, 'queue.sqlite');
  let demo;
  const stop = async () => {
    if (!demo) return;
    const { api, receiver } = demo;
    demo = undefined;
    await Promise.all([api, receiver].map(
      (server) => new Promise((resolve) => server.close(resolve)),
    ));
  };

  try {
    const queue = openQueue(path);
    queue.enqueue({ id: 'saved-event', type: 'order.created', data: { orderId: '42' } });
    queue.close();

    const status = async () => {
      const url = `http://127.0.0.1:${demo.api.address().port}/events/saved-event`;
      const response = await fetch(url);
      assert.equal(response.status, 200);
      return (await response.json()).status;
    };

    demo = await startDemo(0, 0, 0, path);
    const deadline = Date.now() + 2500;
    let actual = await status();
    while (actual === 'pending' && Date.now() < deadline) {
      await delay(25);
      actual = await status();
    }
    assert.equal(actual, 'delivered');

    await stop();
    demo = await startDemo(0, 0, 0, path);
    assert.equal(await status(), 'delivered');
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
