# Event contracts

The domain events the platform publishes through the transactional outbox.

| Path | Content |
| --- | --- |
| `event-envelope.schema.json` | The envelope every event carries |
| `event-catalog.schema.json` | The shape of the catalog itself |
| `samples/event-catalog/catalog.json` | All fourteen mandatory events |
| `samples/event-envelope/` | A worked envelope for `finding.confirmed.v1` |

## What the shape enforces

**A version is part of the type.** `event_type` must end in `.vN`, so removing
or redefining a field means publishing a new type rather than silently breaking
a consumer. Adding an optional field stays backward compatible because consumers
ignore what they do not recognise.

**Deduplication and ordering are structural.** `event_id` is the idempotency
key and `aggregate_version` gives per-aggregate order. Ordering is guaranteed
only within one aggregate; a consumer that sees a gap rebuilds from the source
API rather than guessing what it missed.

**A payload cannot carry evidence.** Payload fields are declared by name and
type, and the type vocabulary has no free-text or binary member — only
identifier, timestamp, integer, boolean, enum value, digest and label. An event
that wanted to carry a request body or a token has no way to express it.

## What the tests hold together

The envelope and the catalog are separate documents, so the suite checks they
agree: every producer and aggregate type in the catalog must be expressible in
the envelope, and every catalogued type must match the envelope's type pattern.

The catalog is asserted to carry exactly the fourteen events
`docs/07-data-api/04-event-contracts.md` lists, so dropping one means editing a
test that cites the source. No event may be consumed by its own producer, since
that would feed the relay back into the service that emitted the event.

## Not yet covered

The outbox itself, the relay, delivery records and the poison queue belong to
the services and need Python and PostgreSQL. This is the contract both sides
publish and consume against, not the mechanism.

Payload fields are declared but not individually schema-validated at ingestion.
That check belongs with the relay, once there is one.
