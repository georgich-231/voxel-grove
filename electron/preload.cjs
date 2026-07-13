const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voxelGroveDesktop", {
  isDesktop: true,
  getWindowSettings: () => ipcRenderer.invoke("voxel-grove:get-window-settings"),
  setResolution: (resolutionId) => ipcRenderer.invoke("voxel-grove:set-resolution", resolutionId),
  startServer: (options) => ipcRenderer.invoke("voxel-grove:start-server", options),
  stopServer: () => ipcRenderer.invoke("voxel-grove:stop-server"),
  getServerInfo: () => ipcRenderer.invoke("voxel-grove:get-server-info"),
});
