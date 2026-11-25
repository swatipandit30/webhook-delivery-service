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

Each delivery gets one attempt during normal operation. If the process stops after the receiver accepts an event but before SQLite records the outcome, the worker can send the same event again after restart. The event ID stays the same.

```sh
node --test
```

## Next milestones

- Retry transient failures and record each attempt.
- Show delivery history and support replay in a React dashboard.
