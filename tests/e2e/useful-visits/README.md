# Useful visits browser fixture

Run locally without live providers:

```sh
yarn vite build --config tests/e2e/useful-visits/vite.config.ts
node tests/e2e/useful-visits/browser-check.mjs
```

The browser check fulfills only manifest-bound fixture assets and exact configured Google scripts with inert responses. It blocks all collection requests (including fixture-ID collection), all other requests, and service workers. No request is forwarded. No real server is required: Playwright fulfills the loopback URL itself.

The check also uses native intersection observations to prove that an edge-only (zero-area) intersection re-arms after scrolling into positive visible area.

This proves production analytics and continuous-exposure hook behavior, plus a modeled fulfilled/rejected share boundary. Production action callsites are covered separately by component tests. It does not prove GA ingestion, recipient delivery, or production GTM configuration.
