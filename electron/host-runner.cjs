const { spawn } = require("node:child_process");
const path = require("node:path");
const electronPath = require("electron");

const projectRoot = path.join(__dirname, "..");
const serverPort = process.env.VOXEL_GROVE_SERVER_PORT || process.env.PORT || "25565";
const serverSeed = process.env.VOXEL_GROVE_SERVER_SEED || process.env.VG_SEED || process.env.WORLD_SEED || "0";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const server = spawn(process.execPath, [
  path.join(projectRoot, "server", "multiplayerServer.mjs"),
  "--port",
  serverPort,
  "--seed",
  serverSeed,
], {
  cwd: projectRoot,
  stdio: "inherit",
  env,
});

let electron = null;
let stopping = false;

server.on("error", (error) => {
  console.error("Could not start multiplayer server:", error.message);
  stop(1);
});

server.on("exit", (code) => {
  if (!stopping) {
    console.error(`Multiplayer server stopped with code ${code ?? 0}.`);
    stop(code ?? 1);
  }
});

const build = spawn(npmCommand, ["run", "build"], {
  cwd: projectRoot,
  stdio: "inherit",
  env,
});

build.on("exit", (code) => {
  if (stopping) return;
  if (code !== 0) {
    stop(code ?? 1);
    return;
  }
  startElectron();
});

function startElectron() {
  if (electron) return;
  console.log(`Host server running at ws://127.0.0.1:${serverPort}`);
  electron = spawn(electronPath, [projectRoot], {
    cwd: projectRoot,
    stdio: "inherit",
    env,
  });
  electron.on("exit", (code) => stop(code ?? 0));
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (electron && !electron.killed) electron.kill();
  if (!server.killed) server.kill();
  process.exit(code);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
