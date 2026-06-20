#!/usr/bin/env node

const { spawn, execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const commands = [
  ["client", "start:client"],
  ["server", "start:server"],
];
const children = new Set();
const env = loadEnvrc();
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

// stop child processes
function stopAll() {
  // stop children
  for (const child of children) {
    // live child guard
    if (!child.killed) {
      child.kill("SIGTERM");
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
}

// start dev target
function startScript(name, scriptName) {
  const command = getScript(scriptName);
  console.log(`[dev] starting ${name}: ${command}`);
  const child = spawn(command, {
    env,
    shell: true,
    stdio: "inherit",
  });
  children.add(child);

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
