const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const RESOLUTION_PRESETS = new Map([
  ["1280x720", { id: "1280x720", label: "1280 x 720", width: 1280, height: 720 }],
  ["1366x768", { id: "1366x768", label: "1366 x 768", width: 1366, height: 768 }],
  ["1600x900", { id: "1600x900", label: "1600 x 900", width: 1600, height: 900 }],
  ["1920x1080", { id: "1920x1080", label: "1920 x 1080", width: 1920, height: 1080 }],
  ["2560x1440", { id: "2560x1440", label: "2560 x 1440", width: 2560, height: 1440 }],
]);
const DEFAULT_RESOLUTION_ID = "1280x720";
const DEFAULT_SERVER_PORT = 25565;
let hostedServer = null;

function settingsPath() {
  return path.join(app.getPath("userData"), "window-settings.json");
}

function readWindowSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    if (RESOLUTION_PRESETS.has(data.resolutionId)) return data;
  } catch {
    // Missing or malformed settings should never block launch.
  }
  return { resolutionId: DEFAULT_RESOLUTION_ID };
}

function writeWindowSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function getResolution(id) {
  return RESOLUTION_PRESETS.get(id) ?? RESOLUTION_PRESETS.get(DEFAULT_RESOLUTION_ID);
}

function getLanUrls(port) {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      urls.push(`ws://${entry.address}:${port}`);
    }
  }
  return urls;
}

function hostedServerInfo() {
  if (!hostedServer) return { running: false };
  return {
    running: true,
    port: hostedServer.port,
    seed: hostedServer.seed,
    localUrl: `ws://127.0.0.1:${hostedServer.port}`,
    lanUrls: getLanUrls(hostedServer.port),
    playerCount: hostedServer.playerCount,
  };
}

async function startHostedServer(options = {}) {
  if (hostedServer) return hostedServerInfo();
  const serverModuleUrl = pathToFileURL(path.join(__dirname, "..", "server", "multiplayerServerCore.mjs")).href;
  const { startMultiplayerServer } = await import(serverModuleUrl);
  hostedServer = await startMultiplayerServer({
    host: "0.0.0.0",
    port: Number(options.port) || DEFAULT_SERVER_PORT,
    seed: options.seed ?? "0",
    autoOpFirstPlayer: true,
    log: console.error,
  });
  return hostedServerInfo();
}

async function stopHostedServer() {
  if (!hostedServer) return { running: false };
  const server = hostedServer;
  hostedServer = null;
  await server.stop();
  return { running: false };
}

function createWindow() {
  const windowSettings = readWindowSettings();
  const resolution = getResolution(windowSettings.resolutionId);
  const mainWindow = new BrowserWindow({
    width: resolution.width,
    height: resolution.height,
    minWidth: 960,
    minHeight: 540,
    title: "Voxel Grove",
    backgroundColor: "#78b7e5",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  const devServerUrl = process.env.VOXEL_GROVE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    if (process.env.VOXEL_GROVE_OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
    return mainWindow;
  }

  const builtIndex = path.join(__dirname, "..", "dist", "index.html");
  if (fs.existsSync(builtIndex)) {
    mainWindow.loadFile(builtIndex);
  } else {
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <title>Voxel Grove</title>
      <body style="margin:0;background:#101820;color:#f8fbff;font-family:sans-serif;display:grid;place-items:center;height:100vh">
        <main style="max-width:560px;padding:24px;text-align:center">
          <h1>Voxel Grove is not built yet.</h1>
          <p>Run <code>npm run desktop</code> so Vite builds the game before Electron opens it.</p>
        </main>
      </body>
    `)}`);
  }

  return mainWindow;
}

app.whenReady().then(() => {
  ipcMain.handle("voxel-grove:get-window-settings", () => {
    const settings = readWindowSettings();
    return getResolution(settings.resolutionId);
  });

  ipcMain.handle("voxel-grove:set-resolution", (event, resolutionId) => {
    const resolution = getResolution(resolutionId);
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    if (mainWindow) {
      mainWindow.setSize(resolution.width, resolution.height, true);
      mainWindow.center();
    }
    writeWindowSettings({ resolutionId: resolution.id });
    return resolution;
  });

  ipcMain.handle("voxel-grove:start-server", (event, options) => startHostedServer(options));
  ipcMain.handle("voxel-grove:stop-server", () => stopHostedServer());
  ipcMain.handle("voxel-grove:get-server-info", () => hostedServerInfo());

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (hostedServer) {
    const server = hostedServer;
    hostedServer = null;
    server.stop();
  }
});
