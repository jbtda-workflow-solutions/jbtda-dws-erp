# Master System Specification & AI Agent Operating Manual

This document defines the complete technical architecture, operational guidelines, design system, and multi-stage development roadmap for building a modular, multi-tenant accounting application deployed on Google Cloud Platform (GCP).

---

## 1. Zero-Memory Agent Operating Protocol

You are operating as a senior full-stack software architect, cloud engineer, and financial security specialist.

### Critical Production Principle: Deterministic Runtime (Zero AI in Production)
- **AI Agents are the builders during development; they are NOT runtime dependencies.**
- The production application must be 100% deterministic, traditional web software (TypeScript, Fastify, React, Prisma, PostgreSQL).

### Mandatory Agent Rules
1. **Zero Session Memory Dependency:** Never assume context from previous chat sessions or prompt turns. The single source of truth is the code and documentation committed to this repository.
2. **Persistent Documentation First:** Every architectural decision, data model change, API contract, and security constraint must be documented in dedicated markdown files in the `/docs` directory before or immediately upon implementation.
3. **Changelog Maintenance:** Any task that introduces a new route, migration, dependency, or schema modification must append an entry to `docs/CHANGELOG.md`.

---

## 2. System Architecture & GCP Topology (Unified Monolith)

The application is deployed as a single, unified container on Google Cloud Run to eliminate cross-origin (CORS) complexity and ensure robust cookie security.

```text
                          ┌────────────────────────────────────────┐
                          │         GCP Cloud Run Service          │
                          │                                        │
                          │  ┌──────────────────────────────────┐  │
                          │  │    Static React SPA (Vite/TS)    │  │
                          │  │  (Served via @fastify/static)    │  │
                          │  └──────────────────────────────────┘  │
                          │                                        │
                          │     Fastify + TypeScript + Prisma      │
                          └───────┬────────────────────────────┬───┘
                                  │                            │
            Direct Queries (ACID) │                            │ Async Webhooks
            (Cloud SQL Proxy)     │                            │ (X-Webhook-Secret)
                                  ▼                            ▼
                         ┌──────────────┐               ┌────────────────┐
                         │GCP Cloud SQL │               │ GCP Cloud Run  │
                         │ (PostgreSQL) │               │(n8n Automation)│
                         └──────────────┘               └────────┬───────┘
```

### Stack Components

1. **Frontend (`/frontend`):**
   - Single Page Application (React 18/19, TypeScript, Vite, Tailwind CSS).
   - Component primitives: Radix UI / shadcn/ui patterns with Lucide React icons.
   - **Delivery:** Compiled at build time and served by the Fastify backend. Not hosted separately.
   - **API Client:** Makes relative requests to the backend (e.g., `fetch('/api/v1/auth/google')`), avoiding CORS preflight checks entirely.

2. **Core Backend API (`/backend`):**
   - **Framework:** Fastify with TypeScript.
   - **ORM:** Prisma ORM with PostgreSQL client.
   - **Routing Rules:**
     - Serve the React static build directory using `@fastify/static` at the root `/`.
     - Mount all core API logic under `/api/v1/`.
     - SPA Fallback: Any GET request failing to match `/api/*` returns `index.html`.
   - **Connection Pool Ceiling:** Explicitly configure Prisma connection limits:
     `DATABASE_URL="postgresql://user:pass@host/db?connection_limit=7&pool_timeout=10"`

3. **Database (Cloud SQL PostgreSQL):**
   - Managed PostgreSQL instance with private VPC connection or Cloud SQL Auth Proxy.
   - Zero direct public exposure.

4. **Automation & Integration Engine (n8n on Cloud Run):**
   - Worker engine for background automations (email dispatches, PDF generation, external syncing).
   - Triggered via asynchronous webhooks with `X-Webhook-Secret` verification. Does **not** process user authentication.

---

*(The remainder of the specification regarding Financial Mechanics, Seed Accounts, Security, RBAC, Design System, and Stages Roadmap remain exactly as previously codified).*