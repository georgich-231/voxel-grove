const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const electronPath = require("electron");

const projectRoot = path.join(__dirname, "..");
const port = process.env.VOXEL_GROVE_DEV_PORT || "5173";
const devServerUrl = `http://127.0.0.1:${port}`;

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const vite = spawn(npmCommand, ["run", "dev", "--", "--port", port, "--strictPort"], {
  cwd: projectRoot,
  stdio: "inherit",
  env: { ...process.env, BROWSER: "none" },
});

let electron = null;
let stopping = false;

function waitForDevServer(attempt = 0) {
  const request = http.get(devServerUrl, (response) => {
    response.resume();
    startElectron();
  });

  request.on("error", () => {
    if (attempt > 120) {
      console.error(`Timed out waiting for ${devServerUrl}`);
      stop(1);
      return;
    }
    setTimeout(() => waitForDevServer(attempt + 1), 500);
  });

  request.setTimeout(1000, () => {
    request.destroy();
  });
}

function startElectron() {
  if (electron) return;
  const env = { ...process.env, VOXEL_GROVE_DEV_SERVER_URL: devServerUrl };
  delete env.ELECTRON_RUN_AS_NODE;
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
  if (!vite.killed) vite.kill();
  process.exit(code);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
vite.on("exit", (code) => {
  if (!stopping) stop(code ?? 0);
});

waitForDevServer();
