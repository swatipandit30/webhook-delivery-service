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

test('retries two transient HTTP failures and exposes all outcomes', { timeout: 5000 }, async (context) => {
  const { api, receiver } = await startDemo(0, 0, 0, ':memory:', 2);
  context.after(() => {
    api.close();
    receiver.close();
  });

  const origin = `http://127.0.0.1:${api.address().port}`;
  const accepted = await fetch(origin + '/events', {
    method: 'POST',
    body: JSON.stringify({ type: 'order.created', data: {} }),
  });
  assert.equal(accepted.status, 202);
  const location = accepted.headers.get('location');
  const deadline = Date.now() + 3500;
  let result;
  do {
    result = await (await fetch(origin + location)).json();
    if (result.status !== 'pending') break;
    await delay(25);
  } while (Date.now() < deadline);

  assert.equal(result.status, 'delivered');
  assert.deepEqual(result.attempts.map((attempt) => attempt.httpStatus), [503, 503, 200]);
  assert.equal(result.attempts[0].retryAt - result.attempts[0].finishedAt, 500);
  assert.equal(result.attempts[1].retryAt - result.attempts[1].finishedAt, 1000);
  assert.ok(result.attempts[1].finishedAt >= result.attempts[0].retryAt);
  assert.ok(result.attempts[2].finishedAt >= result.attempts[1].retryAt);
  assert.equal(result.attempts[2].retryAt, null);
});

test('replays a failed event as a linked delivery while retaining history', { timeout: 6000 }, async (context) => {
  const { api, receiver } = await startDemo(0, 0, 0, ':memory:', 3);
  context.after(() => {
    api.close();
    receiver.close();
  });
  const origin = `http://127.0.0.1:${api.address().port}`;
  const accepted = await fetch(origin + '/events', {
    method: 'POST',
    body: JSON.stringify({ type: 'order.created', data: { orderId: '42' } }),
  });
  assert.equal(accepted.status, 202);
  const source = accepted.headers.get('location');

  async function settled(path) {
    const deadline = Date.now() + 3500;
    do {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200);
      const result = await response.json();
      if (result.status !== 'pending') return result;
      await delay(25);
    } while (Date.now() < deadline);
    assert.fail('Delivery did not settle');
  }

  const replay = (path) => fetch(origin + path + '/replay', { method: 'POST' });
  assert.equal((await replay(source)).status, 409);
  assert.equal((await replay('/events/unknown')).status, 404);
  const original = await settled(source);
  assert.equal(original.status, 'failed');
  const response = await replay(source);
  assert.equal(response.status, 202);
  const replayPath = response.headers.get('location');
  assert.notEqual(replayPath, source);
  const delivered = await settled(replayPath);
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.attempts.length, 1);
  assert.equal((await replay(replayPath)).status, 409);
  assert.deepEqual(await settled(source), original);

  const { events } = await (await fetch(origin + '/events')).json();
  assert.deepEqual(events.map(({ id, replayOf }) => [id, replayOf]), [
    [delivered.id, original.id],
    [original.id, null],
  ]);
});
