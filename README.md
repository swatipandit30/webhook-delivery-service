# Webhook Delivery Service

A Node.js project that sends events to a webhook receiver. The local demo runs an event API and a test receiver on loopback. A single background worker processes accepted events in order.

## Run the local demo

Requires Node.js 22.13 or later for the built-in SQLite module. No packages to install.

```sh
RECEIVER_DELAY_MS=1500 node demo.mjs
```

In another terminal:

```sh
curl -i http://127.0.0.1:3000/events \
  -H 'Content-Type: application/json' \
  -d '{"type":"order.created","data":{"orderId":"42"}}'
```

A valid request returns HTTP 202, an event ID, and a `pending` status. Copy the path from the `Location` header and query it to see `pending`, `delivered`, or `failed`.

```sh
curl -i http://127.0.0.1:3000/events/EVENT_ID
```

Replace `EVENT_ID` with the returned ID before running the command. An invalid event returns 400 and an oversized body returns 413. The API writes each event to SQLite before returning 202. Pending deliveries resume on restart and completed statuses remain queryable. The demo uses `deliveries.sqlite` by default. Set `DELIVERY_DB_PATH` to choose another file. Run one demo process per database file.

The worker makes up to three attempts. Network errors, timeouts, HTTP 429 and 5xx responses are retried after 500 ms and then 1,000 ms. These demo delays are fixed and ignore Retry-After. `GET /events/EVENT_ID` includes completed attempts, with HTTP status and Unix millisecond timestamps. An event is `pending` between attempts.

To see recovery locally, start the demo with `RECEIVER_FAILURES=2 node demo.mjs`, submit an event, and fetch its status after a few seconds. The receiver returns 503 on its first two requests and 200 thereafter.

If a process stops after the receiver accepts an event but before SQLite records its outcome, the worker can send the same event again after restart. The event ID stays the same.

```sh
node --test
```

## Next milestones

- Show delivery history and support replay in a React dashboard.
