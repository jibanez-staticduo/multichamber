# Linear OAuth broker hand-off

Multichamber has no baked-in Linear OAuth application or hosted callback.
Configure a Linear client ID and either a direct redirect URI or a broker you
operate. Existing stored workspace tokens remain usable.

## Direct callback

Set `MULTICHAMBER_LINEAR_CLIENT_ID` and
`MULTICHAMBER_LINEAR_REDIRECT_URI`, or the matching server settings. Register
that exact redirect URI with your Linear OAuth application. Linear compares
the complete URI, including scheme, host, path and port.

A direct loopback callback is suitable only when Linear can return to that
machine. A remote server or mobile client can need a stable public callback.

## Broker callback

Set `MULTICHAMBER_LINEAR_BROKER_URL` or `linearBrokerUrl` to a broker you operate,
for example `https://your-broker.example/v1/oauth/linear`. Register its
`/callback` URI with your own Linear OAuth application.

1. The server creates OAuth state, a PKCE verifier and a separate claim secret.
2. The broker keeps hashes of state and the claim secret for the hand-off.
3. Linear sends its authorization code to the registered callback.
4. The server polls the broker with state and the claim secret.
5. The server exchanges the code with its PKCE verifier and stores tokens locally.
6. After persistence succeeds, the server acknowledges the hand-off.

The broker contract exposes `/start`, `/callback`, `/poll` and `/complete`.
It never receives the PKCE verifier, access token or refresh token. Private
Relay is not part of this flow. An unconfigured application refuses a new OAuth
flow before making a network request.

## Ownership

- `auth.js` resolves client, redirect and broker configuration.
- `oauth.js` owns PKCE, broker hand-off and token exchange.
- `routes.js` starts authorization and polls completion.

The hosted broker implementation is external to this repository. Configuring
one does not create or publish that service.
