# Local container development

Use `docker-compose.dev.yml` to run a prod-like local stack with the app, detector runtime, and Postgres on a private Compose network.

## Quick start

```sh
yarn dev:up
```

This builds the app and detector images when needed, starts Postgres and the detector, applies Sequelize migrations, and waits until the app is healthy. Open the app at <http://localhost:4041>. The detector health endpoint is available at <http://localhost:8001/health> and the API is available to the app at `http://detector:8000/detect` inside the Compose network.

## Commands

- `yarn container:build` builds the app and detector images.
- `yarn dev:up` builds as needed, starts the full stack, applies migrations, and waits for the long-running services to become healthy.
- `yarn container:up` remains an alias for `yarn dev:up`.
- `yarn container:down` stops the stack and keeps the Postgres volume.
- `yarn container:logs` follows stack logs.
- `yarn container:migrate` manually reruns Sequelize migrations against the already-running container Postgres database.
- `yarn container:reset` removes the Postgres volume, restarts dependencies, reruns migrations, and starts the app. Do not run this if you need to keep local container data.

## Environment overrides

Compose uses safe local defaults directly from `docker-compose.dev.yml`. It automatically passes every value in an optional root `.env` file to the app and migration containers. Container-only settings such as the database and detector URLs still take precedence so they always use the Compose network.

To customize ports, browser configuration, or server credentials, copy the example to `.env`:

```sh
cp local-container.env.example .env
yarn dev:up
```

Do not use `.envrc` as the Compose `.env` file; it can contain shell syntax that Compose does not parse. The migration container runs automatically before the app starts and can be rerun with `yarn container:migrate` after adding a migration.

Set `WSDOT_API_KEY` in `.env` when you need the stack to refresh live ferry data. The stack still boots without it, but live WSF refresh requests will be unauthorized.

## Database

The container database matches local development defaults:

```text
postgres://test:testing@localhost:5434/ferryfyi
```

Inside Compose, services use:

```text
postgres://test:testing@postgres:5432/ferryfyi
```

Postgres data is stored in the `postgres-data` Docker volume.

## QA overlays against the containerized API

With the app running on the default port, render camera line-detection QA overlays against the containerized API:

```sh
python3 scripts/render-camera-line-detection-results.py --api-url http://localhost:4041/api/cameras/line-detection
```
