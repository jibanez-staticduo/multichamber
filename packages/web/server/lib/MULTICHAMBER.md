# Canonical Multichamber Boundaries

## Ownership

`multichamber-env.js` normalizes canonical process configuration before the
server's other imports capture environment values. `multichamber-routes.js`
maps the canonical application API namespace to its existing route owner.

## Invariants

- Explicit `MULTICHAMBER_*` variables win over the corresponding legacy
  `OPENCHAMBER_*` variables, including empty values. Legacy-only installations
  keep their configured behavior. Harness variables and credentials are not
  renamed.
- Only `/api/multichamber`, followed by a slash, query or end of URL, maps to
  `/api/openchamber`. Other paths, query bytes, request bodies and headers are
  preserved.
- The API alias runs before authentication. Both Express's current URL and
  original URL use the same route identity, so authentication, scoped URL-token
  allowlists, body parsing and proxy decisions agree. The alias grants no auth.
- Legacy API routes, persisted settings, metadata namespaces and native harness
  identifiers remain compatible.

## Decisions

### Why One Early Alias Instead Of Duplicated Routes

Both API names reach the same domain handler and security gates. Duplicating
registration would let authorization and parsing behavior drift between names.
