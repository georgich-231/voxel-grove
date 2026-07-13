const { spawn } = require("node:child_process");
const path = require("node:path");
const electronPath = require("electron");

const projectRoot = path.join(__dirname, "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [projectRoot], {
  cwd: projectRoot,
  stdio: "inherit",
  env,
});

function stop(signal = "SIGTERM") {
  if (!child.killed) child.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
