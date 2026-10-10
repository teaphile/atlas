# Security and privacy model

## Threat model

The application consumes untrusted public provider responses and accepts untrusted point, search, polygon and scenario input. Internet users can generate costly requests, slow bodies or simultaneous streams. Upstream outages, schema drift, credential mistakes and stale data are considered normal failure conditions.

This document describes implemented controls, not a penetration-test certificate. Safety-critical interpretation is a separate scientific risk addressed in `SCIENTIFIC_METHODS.md`.

## Implemented controls

- **Fixed-origin egress:** HTTPS only, exact hostname allowlist, no credentials in authority, no nonstandard ports, no redirect following. No arbitrary-URL proxy. Invalid camera identifiers must also exist in the current official catalog.
- **Validated map metadata:** provider-owned versioned tile template must match a strict host/path pattern; glyph stack and Unicode block bounds are restricted. Vector/raster caches and outstanding fetches are bounded.
- **Input boundaries:** finite/ranged coordinates and scenario factors; polygon closure/topology/span/vertex/hole validation; 64 KiB bodies and 10-second receive deadline. Body buffering consumes an inflight slot before waiting.
- **Resource controls:** deployment-local peer token bucket, 96 inflight requests, 64 SSE listeners, bounded queues, bounded cache count/bytes, limited provider concurrency, budgets and deadlines.
- **Auth:** optional `X-Atlas-Key`; no query-key fallback; constant-time comparison; invalid required-key configuration rejects startup. Settings avoid printing secret fields/validation input. This is a deployment access key, not user accounts, roles or tenant isolation.
- **Credential handling:** NASA key stays server-side; browser deployment key stays in page memory, not local storage. Frontend request helpers reject off-origin URLs. Map fetches use same-origin header injection; camera images are fetched as authenticated blobs. Authenticated operation uses snapshot polling instead of a credential in an SSE URL.
- **Parser behavior:** defused XML, strict JSON nonfinite rejection, finite numeric parsing, unknown/null preservation, source schema checks, no eval or provider-supplied executable code.
- **Rendering:** React text rendering, protocol-filtered source links, no provider HTML injection, bundled scripts/styles/fonts, CSP, `nosniff`, referrer and permissions policies. Inline styles are allowed for the UI; arbitrary inline scripts are not.
- **Exports:** CSV neutralizes common spreadsheet formula prefixes; JSON/GeoJSON preserve typed source/nature/time semantics. Treat externally edited exports as untrusted input in downstream tools.
- **Persistence:** SQLite WAL, parameterized queries and bounded logical payload retention; no application visitor/account database.
- **Errors/logs:** structured source ID/status/error-type messages instead of full upstream bodies, headers or secret-bearing URLs. Production run scripts disable Uvicorn access logs. This does not configure your reverse proxy, hosting platform or network telemetry for you.

## Explicit residual risks / deployment duties

1. Fixed-host allowlisting is **not DNS/socket IP pinning**. Enforce a real egress policy blocking loopback, link-local, private/internal and metadata destinations as appropriate; trust/configure DNS and CA roots deliberately. TLS verification is enabled.
2. Limits, circuit state and budgets are process-local. Restart resets daily counters. Multiple workers/replicas multiply quotas and split SSE state. Use a shared budget store before scaling.
3. The peer address is taken from ASGI, not untrusted `X-Forwarded-For`. Behind a proxy all viewers may share one peer budget. Add trusted ingress authentication/rate limiting instead of blindly trusting forwarded headers.
4. A shared API key is not SSO, MFA, RBAC, audit identity, tenant scoping or key lifecycle management. For a team deployment prefer a mature identity-aware gateway plus appropriate application authorization.
5. HTTPS/HSTS, trusted hosts, secret rotation, patching, backup/restore, monitoring, incident response and hosting network policies are operator responsibilities. Container/CI examples are provided but were not run on the user's future infrastructure.
6. The preview intentionally allows framing: there is no `frame-ancestors` block because Arena's live preview is framed. Set an appropriate production ingress policy; the example Caddy configuration uses `frame-ancestors 'none'` outside the preview.
7. Unknown provider license changes or compromised provider data cannot be solved by an HTTP 200 check. Validate semantics, inspect attribution, monitor drift and retain independent checks for consequential decisions.
8. Automated tests/audits do not cover every vulnerability, parser corner case, browser/GPU, coordinated traffic pattern or dependency advisory published later.

## Privacy and data flow

- No automatic device geolocation is requested. Default coordinates are an explicitly named rural Agra-area demonstration point, not the user's precise address.
- A searched place or selected coordinates are sent to the relevant upstream services through the backend. Provider logging/terms can apply. Source links, when opened, follow the publisher's own privacy behavior.
- Parsed environmental/source snapshots are cached. Cache keys can contain rounded coordinates, country or search query, so **do not treat the cache as devoid of sensitive context**. Protect/delete it according to your deployment's use.
- Saved location views persist in browser local storage until cleared in Settings; the access key does not. No server-side user profile or view synchronization is implemented.
- Aircraft are reception-limited public positions, without owner enrichment, persistent track history or extrapolated routes. This is not a private-person tracking service.
- TfL imagery is restricted to the operator's public catalog; no scraping of private/unlisted cameras, face recognition or people identification.
- GBIF output suppresses observer names and exact occurrence coordinates; only a small historical context sample is returned. Species presence/absence or abundance is not inferred from it.
- Audit metadata concerns public repositories. Neither reviewed repository nor its datasets/weights is bundled in the project.

## Operational security checklist

Before external launch: choose a non-commercial or appropriately licensed API plan; deploy HTTPS; protect private use with identity/key controls; set trusted ingress limits; restrict egress; configure secrets outside source control; retain one worker until distributed state is implemented; test backup/restore and graceful shutdown; test expected concurrent traffic; rerun dependency audits; arrange alerts on source failures/quota use; verify camera/news/map redistribution terms; and commission security/accessibility/domain review proportionate to the use case.

For a vulnerability report, send a minimal reproduction to the operator you deploy this with. Do not include real provider or deployment keys in public issues, screenshots or examples.


## V2 additions

- Header keys must be 32–256 visible ASCII characters without whitespace/control characters. Client-side settings use the same constraint; server validation remains authoritative.
- Workspace import is byte/version/type bounded and allowlisted, including active/saved polygons; unknown fields/keys are not exported. It is not a provider-data or arbitrary-URL import.
- JSON fetches refuse redirects, verify media types, bound streamed bytes/error text and distinguish timeout from intentional cancellation. Image fetches remain MIME/size checked.
- Comparison is limited to three points; scientific booleans/non-finite values are rejected. Numerical methods are bounded in history/dimensions and run off the event loop.
- Restored cache timestamps/statuses are validated; SQLite writes rollback on failure. AOI filters and expiring positions match map semantics.
- Launchers bind to loopback unless explicitly overridden. Publication helper refuses unrelated Git roots/existing origins and common runtime/credential paths, but is **not a secret scanner**. Review content and history yourself before publication.
- No remote GitHub publication has occurred in this environment. Authenticate locally using the official CLI/credential helper; never send credentials in chat.
