import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';

const host = '127.0.0.1';

function reply(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

export async function startDemo(apiPort = 3000, receiverPort = 3001, receiverDelayMs = 0) {
  const receiver = createServer(async (request, response) => {
    for await (const chunk of request) {
      // Drain the demo delivery body before acknowledging it.
    }
    await delay(receiverDelayMs);
    reply(response, 200, { received: true });
  });
  receiver.listen(receiverPort, host);
  await once(receiver, 'listening');
  const destination = `http://${host}:${receiver.address().port}/webhooks`;

  const queue = [];
  const statuses = new Map();
  let draining = false;

  async function drainQueue() {
    if (draining) return;
    draining = true;

    while (queue.length > 0) {
      const event = queue.shift();
      let status = 'failed';
      try {
        const delivery = await fetch(destination, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(2000),
        });
        await delivery.body?.cancel();
        if (delivery.ok) status = 'delivered';
      } catch {
        // A network failure or timeout ends this attempt.
      }
      statuses.set(event.id, status);
    }

    draining = false;
  }

  const api = createServer(async (request, response) => {
    const eventPath = /^\/events\/([^/]+)$/.exec(request.url);
    if (request.method === 'GET' && eventPath) {
      const id = eventPath[1];
      const status = statuses.get(id);
      return status
        ? reply(response, 200, { id, status })
        : reply(response, 404, { error: 'Event not found' });
    }

    if (request.method !== 'POST' || request.url !== '/events') {
      return reply(response, 404, { error: 'Route not found' });
    }

    const chunks = [];
    let size = 0;
    let input;
    try {
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > 16_384) {
          request.resume();
          return reply(response, 413, { error: 'Event exceeds 16 KiB' });
        }
        chunks.push(chunk);
      }
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return reply(response, 400, { error: 'Expected valid JSON' });
    }

    if (typeof input?.type !== 'string' || !input.type.trim() ||
        !input.data || typeof input.data !== 'object' || Array.isArray(input.data)) {
      return reply(response, 400, { error: 'Expected a type string and a data object' });
    }

    const event = { id: randomUUID(), type: input.type, data: input.data };
    statuses.set(event.id, 'pending');
    queue.push(event);
    setImmediate(drainQueue);
    response.setHeader('location', `/events/${event.id}`);
    reply(response, 202, { id: event.id, status: 'pending' });
  });

  api.listen(apiPort, host);
  try {
    await once(api, 'listening');
  } catch (error) {
    receiver.close();
    throw error;
  }
  return { api, receiver };
}
