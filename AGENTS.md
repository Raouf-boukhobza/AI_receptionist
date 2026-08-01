# AI Receptionist Platform

## Stack
- NestJS modular monolith (NOT microservices)
- PostgreSQL with Row-Level Security for multi-tenancy
- Redis for tenant phone-number resolution caching
- BullMQ for async jobs
- EventEmitter2 for in-process events
- LangGraph for the AI agent flows
- pgvector for per-tenant knowledge base
- WhatsApp via Meta Cloud API
- Chargily for payments (not Stripe)

## Rules
- Every DB query must respect tenant RLS. Never bypass it.
- New features go in their own module (one feature = one folder)
- No business logic in controllers
- Async/slow work (AI calls, WhatsApp sends) goes through BullMQ, not inline

## Before coding
- Check docs/specs/ for the relevant flow diagram before implementing