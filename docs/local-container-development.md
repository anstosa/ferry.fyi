# Local container development

Use `docker-compose.dev.yml` to run a prod-like local stack with the app, detector runtime, and Postgres on a private Compose network.

## Quick start

```sh
yarn container:build
yarn container:up
yarn container:migrate
```

Open the app at <http://localhost:4041>. The detector health endpoint is available at <http://localhost:8001/health> and the API is available to the app at `http://detector:8000/detect` inside the Compose network.

## Commands

- `yarn container:build` builds the app and detector images.
- `yarn container:up` starts `postgres`, `detector`, and `app` in the background.
- `yarn container:down` stops the stack and keeps the Postgres volume.
- `yarn container:logs` follows stack logs.
- `yarn container:migrate` runs Sequelize migrations against the container Postgres database.
- `yarn container:reset` removes the Postgres volume, restarts dependencies, reruns migrations, and starts the app. Do not run this if you need to keep local container data.

## Environment overrides

Compose uses safe local defaults directly from `docker-compose.dev.yml`. Optional overrides live in `local-container.env.example` using plain `KEY=VALUE` syntax.

To customize ports or browser build placeholders, copy selected values into `.env` for Compose's automatic env loading, or pass a file explicitly:

```sh
cp local-container.env.example local-container.env
docker compose --env-file local-container.env -f docker-compose.dev.yml up --detach postgres detector app
```

Do not use `.envrc` as a Compose `env_file`; it can contain shell syntax that Compose does not parse. The `migrate` service is in the `tools` profile, so it only runs through `yarn container:migrate` or an explicit `--profile tools` command.

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
