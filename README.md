# Webhook Delivery Service

A Node.js project that sends events to a webhook receiver. The first milestone runs an event API and a test receiver on loopback and confirms a delivery before returning to the caller.

## Run the local demo

Requires Node.js 22 or later. No packages to install.

```sh
node demo.mjs
```

In another terminal:

```sh
curl -i http://127.0.0.1:3000/events \
  -H 'Content-Type: application/json' \
  -d '{"type":"order.created","data":{"orderId":"42"}}'
```

A successful request returns HTTP 201, an event ID, and a `delivered` status. An invalid event returns 400, an oversized body returns 413, and a delivery failure returns 502.

```sh
node --test
```

## Next milestones

- Persist events and move delivery into a background worker.
- Retry transient failures and record each attempt.
- Show delivery history and support replay in a React dashboard.
