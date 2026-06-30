# Funpace Media Technical Audit

Date: 2026-06-26

## Implemented

- Public event pages now query products by `eventId`, with a legacy event-name fallback, instead of downloading the photographer's entire catalog.
- Added partial/composite indexes for public event galleries, face backfill, pending payment reconciliation, payments and payment events.
- Published events are readable anonymously while private events remain restricted to their photographer or admins.
- Download proxy blocks local/private HTTP destinations, validates redirects, applies an upstream timeout and streams responses instead of buffering complete files in memory.
- Serverless rate-limit buckets periodically remove expired entries.
- Critical API rate limits can use Upstash Redis REST when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured, with in-memory fallback.
- Public APIs and serverless handlers use request IDs, structured operational logs and sanitized error logging.
- Product sales-count updates now use the atomic `adjust_product_sales_counts` SQL RPC during fulfillment and reversals.
- Public event video galleries use paginated loading instead of a single large client-side result set.
- Event and photographer public pages can receive server-injected SEO metadata before the React app hydrates.
- Payment fulfillment logic is shared across checkout confirmation, InfinitePay webhook, admin recovery and order status flows.
- Production dependency audit reports zero known vulnerabilities.

## Findings

| Severity | Area | Finding | Status |
| --- | --- | --- | --- |
| Critical | Security | No known critical dependency vulnerabilities. | Verified |
| High | Security | Authorized download proxy accepted arbitrary stored HTTP destinations, creating SSRF exposure. | Fixed |
| High | Stability | Download proxy buffered full photos/videos in process memory. | Fixed |
| High | Performance | Public event page fetched up to 5,000 products for a photographer before filtering by event. | Fixed |
| High | Access/UX | Event RLS required authentication even for published public events. | Fixed |
| High | Scalability | Rate limiting was per process/instance and not globally coordinated. | Optional Upstash Redis path implemented; configure in production |
| High | Performance | Admin snapshot can return tens of thousands of full rows in one request. | Partially mitigated with bounded windows; future: paginated admin APIs and aggregate endpoints |
| Medium | Performance | Storefront initial load still requests a large cross-event product collection. | Future: server-side search/feed pagination |
| Medium | Scalability | Public event media loading needed pagination for large galleries. | Fixed for event video galleries; future: cursor pagination for all public feeds |
| Medium | Payments | `salesCount` used read-modify-write and could lose increments under concurrent fulfillment. Financial transactions themselves are protected by unique constraints. | Fixed with atomic SQL RPC; apply migration in production |
| Medium | SEO | Event metadata was updated client-side; crawlers without JavaScript could receive generic metadata. | Fixed for event and photographer public routes with server-side metadata injection |
| Medium | Observability | Logs were useful but not consistently structured or correlated by request ID. | Fixed baseline request IDs, JSON logs and redaction; future: external error tracking and latency metrics |
| Low | Bundle | Main React bundle remains about 159 KB before gzip; dashboards and secondary routes are split into separate chunks. | Monitor |

## Estimated Impact

- Event pages: request payload changes from all photographer products to only products from the selected event. The reduction is proportional to the photographer's number of events.
- Public event video galleries: initial media payload is capped and additional batches load on demand.
- Downloads: process memory usage changes from approximately the complete file size per concurrent download to stream buffering.
- Database: new indexes reduce scans for event galleries, face backfill and payment reconciliation as tables grow.
- Payments: product sales counts update atomically in Postgres, avoiding lost increments under concurrent fulfillment.
- SEO: public event and photographer routes can return specific title/description/social tags before client hydration.
- Operations: request IDs make API failures easier to correlate across checkout, webhook, media and admin flows.
- Security: private/local network targets and redirect chains are rejected by the download proxy.

## Recommended Growth Plan

1. Configure production variables, especially Upstash Redis REST, InfinitePay webhook auth and email sender settings.
2. Run pending SQL migrations in staging, including `adjust_product_sales_counts`, inspect `EXPLAIN ANALYZE`, then apply to production.
3. Replace the admin snapshot with paginated endpoints and server-side aggregate endpoints.
4. Introduce cursor pagination for the storefront feed and remaining public gallery flows.
5. Move engagement counts and event statistics to aggregate RPCs or materialized views.
6. Add external error tracking and latency metrics for Supabase, InfinitePay, AWS Rekognition, storage and Resend calls.
7. Run a production smoke test for checkout, webhook recovery, paid-order email, download authorization and photographer upload.
