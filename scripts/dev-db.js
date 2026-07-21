#!/usr/bin/env node
/* global console, process, require, URL */

const { execFileSync, spawnSync } = require("node:child_process");

const DEFAULT_DATABASE_URL = "postgres://test:testing@localhost:5432/ferryfyi";
const INTERNAL_POSTGRES_PORT = 5432;
const POSTGRES_IMAGE = "postgres";

const env = loadEnvrc();
const databaseConfig = parseDatabaseUrl(
  env.DATABASE_URL || DEFAULT_DATABASE_URL
);
const containerName =
  env.FERRYFYI_DB_CONTAINER || `ferrydb-${databaseConfig.hostPort}`;
const volumeName = `${containerName}-data`;

// choose command
if (process.argv.includes("--stop")) {
  stopContainer(containerName);
} else {
  startContainer(containerName, databaseConfig);
}

// load local env
function loadEnvrc() {
  // windows fallback
  if (process.platform === "win32") {
    return process.env;
  }

  const envOutput = execFileSync(
    "bash",
    ["-lc", "set -a; [ ! -f .envrc ] || . ./.envrc; set +a; env -0"],
    { encoding: "buffer" }
  );
  const loadedEnv = { ...process.env };

  // parse env output
  for (const entry of envOutput.toString("utf8").split("\0")) {
    const separatorIndex = entry.indexOf("=");

    // malformed env guard
    if (separatorIndex === -1) {
      continue;
    }

    loadedEnv[entry.slice(0, separatorIndex)] = entry.slice(separatorIndex + 1);
  }

  return loadedEnv;
}

// parse postgres url
function parseDatabaseUrl(databaseUrl) {
  let url;

  // validate url
  try {
    url = new URL(databaseUrl);
  } catch (error) {
    throw new Error(`Invalid DATABASE_URL: ${databaseUrl}`, { cause: error });
  }

  // postgres-only guard
  if (!url.protocol.startsWith("postgres")) {
    throw new Error(`DATABASE_URL must use postgres: ${databaseUrl}`);
  }

  return {
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    hostPort: Number(url.port || INTERNAL_POSTGRES_PORT),
    password: decodeURIComponent(url.password || "testing"),
    username: decodeURIComponent(url.username || "test"),
  };
}

// start postgres
function startContainer(name, config) {
  // existing container guard
  if (isContainerRunning(name)) {
    console.log(`${name} is already running`);
    return;
  }

  // restart existing persistent container
  if (doesContainerExist(name)) {
    console.log(`starting existing ${name}`);
    runDocker(["start", name]);
    return;
  }

  const args = [
    "run",
    "-d",
    "-p",
    `${config.hostPort}:${INTERNAL_POSTGRES_PORT}`,
    "-e",
    `POSTGRES_DB=${config.database}`,
    "-e",
    `POSTGRES_PASSWORD=${config.password}`,
    "-e",
    `POSTGRES_USER=${config.username}`,
    "--name",
    name,
    "--mount",
    `type=volume,source=${volumeName},target=/var/lib/postgresql/data`,
    POSTGRES_IMAGE,
  ];

  console.log(
    `starting ${name} on localhost:${config.hostPort} for ${config.database}`
  );
  runDocker(args);
}

// check whether a stopped persistent container already exists
function doesContainerExist(name) {
  const result = spawnSync("docker", ["inspect", name], {
    stdio: "ignore",
  });

  return result.status === 0;
}

// stop postgres
function stopContainer(name) {
  // missing container guard
  if (!isContainerRunning(name)) {
    console.log(`${name} is not running`);
    return;
  }

  runDocker(["stop", name]);
}

// check container status
function isContainerRunning(name) {
  const result = spawnSync(
    "docker",
    ["inspect", "-f", "{{.State.Running}}", name],
    { encoding: "utf8" }
  );

  return result.status === 0 && result.stdout.trim() === "true";
}

// run docker command
function runDocker(args) {
  const result = spawnSync("docker", args, { stdio: "inherit" });

  // command failure guard
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
