# ADR-005: PostgreSQL with Transactional Outbox

Status: Accepted

## Context

The local-first workload requires durable domain state and events but does not
justify an operational message broker for version 1.0.

## Decision

Use PostgreSQL as structured source of record and a transactional outbox for
domain events. Evidence bytes remain content-addressed outside relational rows.

## Consequences

- Simpler bootstrap, backup and consistency.
- Relay and consumers must be idempotent and observable.
- A broker may be introduced later only with measured throughput/availability
  need and migration ADR.

## Rejected alternative

Kafka/RabbitMQ from the start: unnecessary operational complexity.

