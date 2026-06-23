# Weather-aware capacity forecasting

Ferry FYI uses Open-Meteo as the first-pass weather provider for capacity forecast adjustments.

## Scope

This pass is backend-only:

- no UI changes
- no public schedule API shape changes
- no machine-learning dependency
- no paid weather API requirement
- no automatic retraining
- no weather override of live capacity, cancellations, or disruptions

## Provider

Primary provider: Open-Meteo free/non-commercial endpoints.

Relevant limits and assumptions:

- Free tier is non-commercial.
- Free tier is limited to 10,000 calls/day, 5,000/hour, and 600/minute.
- Free tier has no uptime guarantee.
- Required hourly variables are `temperature_2m`, `cloud_cover`, `wind_speed_10m`, and `precipitation`.

Sources:

- https://open-meteo.com/en/docs/historical-weather-api
- https://open-meteo.com/en/pricing

## Data flow

1. Run historical backfill to store hourly observations by terminal and hour.
2. Run adjustment calculation to persist route/weather effect rows.
3. Runtime forecast refresh stores upcoming hourly weather with a coarse TTL.
4. `server/lib/forecast.ts` applies enabled adjustment rows after the existing live/historical blend.
5. Final estimates remain constrained by live capacity and cancellation/disruption behavior.

## Commands

Dry-run historical backfill:

```sh
yarn weather:backfill --dry-run
```

Run historical backfill:

```sh
yarn weather:backfill
```

Calculate adjustment rows:

```sh
yarn weather:calculate-adjustments
```

Targeted verification:

```sh
yarn test tests/server/forecast.test.ts tests/server/weather-adjustment-calculation.test.ts tests/server/weather-ingestion.test.ts tests/server/open-meteo-weather.test.ts tests/server/weather-capacity-adjustment.test.ts
yarn type-check:server
yarn lint:js:server
```

## Rollback

To disable weather influence without dropping data, mark all `WeatherCapacityAdjustments.isEnabled` values false. Forecasting then falls back to the existing non-weather blend because disabled or missing adjustment rows are no-ops.
