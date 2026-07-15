#!/usr/bin/env node

const { spawn, execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const args = new Set(process.argv.slice(2));
const shouldStartCameraTools = args.has("--with-camera-tools");
const isDryRun = args.has("--dry-run");
const commands = [
  ["client", "start:client"],
  ["server", "start:server"],
];
const children = new Set();
const childGroups = new Set();
const shouldDetachChildren = process.platform !== "win32";
const env = loadEnvrc();
const detectorPort = env.DETECTOR_PORT || "8001";
const detectorUrl = `http://127.0.0.1:${detectorPort}/detect`;
let isShuttingDown = false;

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
  const loadedEnv = {};
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

// get package script
function getScript(scriptName) {
  const script = packageJson.scripts[scriptName];
  // missing script guard
  if (!script) {
    throw new Error(`Missing package script: ${scriptName}`);
  }
  return script;
}

// configure shared local detector
function configureDetectorEnv() {
  env.DETECTOR_PORT = detectorPort;
  env.CAR_DETECTION_ENDPOINT = detectorUrl;
  env.FERRY_DETECTOR_URL = detectorUrl;
}

// print local development URLs
function printUrls() {
  console.log("[dev] app: http://localhost:4040");
  console.log(`[dev] database: ${env.DATABASE_URL}`);
  console.log(`[dev] detector: ${detectorUrl}`);
  // camera tool URL
  if (shouldStartCameraTools) {
    console.log("[dev] annotator: http://127.0.0.1:8787/");
  }
}

// start postgres using the same DATABASE_URL provided to the server
function startDatabase() {
  const command = ["scripts/dev-db.js"];
  console.log(`[dev] starting database: node ${command.join(" ")}`);
  // print command wiring only
  if (isDryRun) {
    return;
  }
  execFileSync(process.execPath, command, { env, stdio: "inherit" });
}

// start detector container first
function startDetector() {
  const command = ["compose", "-f", "docker-compose.dev.yml", "up", "--detach", "detector"];
  console.log(`[dev] starting detector: docker ${command.join(" ")}`);
  // print command wiring only
  if (isDryRun) {
    console.log(`[dev] detector env: DETECTOR_PORT=${detectorPort}`);
    return;
  }
  execFileSync("docker", command, { env, stdio: "inherit" });
}

// signal process group
function signalProcessGroup(groupPid, signal) {
  // unix group guard
  if (!shouldDetachChildren) {
    return false;
  }
  try {
    process.kill(-groupPid, signal);
    return true;
  } catch (error) {
    // missing-process guard
    if (error.code !== "ESRCH") {
      throw error;
    }
    return true;
  }
}

// stop child process
function stopChild(child) {
  // already-stopped guard
  if (child.killed) {
    return;
  }
  // process-group cleanup
  if (signalProcessGroup(child.pid, "SIGTERM")) {
    return;
  }
  child.kill("SIGTERM");
}

// stop child processes
function stopAll(signal = "SIGTERM") {
  // stop child groups
  for (const groupPid of childGroups) {
    signalProcessGroup(groupPid, signal);
  }
  // stop direct children
  for (const child of children) {
    // signal fallback
    if (signal === "SIGTERM") {
      stopChild(child);
    } else {
      child.kill(signal);
    }
  }
}

// handle shutdown
function shutdown(exitCode = 0) {
  // duplicate signal guard
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  process.exitCode = exitCode;
  stopAll();
  // force cleanup
  setTimeout(() => {
    stopAll("SIGKILL");
    process.exit(exitCode);
  }, 2000).unref();
}

// start dev target
function startScript(name, scriptName) {
  const command = getScript(scriptName);
  console.log(`[dev] starting ${name}: ${command}`);
  // expose detector endpoint wiring
  if (isDryRun) {
    console.log(
      `[dev] ${name} env: CAR_DETECTION_ENDPOINT=${env.CAR_DETECTION_ENDPOINT} FERRY_DETECTOR_URL=${env.FERRY_DETECTOR_URL}`
    );
    return;
  }
  const child = spawn(command, {
    detached: shouldDetachChildren,
    env,
    shell: true,
    stdio: "inherit",
  });
  children.add(child);
  childGroups.add(child.pid);

  // handle child exit
  child.on("exit", (code, signal) => {
    children.delete(child);
    // intentional shutdown guard
    if (isShuttingDown) {
      return;
    }
    const exitCode = code ?? (signal ? 1 : 0);
    console.error(`[dev] ${name} exited`);
    shutdown(exitCode);
  });
}

// configure and start shared infrastructure before launching app processes.
// Both the server and camera tools inherit these local service endpoints.
configureDetectorEnv();
startDatabase();
startDetector();

// configure optional camera tools
if (shouldStartCameraTools) {
  commands.push(["camera polygon annotator", "camera:polygons"]);
}

// print service endpoints
printUrls();

// launch targets
for (const [name, scriptName] of commands) {
  startScript(name, scriptName);
}

// handle interrupt
process.on("SIGINT", () => {
  shutdown();
});
// handle termination
process.on("SIGTERM", () => {
  shutdown();
});
// handle hangup
process.on("SIGHUP", () => {
  shutdown();
});
// handle direct exit
process.on("exit", () => {
  stopAll();
});
