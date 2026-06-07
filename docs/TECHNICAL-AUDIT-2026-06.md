# Funpace Media Technical Audit

Date: 2026-06-07

## Implemented

- Public event pages now query products by `eventId`, with a legacy event-name fallback, instead of downloading the photographer's entire catalog.
- Added partial/composite indexes for public event galleries, face backfill, pending payment reconciliation, payments and payment events.
- Published events are readable anonymously while private events remain restricted to their photographer or admins.
- Download proxy blocks local/private HTTP destinations, validates redirects, applies an upstream timeout and streams responses instead of buffering complete files in memory.
- Serverless rate-limit buckets periodically remove expired entries.
- Production dependency audit reports zero known vulnerabilities.

## Findings

| Severity | Area | Finding | Status |
| --- | --- | --- | --- |
| Critical | Security | No known critical dependency vulnerabilities. | Verified |
| High | Security | Authorized download proxy accepted arbitrary stored HTTP destinations, creating SSRF exposure. | Fixed |
| High | Stability | Download proxy buffered full photos/videos in process memory. | Fixed |
| High | Performance | Public event page fetched up to 5,000 products for a photographer before filtering by event. | Fixed |
| High | Access/UX | Event RLS required authentication even for published public events. | Fixed |
| High | Scalability | Rate limiting is still per process/instance and is not globally coordinated. | Future: Redis/Upstash |
| High | Performance | Admin snapshot can return tens of thousands of full rows in one request. | Future: paginated admin APIs |
| Medium | Performance | Storefront initial load still requests a large cross-event product collection. | Future: server-side search/feed pagination |
| Medium | Scalability | Public galleries still have a client-side maximum result count and are not cursor-paginated. | Future: cursor pagination |
| Medium | Payments | `salesCount` uses read-modify-write and can lose increments under concurrent fulfillment. Financial transactions themselves are protected by unique constraints. | Future: atomic SQL RPC/trigger |
| Medium | SEO | Event metadata is updated client-side; crawlers without JavaScript may receive generic metadata. | Future: SSR/prerender event routes |
| Medium | Observability | Logs are useful but not consistently structured or correlated by request ID. | Future: structured logger and tracing |
| Low | Bundle | Main React bundle remains about 226 KB before gzip; dashboards are already split into separate chunks. | Monitor |

## Estimated Impact

- Event pages: request payload changes from all photographer products to only products from the selected event. The reduction is proportional to the photographer's number of events.
- Downloads: process memory usage changes from approximately the complete file size per concurrent download to stream buffering.
- Database: new indexes reduce scans for event galleries, face backfill and payment reconciliation as tables grow.
- Security: private/local network targets and redirect chains are rejected by the download proxy.

## Recommended Growth Plan

1. Replace in-memory rate limiting with Redis/Upstash and use separate quotas per route, account and IP.
2. Replace the admin snapshot with paginated endpoints and server-side aggregates.
3. Introduce cursor pagination for storefront/event galleries and virtualized rendering for very large result sets.
4. Move engagement counts and event statistics to aggregate RPCs or materialized views.
5. Make product sales-count updates atomic through a database trigger or RPC.
6. Add request IDs, JSON logs, error tracking and latency metrics for external services.
7. Add SSR or prerendering for event and photographer public pages.
8. Run migrations in staging, inspect `EXPLAIN ANALYZE`, then apply to production.
