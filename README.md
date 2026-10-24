# Ferry FYI

## Engineering reliable decisions from uncertain transportation data

<img width="1200" height="630" alt="social" src="https://github.com/user-attachments/assets/8005d82a-bd98-4f01-89bf-f3f6f5f2eb81" />


**Technical white paper · Ansel Santosa**

[Live application](https://ferry.fyi) · [Forecasting methodology](https://ferry.fyi/forecasting) · [Data sources and API](https://ferry.fyi/data-sources)

### Abstract

Ferry FYI is an independent web and mobile platform for planning travel on Washington State Ferries. It integrates schedules, vessel telemetry, vehicle inventory, service bulletins, weather, tides, and camera imagery into a decision surface for a deceptively difficult question: **which sailing can I realistically catch?**

The engineering challenge is not displaying a schedule. It is reconciling incomplete, delayed, and sometimes contradictory evidence without presenting an estimate as an operational fact. Ferry FYI addresses that challenge through interpretable forecasting, computer vision, explicit uncertainty contracts, universal React rendering, and policy-controlled backend services.

The repository spans product UX, TypeScript APIs, PostgreSQL data modeling, Python inference, Android and iOS integration, infrastructure as code, and release engineering. Its central architectural principle is that **a prediction is useful only when its provenance, freshness, failure behavior, and operational cost are understood**.

## 1. The decision problem

A published departure time is only one input to a ferry trip. A traveler also needs to reason about a vessel's actual progress, remaining vehicle space, the queue ahead, and the time required to reach the terminal. Those inputs arrive from different systems and describe different things.

| Evidence                                    | What it supports                            | What it does not establish                      |
| ------------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| Published schedules and bulletins           | Planned service and reported disruptions    | Actual departure or boarding availability       |
| Vessel positions and operational reports    | Progress and observed timing                | A guaranteed future departure                   |
| Vehicle-capacity reports                    | Reported inventory for a particular sailing | A measured queue or a boarding guarantee        |
| Camera images and occupancy classifications | Spatial conditions in a visible area        | Exact wait time, queue length, or vehicle count |
| Historical, weather, and calendar signals   | Forecasts and planning context              | Confirmed present conditions                    |

These distinctions shape both the API and the interface. Unknown is not zero, stale is not current, and an unavailable report is not an all-clear. Route direction, service date, source time, and observed-versus-predicted state remain part of the product contract.

The user-facing result combines route schedules, capacity forecasts, delay reporting, cameras, fares, tickets, account alerts, and native conveniences rather than exposing a collection of disconnected data feeds.

## 2. Reference architecture

The core application is a modular TypeScript system with a separately deployable Python vision runtime. Shared domain contracts connect the client, server, server-rendered documents, and native shells; inference is isolated where its dependencies and compute characteristics differ.

```text
React web / PWA                 Capacitor Android / iOS
        \                         /
         Shared TypeScript contracts
                      |
      Express API + server-rendered React
                      |
       Domain services and policy boundaries
          /           |             \
 PostgreSQL     Ingestion/jobs     Inference adapters
                    |                |          |
             WSF / weather /     Private     Opt-in owner-only
             tides / routing     Python YOLO OpenAI evaluation
```

The main application owns data ingestion, forecasting, account workflows, and scheduling. PostgreSQL stores operational history and durable coordination state. The detector exposes a narrow image-inference boundary rather than pulling Python model dependencies into the web process.

This preserves a relatively small deployment surface while allowing the detector to be built, sized, and released independently. The production infrastructure definition pairs an ARM64 web service with an x86 CPU detector reachable through private service discovery and security-group restrictions.

**Implementation:** [server composition](server/server.ts), [shared contracts](shared/contracts), [detector runtime](detector-runtime/README.md), [AWS topology](infra/aws/terraform/README.md).

## 3. Applied AI and predictive modeling

### 3.1 Interpretable capacity forecasting

Capacity estimates blend live vehicle inventory with up to two years of comparable historical sailings. Historical observations are weighted by temporal and calendar context and normalized for vessel capacity. Weather, events, and recent directional demand shifts provide additional context without replacing authoritative operational observations.

Recent-demand adjustments use minimum sample requirements, shrinkage, bounded influence, and asymmetric warning costs. They support `off`, `shadow`, and `on` modes, so a candidate can be evaluated without changing selected user-facing forecasts.

Evaluation is designed around causality. Paired walk-forward backtests restrict historical inputs to what was available at an explicit `asOf` time and compare baseline and candidate forecasts against identical targets and input fingerprints. Metrics include absolute error, tail error, Brier score, full-sailing recall, precision, false-full rates, and coherence violations. A model must be evaluated as both an estimator and a decision aid.

**Implementation:** [forecast model](server/lib/forecast.ts), [demand-shift controls](server/lib/forecastDemandShock.ts), [capacity methodology and backtesting](docs/capacity-forecasting.md).

### 3.2 Combining travel uncertainty with inventory depletion

The recommendation path extends capacity forecasting into a joint decision problem: will vehicle space remain when the traveler arrives?

Drive-up fill estimates combine a historical departure prior with robust live depletion slopes and freshness guards. The sailing-chance model integrates travel-time uncertainty against a depletion-rate distribution rather than multiplying marginal probabilities as though they were independent. Versioned response contracts carry the resulting assessment and uncertainty across the API/UI boundary.

These distributions are documented planning assumptions, not empirically established boarding-success rates. Live routing-provider activation and production launch checks remain separate from local implementation validation.

**Implementation:** [fill timing](server/lib/fillTiming.ts), [joint chance model](server/lib/sailingChance.ts), [recommendation contracts](shared/contracts/sailingRecommendations.ts), [validation and remaining launch gates](docs/sailing-recommendation-validation.md).

### 3.3 Computer vision with constrained interpretation

The public camera-detection path uses a CPU-only YOLO runtime and reviewed polygon geometry to classify spatial occupancy. The application masks relevant areas, bounds inference time, coalesces concurrent work, and caches results. It exposes coarse occupancy states rather than translating a still image into an unsupported exact queue length or wait estimate.

A separate **owner-only, disabled-by-default multimodal evaluation pipeline** explores semantic lane occupancy through OpenAI. It does not replace the public YOLO path, and no model is selected by default. Its engineering work centers on the boundaries around inference:

- **Constrained inputs:** reviewed lane geometry, native-scale crops, masks, and section annotations make the visual task explicit.
- **Validated outputs:** strict JSON Schema is followed by independent checks of identifiers, completeness, and semantic consistency; malformed, refused, or invisible results remain unknown.
- **Cost-aware scheduling:** service-window gating, grouped initial requests, bounded serial follow-ups, progressive backoff, and content fingerprints avoid unnecessary inference.
- **Durable concurrency controls:** PostgreSQL round claims and fenced writes prevent stale workers and restart replay from corrupting current evidence.
- **Privacy-conscious retention:** requests use `store: false`; the pipeline persists derived results and fingerprints rather than raw frames or credentials.

Model, prompt, and geometry changes invalidate relevant cached classifications. Source-image age, check time, and inference time remain distinct. Timed-out provider calls may still incur cost; replay prevention is not an exactly-once billing guarantee.

The vision benchmark protocol defines human-labeled spatial-occupancy evaluation and acceptance thresholds. Label coverage remains incomplete; neither benchmark acceptance nor multimodal accuracy is claimed here. Real token usage and model selection also require a separate benchmark phase.

**Implementation:** [public detection adapter](server/lib/cameraLineDetection.ts), [multimodal pipeline and controls](docs/openai-camera-pipeline.md), [vision benchmark protocol](benchmarks/camera-detection/README.md).

## 4. Full-stack product engineering

### Universal rendering without importing the browser into the server

Server rendering uses an anonymous, versioned data projection and a narrow compiled React renderer. Authentication, browser storage, native bridges, and other client-only effects are separated from that rendering graph.

The client hydrates only when the server snapshot, rendering mode, and document integrity agree; incompatible seed data falls back to a clean client render. A shared route manifest coordinates universal and browser-only routes. This makes first paint, hydration, authentication, and live refresh explicit lifecycle transitions rather than incidental application side effects.

**Implementation:** [universal composition](client/AppRoot.tsx), [server entry](client/entry-server.tsx), [client runtime](client/clientRuntime.tsx), [SSR contract](shared/contracts/ssr.ts).

### Contracts that carry policy, not just types

The canonical public-operation matrix records authentication, cache class, rate class, freshness, and discovery policy alongside endpoint identity. An OpenAPI generator and drift check turn those decisions into inspectable interface documentation.

The accompanying `llms.txt` gives automated consumers task-oriented guidance, including the distinction between observed and predictive values and the limits on authenticated actions. AI integration is therefore addressed on both sides: model-backed features inside the system and bounded, machine-readable interfaces outside it.

**Implementation:** [operation matrix](shared/contracts/publicApiOperations.ts), [OpenAPI generator](server/scripts/generatePublicApiContract.ts), [AI-consumer guide](client/static/llms.txt).

### Shared experience, explicit native boundaries

The React product runs on the web and in Capacitor Android and iOS shells, with native integrations for capabilities such as ticket scanning, location, notifications, sharing, and app updates. Signed native releases remain distinct from over-the-air web-asset updates: an OTA bundle cannot change plugins, permissions, or native code.

Commercial workflows follow the same boundary discipline. Supporter subscriptions use a shared RevenueCat entitlement across storefronts, server-generated pseudonymous customer identifiers, authenticated and signed webhook intake, event deduplication, and server-side entitlement reconciliation. Checkout channels default closed until configured and validated.

**Implementation:** [Capacitor configuration](capacitor.config.ts), [OTA operations](docs/ota-operations.md), [subscription architecture](docs/supporter-subscriptions.md).

## 5. Trust, failure isolation, and operational control

### Background work is coordinated beyond a single process

Scheduled refreshes and owner-triggered operations share named database-backed leases, overlap prevention, stale-run recovery, and lease-token fencing. This addresses deploy/startup/manual-operation collisions without assuming an in-memory scheduler lock is sufficient.

The repository-defined production topology still has one web scheduler. The coordination mechanisms are safeguards, not a claim that horizontal scheduling or active-active operation has been validated.

### Security and privacy are enforced at decision boundaries

- **Administration:** JWT authentication is followed by server-side owner verification; sensitive mutations require confirmations tied to the intended action and resource.
- **Notifications:** consent is evaluated at send time, and a shared global pause fails closed if policy cannot be read. Provider acceptance is not reported as confirmed delivery.
- **HTTP APIs:** endpoint-specific origin, caching, and abuse policies separate public reads, paid-provider work, mutations, and sensitive lookups.
- **Browser caching:** private and live API data stay out of service-worker caches; the offline shell is not represented as current operational data.
- **Observability:** typed telemetry excludes raw URLs, credentials, account identifiers, ticket identifiers, precise locations, and request/response bodies.

**Implementation:** [owner operations](docs/admin-operations.md), [API policy](server/lib/httpApiPolicy.ts), [notification policy](server/lib/admin/notificationPolicy.ts), [service worker](client/service-worker.ts), [reliability runbook](docs/reliability-operations.md).

### Deployment and recovery account for schema changes

Terraform defines ECS Fargate, PostgreSQL on RDS, Secrets Manager, private detector connectivity, and GitHub OIDC deployment permissions. The default footprint deliberately favors operational simplicity and cost control: a singleton web service, Single-AZ RDS, and no NAT gateway. It is not presented as a highly available topology.

The deployment workflow publishes immutable images, captures previous task/image state and the migration range, runs migrations as a one-off task, and performs semantic post-deploy smoke checks. Automatic rollback is disabled because an earlier application revision may not be compatible with the migrated database.

OTA delivery has its own supply-chain controls: private S3 storage, CloudFront access, content hashes, immutable bundle identities, and explicit channel pointers. Recovery follows the affected boundary rather than treating every failure as an interchangeable redeploy.

**Implementation:** [infrastructure and operating constraints](infra/aws/terraform/README.md), [AWS deployment workflow](.github/workflows/deploy-aws.yml), [OTA operations](docs/ota-operations.md).

## 6. Verification and evidence

The repository separates deterministic correctness gates from measurements that require representative runtime or field evidence.

| Layer                   | Verification approach                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Domain and API behavior | Vitest, shared-contract tests, server integration tests, and database-backed concurrency tests                      |
| Forecast changes        | Causal paired backtests, probabilistic metrics, regression assertions, and shadow-mode comparisons                  |
| Inference orchestration | Mocked provider failures, synthetic image geometry, schema validation, stale-frame cases, and durable fencing tests |
| Web delivery            | Production builds, SSR/PWA artifact smokes, Playwright flows, and focused Axe accessibility checks                  |
| Native delivery         | Android build/emulator checks and iOS simulator/archive verification in CI                                          |
| Performance             | Enforced aggregate CSS budget and a separate baseline/candidate browser benchmark with privacy-checked receipts     |
| Operations              | Semantic public-contract smoke checks and privacy-safe lifecycle/operation telemetry                                |

The browser harness records scenario, device, cache, and source-revision context so comparisons are reproducible. Test results, synthetic observations, and field outcomes remain different evidence classes: automated accessibility checks are not WCAG conformance, model priors are not measured boarding success, and proposed reliability objectives are not attained SLOs.

**Implementation:** [blocking checks](.github/workflows/check.yml), [scheduled/manual runtime quality](.github/workflows/runtime-quality.yml), [browser benchmark](scripts/benchmark-browser-runtime.mjs), [evidence and operator requirements](docs/reliability-operations.md).

## 7. Engineering conclusions

Ferry FYI demonstrates an end-to-end approach to AI-enabled product engineering: identify a real decision problem, select interpretable models where they fit, isolate learned inference where it adds value, and carry uncertainty and authorization through every interface.

The most consequential choices are not framework selections. They are the boundaries: observation versus prediction, public versus private, browser versus server, native release versus OTA, retryable work versus potentially billable inference, and repository validation versus production proof. Making those distinctions explicit keeps a broad product understandable, testable, and operable without requiring a microservice for every capability.

## 8. Reproducing the system

### Local development

Prerequisites: Node.js 24.15 or later on the Node 24 release line, Yarn classic, Docker, and Git LFS. See [dependency maintenance](docs/dependency-maintenance.md) for supported release lines and override rationale.

```sh
git clone git@github.com:anstosa/ferry.fyi.git
cd ferry.fyi
git lfs install && git lfs pull
yarn
yarn dev:up
```

Open <http://localhost:4040>. The Compose stack includes the app, detector, PostgreSQL, health checks, and automatic migrations. It boots without a WSDOT key, but live ferry refreshes require `WSDOT_API_KEY`. Optional provider, identity, and native capabilities require their own configuration; startup is not proof that every integration is active.

For container configuration, copy `local-container.env.example` to an untracked `.env`; see [local container development](docs/local-container-development.md). For host-based development, configure `.envrc` from `.envrc.sample`, run `yarn db:start` and `yarn db:migrate`, then `yarn start`. Keep credentials and signing material outside Git.

### Validation commands

```sh
yarn type-check
yarn lint
yarn test
SENTRY_AUTH_TOKEN= yarn build
yarn test:openapi
yarn forecast:backtest --assert
```

Forecast backtests require historical database observations. Environment-dependent tests and native builds have additional prerequisites documented in their respective runbooks. The build command clears the Sentry upload token to avoid publishing source maps during local validation.

### Native development and release

- **Android:** `yarn start:android` supports local device/emulator testing, including the Windows SDK path from WSL. See [Android release automation](docs/android-release-automation.md).
- **iOS:** use macOS, Xcode, and an Apple Developer account. Configure the dedicated iOS Auth0 application and `fyi.ferry://callback`, then use `yarn open:ios` or `yarn ios`. See [iOS identity configuration](docs/ios-account-migration.md) and [TestFlight automation](docs/ios-testflight-automation.md).
- **Store releases:** use **Publish apps** with the exact intended platform and version, or the corresponding `android-v*` / `ios-v*` tag. The workflows build, synchronize, sign, and upload from a clean checkout. Native changes require this path rather than OTA publication.

## Credits and license

Created by **Ansel Santosa**. Ferry FYI is independent of Washington State Ferries and WSDOT.

Weather data and forecasts are provided by [Open-Meteo](https://open-meteo.com/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Thank you to [BrowserStack](https://www.browserstack.com/) for supporting cross-browser testing.

See [LICENSE.txt](LICENSE.txt) for project licensing. Provider data, model weights, and third-party components remain subject to their respective terms and licenses.
